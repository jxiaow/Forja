# Workroot Redesign: 基于显式 workroot 的 Target 管理重构

> Status date: 2026-07-16

## 1. 问题

### 1.1 配置锚点在目录而非项目

当前配置存储 key 是 `hash(cwd + type)`，workspace 来源：
- CLI: `process.cwd()` — 随用户站的位置变
- VSCode: `workspaceFolders` + 猜测 — Qt/SDK 分开解析

导致同一项目从不同子目录运行会产生不同配置。`resolveConfigPath` 的向上继承只是补丁——一旦子目录写了自己的配置就断了。

### 1.2 三层存储数据重复，无 source of truth

同一份数据（qtPath/vsInstall/mode/arch）写入三个地方：
1. `activeTarget` — 号称是指针，但携带完整工具链数据
2. `qt`/`sdk` domain config — 领域配置
3. `targetToolchains` — per-target 工具链快照

各处从不同地方读，写入也不完整（如 `runUpdateModeArch` 不写 targetToolchains），导致不一致。

### 1.3 单 activeTarget 指针不够用

一个 workspace 只能有一个 activeTarget。切换多个项目时需要重写整个 activeTarget + domain config，代价太重。

### 1.4 createActionPlan 绕过 ActiveTarget

`createActionPlan`（`src/qt/shared/qtCore.ts`）内部直接 `loadQtSettings(workspace)` 读取工具链字段（qtPath/vsInstall/jomPath/mode/arch/qmakeArgs），不经过 ActiveTarget。CLI 调用方（build.ts/run.ts/clean.ts）将 `CliOptions` 中的这些字段全传 `null`，让 `createActionPlan` 自己读。

## 2. 设计目标

1. 配置锚点稳定：从任何目录运行命令，得到相同配置
2. 单一 source of truth：每个 workspace 一个文件
3. 多 target 支持：保留多个已配置 target，单 active
4. createActionPlan 纯参数化：不内部读配置文件

## 3. 设计约束

- 不依赖 git
- 不在项目目录放配置文件
- 不做旧数据迁移——用户从零开始配置
- 不做向后兼容——旧 CLI 入口、旧配置文件、QtSettings target 字段全部不读取
- 旧文件不主动删除，只作为遗留文件保留；新版本不得因旧文件存在而改变行为

## 4. 存储模型

### 4.1 文件结构

```
~/.forja/
  config.json                ← 全局配置 (lang) — 不变
  workspaces.json            ← 轻量注册表（只有路径列表）
  workspaces/
    <workroot-hash>.json     ← 每个 workspace 的完整数据
  projects/                  ← 旧配置遗留目录，新版本不读取
```

### 4.2 workspaces.json（注册表）

```json
{
  "workroots": [
    "C:/Code/myapp",
    "C:/Code/sdklib"
  ]
}
```

- 只存路径列表，文件极小
- 路径归一化：正斜杠、去尾部斜杠、小写

### 4.3 workspaces/\<hash\>.json（per-workspace 数据）

```json
{
  "schemaVersion": 1,
  "workroot": "C:/Code/myapp",
  "activeTarget": "qt-app-debug-x64",
  "targets": {
    "qt-app-debug-x64": {
      "id": "qt-app-debug-x64",
      "name": "MyApp Debug x64",
      "kind": "qt",
      "project": "app/app.pro",
      "mode": "debug",
      "arch": "x64",
      "runAt": "local",
      "toolchain": {
        "qtPath": "C:/Qt/6.5.3/msvc2019_64",
        "qtVersion": "6.5.3",
        "vsInstall": "C:/Program Files/Microsoft VS/2019/Pro",
        "jomPath": "C:/Qt/Tools/jom/jom.exe",
        "qmakeTarget": "MyApp"
      }
    },
    "sdk-lib-release-x86": {
      "id": "sdk-lib-release-x86",
      "name": "SDK Lib Release",
      "kind": "cpp",
      "project": "lib/lib.sln",
      "mode": "release",
      "arch": "x86",
      "runAt": "local",
      "toolchain": {
        "vsInstall": "C:/Program Files/Microsoft VS/2022/Community"
      }
    }
  },
  "qtModulePrefs": {
    "qmakeArgs": "",
    "cStandard": "c11",
    "cppStandard": "c++11",
    "designerPath": "",
    "qtSourcePath": "",
    "manualProPath": "",
    "rccProjectPath": "",
    "scanExcludeDirs": [],
    "customCommands": [],
    "suppressedWarnings": [],
    "fileSyncPromptEnabled": true,
    "qmakeReminderEnabled": true
  },
  "cppModulePrefs": {
    "scanDepth": 8
  },
  "remote": {},
  "sync": {}
}
```

### 4.3.1 字段规则

- `TargetProfile.project`: workroot 相对路径（正斜杠）。只允许相对路径——跨盘或 workroot 外的项目需注册为独立 workroot。
- `TargetProfile.id`: 稳定 ID，由 §4.6 规则生成。
- `TargetProfile.name`: UI 展示名，默认由项目名 + mode + arch 生成。
- `activeTarget`: 指向 `targets` 中某个 target 的 ID。允许为 `null`，表示尚未选择。

### 4.4 替代的旧配置

| 旧配置 | 新位置 |
|---|---|
| `activeTarget` (ConfigType) | `workspace.activeTarget` |
| Qt `pinnedProject` / mode / arch / qtPath / vsInstall / jomPath / target | `workspace.targets[id]` 各字段 |
| SDK `pinnedProject` / mode / arch / vsInstall | `workspace.targets[id]` 各字段 |
| `targetToolchains` (ConfigType) | `workspace.targets[id].toolchain` |
| Qt settings 模块偏好（qmakeArgs, c/cppStandard, designerPath, scanExcludeDirs, customCommands, suppressedWarnings, fileSyncPromptEnabled, qmakeReminderEnabled） | `workspace.qtModulePrefs` |
| Qt `manualProPath` / `rccProjectPath` | `workspace.qtModulePrefs`（非 target 特定，是项目级路径偏好） |
| SDK/C++ settings 模块偏好（scanDepth） | `workspace.cppModulePrefs` |

### 4.5 Remote/Sync 配置

Remote/Sync 也统一使用 workroot 解析 workspace。新版本只读写 workspace store 中的 remote/sync 字段；旧的 remote/sync 配置文件不再被找到，用户需要重新配置。

Server store — 不变（全局，不依赖 workspace）。

### 4.6 Target ID 生成规则

ID 格式：`{kind}-{projectBasename}-{mode}-{arch}`

示例：`qt-app-debug-x64`、`sdk-corelib-release-x86`

冲突处理：若同一 workroot 下存在相同 ID，追加短 hash（`{kind}-{basename}-{mode}-{arch}-{hash6}`）。

### 4.7 Hash 函数

per-workspace 文件路径：`sha256(normalizedWorkroot).slice(0, 12)` + `.json`，存放在 `~/.forja/workspaces/` 目录下。

与旧 `projects/` 目录的 hash 函数独立（不同目录，不会冲突）。

## 5. Workspace 解析

### 5.1 resolveWorkroot(cwd) 函数

```
1. 读取 ~/.forja/workspaces.json
2. 归一化 cwd（正斜杠、去尾部斜杠、小写）
3. 在所有已注册 workroot 中找最深前缀匹配
   匹配条件: normalizedCwd === normalizedWorkroot
          或 normalizedCwd.startsWith(normalizedWorkroot + "/")
   多个匹配取最长（最深嵌套）
4. 无匹配 → null
```

### 5.2 替换点

- CLI `extractWorkspace()` → `resolveWorkroot(process.cwd())`
- `--workspace` flag → 也走 resolveWorkroot 验证
- VSCode `resolveProjectRoot()` → 匹配 workspaceFolder 到已注册 workroot

### 5.3 `--workspace` flag 行为

- `--workspace <path>` 指定的路径必须是已注册 workroot 或其子目录
- 若不在任何已注册 workroot 下 → 报错，提示 `forja init --workroot <path>`

### 5.4 边界情况

| 场景 | 处理 |
|---|---|
| 嵌套 workroot（`C:/projects` 和 `C:/projects/app`） | 取最深匹配 |
| workroot 目录已删除 | 忽略，不报错（lazy cleanup） |
| workspaces.json 损坏 | 视为空，提示重新 init |
| `C:/projects/app` vs `C:/projects/app-v2` | 不匹配（需要 `/` 边界） |

## 6. 命令行为

### 6.1 行为矩阵

| 命令 | workroot 已注册 | workroot 未注册 |
|---|---|---|
| `forja init` | 显示现有 targets，可添加/修改 | 注册 workroot，扫描项目，配置 target |
| `forja use target` | 正常切换/配置 | 提示确认目录，确认后注册并继续 |
| `forja list targets` | 正常列出 | 报错 → nextAction: `forja init` |
| `forja status` | 正常显示 | 报错 → nextAction: `forja init` |
| `forja build/run/stop/clean` | 正常执行 | 报错 → nextAction: `forja init` |
| `forja doctor` | 正常检查 | 报错 → nextAction: `forja init` |

### 6.2 `forja init` 命令

新增顶级命令。流程：

```
forja init [--workroot <path>]

1. 解析 workroot（--workroot 或 cwd）
2. 检查是否已注册
   - 已注册 → 显示当前 targets 列表，提供选项：
     a) 添加新 target → 继续步骤 3-7
     b) 修改现有 target → 选择已有 target → 重跑工具链检测 + mode/arch 配置 → 更新该 target profile
     c) 退出
   - 未注册 → 继续
3. 扫描 workroot 下的项目（scanProFiles + scanSdkProjects）
4. 检测工具链（detectEnv）
5. 交互流程（复用 useTarget 的 resolve 逻辑）：
   - 选择目标项目
   - 配置工具链
   - 选择 mode/arch
6. 生成 target profile，写入 workspaces/<hash>.json
7. 注册 workroot 到 workspaces.json（如未注册）
8. 输出摘要 + nextAction: forja status
```

三种模式：
- 交互模式：逐步 prompt
- `--json`：返回 questions
- `--answers`：从文件读答案

### 6.3 `forja use target` 改造

| 子路径 | 新行为 |
|---|---|
| `--project X` | X 是已保存 target → 直接切换 activeTarget 指针；X 是新项目 → 检测工具链 + 配置 mode/arch → 保存为新 target 并激活 |
| `--mode/--arch` | 更新 active target 的 mode/arch |
| `--qt/--vs/--jom` | 更新 active target 的 toolchain |
| 无 flag | 完整配置流程；workroot 未注册时提示确认或指定 workroot 路径 |

`--reset` flag 移除。用户需要重新配置时直接运行 `forja init`。

### 6.3.1 `forja use execution` 改造

`runAt`（local/remote）在 `targets[id].runAt` 中。`forja use execution --local/--remote` 改为更新 active target 的 `runAt` 字段。

### 6.4 `forja list targets` 改造

- 从 per-workspace 文件读已保存 targets
- 扫描 workroot 下的 candidates
- 合并显示：saved targets（`*` 标记 active）+ unsaved candidates

## 7. createActionPlan 改造

### 7.1 当前问题

```
build.ts → 读 ActiveTarget（拿到 project, kind）
         → 调 createActionPlan(cliOptions)  // qtPath/vsDevShell/target/qmakeArgs 全传 null
              → 内部 loadQtSettings(workspace) 读工具链
              → 用这些字段组装构建命令
```

### 7.2 改造后

```
build.ts → 从 workspaceStore 读 active target + qtModulePrefs
         → 构造 cliOptions（qtPath/vsDevShell/target/qmakeArgs 填实际值）
         → 调 createActionPlan(cliOptions)
              → 使用传入值，不读任何配置文件
```

### 7.3 CliOptions 字段利用

`CliOptions` 已有 `qtPath`/`vsDevShell`/`target`/`qmakeArgs` 字段，当前 CLI 调用方全传 `null`。改造后调用方从 workspaceStore 读取实际值填入。

### 7.4 模块偏好传递

`qmakeArgs` 从 per-workspace 文件的 `qtModulePrefs.qmakeArgs` 读取，通过 `CliOptions.qmakeArgs` 传入 `createActionPlan`。

`suppressedWarnings` 从 `qtModulePrefs.suppressedWarnings` 读取，传给 `runCliResult`。

`manualProPath` / `rccProjectPath` 从 `qtModulePrefs` 读取，通过 `CliOptions` 传入（需扩展 `CliOptions` 增加这两个字段）。

### 7.5 qtCore.ts 内部 handler 处理

`createActionPlan` 内部有多个 action handler（`handleStatusAction`、`handleEnvAction`、`handleInitAction`、`handleUseAction`、`handleProjectsAction`），它们直接读 QtSettings。

处理方式：
- `handleInitAction` / `handleUseAction` — 移除。新 CLI 的 `forja init` 和 `forja use target` 已替代这些功能。
- `handleStatusAction` / `handleEnvAction` / `handleProjectsAction` — 移除。新 CLI 的 `forja status` 和 `forja list env` 已替代。
- 旧 CLI 入口 `src/qt/cli/index.ts` 整体移除（不做兼容）。

### 7.6 run.ts 中 handleDesigner / handleCustom 处理

`run.ts` 的 `handleDesigner` 直接读 `loadQtSettings` 获取 `designerPath`/`qtPath`，`handleCustom` 读 `customCommands`。这些不经过 `createActionPlan`。

处理方式：改为从 workspaceStore 的 `qtModulePrefs` 读取对应字段。`qtPath` 从 active target 的 `toolchain.qtPath` 读取。

## 8. 代码变更范围

### 8.1 Phase 1（核心）

| 文件 | 改动 |
|---|---|
| **新增** `src/core/workspaceStore.ts` | workspaces.json + per-workspace 文件的 load/save/resolve API |
| **新增** `src/cli/commands/init.ts` | `forja init` 命令 |
| `src/cli/commands/types.ts` | 新增 WorkspaceConfig / TargetProfile 类型 + 翻译 key |
| `src/cli/commands/index.ts` | 新增 init 路由；workspace 解析改为 resolveWorkroot |
| `src/cli/commands/activeTarget.ts` | 改为从 workspaceStore 读写 |
| `src/cli/commands/useTarget/save.ts` | 改为写 per-workspace 文件 |
| `src/cli/commands/useTarget/detect.ts` | 改为从 workspaceStore 读 |
| `src/cli/commands/useTarget/index.ts` | switch/update 路径适配 |
| `src/cli/commands/candidates.ts` | 从 workspaceStore 读已保存 targets |
| `src/cli/commands/list.ts` | listTargets 适配 |
| `src/cli/commands/status.ts` | 适配 |
| `src/cli/commands/build.ts` | 适配 + createActionPlan 传参 |
| `src/cli/commands/run.ts` | 适配 |
| `src/cli/commands/clean.ts` | 适配 |
| `src/qt/shared/qtCore.ts` | createActionPlan 移除内部 loadQtSettings，使用传入参数 |

### 8.2 Phase 2（VSCode + 清理）

| 文件 | 改动 |
|---|---|
| `src/vscode/workspaceResolver.ts` | 简化为 workroot 匹配（见 §8.3） |
| `src/vscode/commands.ts` | resolveActiveTarget + _selectTarget 简化（见 §8.3） |
| `src/ui/statusBar.ts` | 去掉 domain config 同步，target 切换改为 workspaceStore（见 §8.3） |
| `src/ui/configPanel/messageHandler.ts` | 适配新 store |
| `src/core/settingsIO.ts` | 移除旧 target 相关类型和函数 |
| `src/qt/cli/index.ts` | 移除旧 CLI 入口 |

### 8.3 VSCode 侧详细设计

#### 8.3.1 Workroot 解析

`resolveProjectRoot()` 简化为：

```
1. 获取 VSCode 所有 workspace folders
2. 读取 ~/.forja/workspaces.json
3. 对每个 folder，在已注册 workroot 中找匹配
   匹配条件: folder 路径 === workroot 或 folder 是 workroot 的子目录
4. 返回 folder → workroot 映射表
```

**单 root workspace**：直接使用该 folder 对应的 workroot。

**Multi-root workspace**：每个 folder 独立关联一个 workroot。通过 active folder 决定当前操作哪个 workroot：

```
Active folder 判定优先级：
1. 当前活跃编辑器的文件属于哪个 folder
2. 如果无法判定 → 用第一个有匹配 workroot 的 folder
3. 用户可通过状态栏手动切换 active folder
```

状态栏显示 active folder 的 target 信息。命令操作 active folder 对应的 workroot。

不再扫描 `projects/*.json` 反查，不再浅层扫描 `.pro` 文件。

缓存失效：监听 `workspaces.json` 文件变化 + VSCode workspace folders 变化。

#### 8.3.2 Target 切换

当前流程：`forja._selectTarget` → `runList()` 列候选 → QuickPick → `runUseTarget()` 写入域配置 + activeTarget。

新流程：

```
forja._selectTarget
  1. resolveWorkroot(workspaceFolder) → 得到 workroot
  2. 从 per-workspace 文件读已保存 targets
  3. 扫描 workroot 下的 candidates
  4. 合并显示 QuickPick：
     - 已保存 targets（标记 * active、显示 name）
     - 未保存 candidates（标记 "new"）
  5. 用户选择：
     - 已保存 target → 更新 activeTarget 指针
     - 新 candidate → 走配置流程（工具链 + mode/arch）后保存
  6. 刷新状态栏 + IntelliSense
```

#### 8.3.3 模块切换

当前：`_syncActiveTarget(kind)` 从 Qt/SDK 域配置恢复 activeTarget，本质是重写 activeTarget 文件。

新模型下不再需要"模块切换"概念。所有 target（无论 Qt 还是 SDK）在同一个 workspace store 中。状态栏显示当前 active target 的信息，切换 target 时自动更新 kind。

如果仍需按 kind 过滤（如"只看 Qt 项目"），在 QuickPick 中加 filter 即可。

#### 8.3.4 状态栏更新

`showActions()` QuickPick 菜单改造：

```
── 当前目标 ──
 $(tools) {target.name} [{kind}] {mode} {arch}

── 切换目标 ──
 $(list-tree) 选择项目...

── 模式 ──
 $(bug) Debug x86 / Debug x64
 $(package) Release x86 / Release x64

── 构建 ──
 Build / Clean / QMake / RCC

── 执行位置 ──
 Local / Remote
```

模式切换直接更新 active target 的 mode/arch（写入 per-workspace 文件）。

#### 8.3.5 Config Panel 消息处理

当前 `messageHandler.ts` 中直接写 QtSettings + activeTarget 的消息需改为写 workspaceStore：

| 当前消息 | 当前行为 | 新行为 |
|---|---|---|
| `saveMode` / `saveArch` | 写 QtSettings + activeTarget | 更新 active target 的 mode/arch（per-workspace 文件） |
| `saveSdkMode` / `saveSdkArch` | 写 SdkSettings + activeTarget | 同上 |
| `saveManualProPath` | 写 QtSettings.manualProPath + activeTarget | manualProPath → qtModulePrefs；project → active target |
| `selectProject` / `selectSdkProject` | 调 `forja.list` | 调 `forja._selectTarget`（见 §8.3.2） |
| `generateIntelliSense` | 从 activeTarget 读 kind 决定生成路径 | 从 workspaceStore 读 active target |

#### 8.3.6 IntelliSense 配置

当前 `forja._selectTarget` 选择 target 后自动生成 `c_cpp_properties.json`（Qt → "Qt x86"，SDK → "SDK x86"）。

新模型下不变：选择 target 后仍自动生成。include paths 从 active target 的 toolchain 读取（qtPath 或 vsInstall）。Qt 和 SDK 的 IntelliSense 配置仍然双路共存，用户通过 VSCode 的 `C/C++: Select IntelliSense Configuration` 切换。

## 9. 验证计划

### 9.0 测试策略

本 initiative 不迁移旧配置测试，而是建立全新配置 fixture：

- 测试只初始化新的 `workspaces.json` + per-workspace 文件；
- 明确验证存在 `~/.forja/projects/` 时不会被读取；
- `createActionPlan` 测试必须传入完整参数，不允许旧配置回退；
- 旧类型和旧函数的测试不作为新契约依据，随旧代码清理删除或隔离。

### 9.1 单元测试

- workspaceStore: load/save/resolve
- resolveWorkroot: 前缀匹配、最深匹配、边界情况
- TargetProfile sanitize: 不信任 JSON

### 9.2 集成测试

- `forja init` → 检查 workspaces.json + per-workspace 文件内容
- `forja use target --project X` → activeTarget 切换正确
- `forja list targets` → saved + candidates 显示正确
- 从子目录运行 → workroot 解析正确
- 未注册目录运行 build → 报错 + 正确 nextAction
- `forja use target` 未注册 → 提示确认目录

### 9.3 Phase 2 手动验证

- VSCode 状态栏切换
- 配置面板读写
- workspace folder 变化时 workroot 解析

## 10. 执行顺序

### Phase 1

1. **WS-00**: 冻结 `forja init` 与新 JSON 契约
2. **WS-01**: workspaceStore core API + 类型定义
3. **WS-02**: resolveWorkroot 实现
4. **WS-03**: `forja init` 命令
5. **WS-04**: CLI target 命令迁移 (use/list/status)
6. **WS-05**: build/run/clean + createActionPlan 纯参数化

### Phase 2

7. **WS-06**: VSCode 首次初始化与生命周期
8. **WS-07**: multi-root 与 CMake
9. **WS-08**: remote 安全与 destructive action 防护
10. **WS-09**: 测试、CI、打包和文档
11. **WS-10**: 旧代码清理 + 验证
