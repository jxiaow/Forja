# 命令表面整理方案

> **状态：superseded（2026-07-16）。** 本文只保留早期“移除 setup 并并入 use target”的历史记录。当前新版本保留 `forja init` 作为全新配置入口；不读取旧配置、不兼容旧命令。实现计划以 `docs/superpowers/plans/2026-07-16-forja-greenfield-convergence.md` 为准。

> **历史状态**：设计中，待归档
> **日期**：2026-07-05
> **背景**：setup 无法适配多 target；全面审查发现多处不一致

---

## 1. 问题

### 1.1 setup 无法适配多 target

`forja setup` 的流程是单 target 思维：扫描 → 选一个 → 配工具链 → 保存。workspace 有 19 个 Qt target + 2 个 SDK target 时，只配一个，其余处于未配置状态。

| 问题 | 表现 |
|------|------|
| setup 只配一个 target | 其余 target 切换过去时缺工具链 |
| 再跑 setup 被幂等跳过 | 无法补配另一个 target |
| `--reset` 全清重来 | 代价太大，丢失已配好的 target |
| setup 和 use target 职责重叠 | 都是"选 target → 选 Qt → 选 VS → 选 mode/arch → 保存" |
| setup remote 是编排器 | 每一步都有对应命令可替代 |

### 1.2 命令表面不一致

全面审查 12 个顶层命令后发现多处风格不统一：

| 问题 | 示例 | 原则 |
|------|------|------|
| flag 当动作 | `remote --server X`、`sync --reset`、`run --custom <name>` | 动作应是 subcommand |
| 只读项混在 list | `list lang`（单值，不是列表） | list 只列举多项 |
| 无参数报错 | `forja use`（无 subcommand 直接报错） | 无参数 = 默认行为 |
| CLI 死代码 | `run --debug`（永远报错） | VSCode 侧有独立的 `forja.debug` 命令直接调 `startDebug()`，不经过 CLI |
| 残留引用 | `sync` JSON 输出推荐 `forja setup remote` | 删除 setup 后断链 |

---

## 2. 设计原则

1. **无参数 = 默认行为**：所有命令无参数时都有合理行为（显示/默认执行）
2. **位置 subcommand = 动作**：`build fresh`、`doctor fix`、`sync reset`
3. **flag = 修饰参数**：`--json`、`--plan`、`--detach`、`--file`
4. **list 只列举多项**：单值配置归 `use` 或 `status`
5. **管理命令自带列举**（git remote 模式）：`server` 无参数 = 列举
6. **命令间不重叠**：一个功能只有一个入口

---

## 3. 变化总览

### 3.1 删除

| 命令 | 理由 |
|------|------|
| `forja setup`（本地） | 职责合并入 `use target` |
| `forja setup remote` | 各步骤已有对应命令 |
| `--reset` flag（setup） | flags 直接覆盖单项 |
| `list lang` | 单值不是列表，`use lang` 已覆盖 |
| `run --debug` | CLI 永远报错，仅 VSCode 功能 |
| `sync --reset` flag | 改为 `sync reset` subcommand |

### 3.2 flag → subcommand

| 当前 | 改为 | 原因 |
|------|------|------|
| `remote --server X --remote-path Y` | `remote set --server X --remote-path Y` | flag-as-action → subcommand |
| `sync --reset` | `sync reset` | 和 `build fresh`、`doctor fix` 一致 |
| `run --custom <name>` | `run custom <name>` | 和 `run designer <file>` 一致 |

### 3.3 行为变更

| 命令 | 当前 | 改为 |
|------|------|------|
| `forja use`（无参数） | 报错 | 显示当前配置 |
| `sync` JSON 未配置时 | 推荐 `forja setup remote` | 推荐 `forja remote set` + `forja use execution --remote` |

### 3.4 命令表面变化

**之前（12 个顶层）**：
```
status  setup  list  use  remote  server  build  run  stop  clean  doctor  sync
```

**之后（11 个顶层）**：
```
status  list  use  remote  server  build  run  stop  clean  doctor  sync
```

---

## 4. 最终命令表面

```
forja status                              — 当前状态
forja list targets|env                    — 列举可选项
forja use [target|execution|lang]         — 选择配置（无参数=显示当前）
forja remote [set|restore|reset]          — 远程绑定 + 仓库恢复
forja server [add|update|remove]          — SSH 服务器池（无参数=列举）
forja build [fresh|qmake|rcc]             — 构建
forja run [custom|designer]               — 运行
forja stop                                — 停止
forja clean                               — 清理
forja doctor [fix|unlock]                 — 诊断与恢复
forja sync [plan|status|reset]            — 文件同步
```

所有命令统一模式：
- 无参数 = 默认行为（显示/默认执行）
- 位置 subcommand = 具体动作
- flag = 修饰参数

---

## 5. 逐命令规格

### 5.1 `forja status`

不变。只读，无 subcommand。

### 5.2 `forja list`

```bash
forja list targets                    # 列举目标项目
forja list env [qt|vs|jom|make]      # 列举工具链环境
```

**变化**：删除 `list lang`。语言查看通过 `forja use lang`（无参数显示当前值）。

### 5.3 `forja use`

```bash
forja use                             # 显示当前配置（target/execution/lang）
forja use target                      # 交互式引导选 target + 配工具链
forja use target --project <path>     # 切换 target
forja use target --mode debug         # 改 mode
forja use target --arch x64           # 改 arch
forja use target --qt-path <path>     # 改 Qt
forja use target --vs-install <path>  # 改 VS
forja use target --jom-path <path>    # 改 jom
forja use execution --local           # 切本地
forja use execution --remote          # 切远程
forja use lang [zh|en]               # 设置/查看语言
```

**变化**：
- 无参数时显示当前配置（不再报错）
- 吸收 setup 的检测+配置流程（详见第 6 节）
- 新增 `--jom-path` flag

### 5.4 `forja remote`

```bash
forja remote                                    # 显示当前远程绑定
forja remote set --server <name> --remote-path <path>  # 设置绑定
forja remote restore <repo> <paths...>          # 恢复远程文件
forja remote reset <repo> <paths...> [--all]    # 重置远程仓库
```

**变化**：`--server`/`--remote-path` 从 `remote` 的直接 flag 改为 `set` subcommand 的 flag。

### 5.5 `forja server`

```bash
forja server                          # 列举所有服务器
forja server --detail <id>            # 查看单个详情
forja server add                      # 添加
forja server update <id>              # 修改
forja server remove <id>              # 删除
```

不变。git remote 模式。

### 5.6 `forja build`

```bash
forja build                           # 默认构建
forja build fresh                     # 清理 + 构建
forja build qmake                     # 仅 qmake（Qt only）
forja build rcc                       # 仅 rcc（Qt only）
```

不变。

### 5.7 `forja run`

```bash
forja run                             # 运行当前目标
forja run custom <name>               # 运行自定义命令
forja run designer <ui-file>          # 启动 Qt Designer
forja run --detach                    # 后台运行
forja run --plan                      # 预览
```

**变化**：
- `--custom <name>` → `custom <name>`（flag → subcommand）
- 删除 `--debug`（CLI 不支持）

### 5.8 `forja stop`

不变。

### 5.9 `forja clean`

不变。

### 5.10 `forja doctor`

```bash
forja doctor                          # 检查模式
forja doctor fix [--remote] [--plan]  # 修复模式
forja doctor unlock <lockId>          # 释放锁
```

不变。

### 5.11 `forja sync`

```bash
forja sync                            # 交互式：plan → 确认 → 执行
forja sync plan                       # 只预览
forja sync status                     # 查看同步配置
forja sync reset                      # 清除同步状态
forja sync --file <path>              # 同步指定文件
forja sync --yes                      # 跳过确认
```

**变化**：
- `--reset` flag → `reset` subcommand
- 其余不变

---

## 6. `use target` 增强规格

### 6.1 语法

```bash
# 交互式引导（无 flag）
forja use target [--json] [--answers <path>]

# 精确覆盖（有 flag）
forja use target --project <path> [--json]
forja use target --qt-path <path> [--json]
forja use target --vs-install <path> [--json]
forja use target --jom-path <path> [--json]
forja use target --mode debug|release [--json]
forja use target --arch x86|x64 [--json]

# 组合
forja use target --project B --mode release [--jom-path <path>] [--json]
```

### 6.2 无 flag 行为（交互式引导）

**未配置时**（首次使用）：
1. 扫描工作区所有 target（Qt + SDK）
2. 检测工具链环境（Qt/VS/jom/make），获取版本号
3. 逐项引导（带步骤编号 `[1/N] [2/N] ...`）：
   - 选 target（多候选时）
   - 选 qmake TARGET（仅 `.pro` 文件，解析 `parseProFile` 获取默认值显示）
   - 选 Qt 路径（多安装时，显示版本号）
   - 选 VS 安装（多安装时，显示版本+版本年份）
   - 选 mode（debug/release）
   - 选 arch（仅 Windows，x86/x64）
4. 保存到 ActiveTarget + domain config + per-target toolchain
5. 输出配置摘要（含版本号）
6. 输出工具链缺失警告（Qt/VS/jom/make 未检测到时）

**已配置时**：
1. 显示当前 active target 完整配置（含版本号）：
   ```
   当前配置:
     Target:   qt apps/client/client.pro
     Qt:       C:\QtCompile\msvc2019-accessible (5.15.13)
     VS:       C:\...\2022\Community (2022)
     Mode:     release | x86
   ```
2. 逐项提示是否修改（或跳过保持原值）：
   - 每项显示当前值，用户可输入新值或回车跳过
   - 跳过的字段保持原值不变
3. 保存变更

**已配置 + 有 flag 时**：
- 只覆盖 flag 指定的字段，其余保持原值
- 不进入逐项修改流程

### 6.3 有 flag 行为（精确覆盖）

- 只更新显式传入的字段
- 未传 flag 的字段：已配置保持原值，未配置交互提示（交互模式）或返回 questions（JSON 模式）
- `--project` 切换 target 时：
  - 从 `targetToolchains` 恢复该 target 的工具链（含 qtPath/vsInstall/jomPath/qmakeTarget）
  - 没存过则检测环境后提示配置（交互模式逐项选，JSON 模式返回 questions）
  - 自动推断 kind（`.pro` → qt，`.sln`/`Makefile` → sdk）
- `--jom-path` 设置 jom 路径（Windows Qt 构建需要）
- `--project` 对 `.pro` 文件时，如果 target 没有存储的 qmakeTarget 且交互模式，提示输入 qmake TARGET

### 6.4 三种使用模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| 终端交互 | TTY，无 `--json` | prompt 收集，flags 值作为默认值 |
| 脚本 | `--json` + flags | 直接用 flags，跳过 questions |
| AI agent | `--json` 无 flags | 返回 `status: "needs-input"` + `questions`，用 `--answers <path>` 回传 |

### 6.5 交互规则

- 多选项（mode/arch/Qt/VS/target）有多个候选时**必须交互选择**，不静默默认
- 单选项自动选择
- 每个选择都有"跳过"选项
- flags 值作为对应 prompt 的默认值
- 已配置的字段显示当前值，跳过时保持原值

### 6.6 配置写入

与原 setup 一致，三层写入：
1. domain settings（Qt/Sdk）— pinnedProject、qtPath、vsInstall、jomPath、mode、arch、qmakeTarget
2. activeTarget — 当前活跃目标指针
3. targetToolchains — per-target 工具链快照

---

## 7. JSON 输出

### 7.1 成功

```json
{
  "ok": true,
  "action": "use",
  "useScope": "target",
  "workspace": "C:/repo",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "release",
    "arch": "x86",
    "runAt": "local"
  },
  "config": {
    "qt": {
      "qtPath": "C:\\QtCompile\\msvc2019-accessible",
      "qtVersion": "5.15.13",
      "vsInstall": "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community",
      "vsVersion": "2022"
    }
  },
  "changed": ["activeTarget", "qt.pinnedProject", "qt.qtPath", "qt.vsInstall", "qt.mode", "qt.arch"],
  "nextAction": "forja build"
}
```

### 7.2 需要输入

```json
{
  "ok": false,
  "action": "use",
  "useScope": "target",
  "status": "needs-input",
  "questions": [
    { "id": "target", "label": "选择目标项目", "choices": ["app (Qt) — src/app/app.pro", "lib (Qt) — src/lib/lib.pro"] },
    { "id": "qmakeTarget", "label": "qmake TARGET", "default": "app", "when": { "target": "*.pro" } },
    { "id": "qtPath", "label": "Qt 路径", "choices": ["D:/Qt/6.5.0/msvc2019_64", "D:/Qt/6.7.0/msvc2019_64"] },
    { "id": "vsInstall", "label": "VS 安装", "choices": ["C:/.../2022/Community"] },
    { "id": "jomPath", "label": "jom 路径", "default": "C:/Qt/Tools/jom.exe" },
    { "id": "mode", "label": "构建模式", "choices": ["debug", "release"] },
    { "id": "arch", "label": "目标架构", "choices": ["x86", "x64"] }
  ],
  "nextAction": "forja use target --json --answers <answers.json>"
}
```

---

## 8. 文本输出

### 8.1 首次配置成功

```
Forja use target
[1/4] Target:   qt apps/client/client.pro
[2/4] Qt:       C:\QtCompile\msvc2019-accessible (5.15.13)
[3/4] VS:       C:\...\2022\Community (2022)
[4/4] Mode:     release | x86

✓ 已配置:
  Target:   qt apps/client/client.pro
  Qt:       C:\QtCompile\msvc2019-accessible (5.15.13)
  VS:       C:\...\2022\Community (2022)
  Jom:      C:\QtCompile\Tools\jom.exe
  Mode:     release
  Arch:     x86
Next:
  forja build
```

### 8.2 切换 target

```
Forja use target
✓ 已切换到:
  Target:   sdk sdk/NemoSDK.sln
  VS:       C:\...\2022\Community (2022)
  Mode:     debug
  Arch:     x64
  (从 targetToolchains 自动恢复)
Next:
  forja build
```

### 8.3 已配置逐项修改（无 flag 交互模式）

```
$ forja use target

当前配置:
  Target:   qt apps/client/client.pro
  Qt:       C:\QtCompile\msvc2019-accessible (5.15.13)
  VS:       C:\...\2022\Community (2022)
  Mode:     release | x86

? Qt 路径 [C:\QtCompile\msvc2019-accessible]: ↵
? VS 安装 [C:\...\2022\Community]: ↵
? 构建模式 [release]: debug
? 目标架构 [x86]: ↵

✓ 已更新:
  Mode:     release → debug
Next:
  forja build
```

### 8.4 工具链缺失警告

```
Forja use target
✓ 已配置:
  Target:   qt apps/client/client.pro
  Qt:       C:\QtCompile\msvc2019-accessible (5.15.13)
  Mode:     release
  Arch:     x86

⚠ Visual Studio not found
⚠ jom not found
Next:
  forja doctor
```

### 8.5 `forja use` 无参数（显示当前配置）

```
Forja use
  Target:   qt apps/client/client.pro
  Qt:       C:\QtCompile\msvc2019-accessible (5.15.13)
  VS:       C:\...\2022\Community (2022)
  Mode:     release
  Arch:     x86
  Execution: local
  Language:  zh
```

---

## 9. setup remote 步骤归宿

| 原步骤 | 替代命令 | 说明 |
|--------|---------|------|
| 本地配置 | `forja use target` | 选 target + 配工具链 |
| 探测/创建服务器 | `forja server add`（已有） | 交互创建或 flag 创建 |
| 设置远程路径 | `forja remote set --server X --remote-path Y` | 写 remote settings |
| 启用同步 | `forja sync`（首次交互引导） | sync 未配置时自动引导 |
| 部署 forja 到远程 | `forja doctor fix --remote` | 检测 `$(npm prefix -g)/bin/forja`，不存在则 SCP bootstrap |
| 远程 init | `forja doctor fix --remote` | 通过 bridge 执行远程 `forja init` |
| 切换执行位置 | `forja use execution --remote`（已有） | 更新 activeTarget.runAt |
| 高级远程配置 | `forja use remote workspace/repo/forja-bin/build-order/transfer`（已有） | 低频操作 |

---

## 10. 与其他命令的边界

| 命令 | 职责 | use target 不做 |
|------|------|----------------|
| `list targets` | 只读枚举可选项 | 不扫描展示 |
| `list env` | 只读枚举工具链环境 | 不展示环境列表 |
| `use execution` | 切换 local/remote | 不改 runAt |
| `remote set` | 配置远程 server/path | 不配远程 |
| `server add` | 服务器池 CRUD | 不管 server |
| `doctor` | 深度健康验证 | 不做连通性检测 |
| `build` | 编译 | 不编译 |

---

## 11. 实现影响

### 11.1 删除文件

| 文件 | 说明 |
|------|------|
| `src/cli/commands/setup.ts` | setup 命令实现（Question 接口迁出后删除） |

### 11.2 修改文件

| 文件 | 变更 |
|------|------|
| `src/cli/commands/use.ts` | 吸收 setup 检测+配置流程；无参数时显示当前配置；移除 `import from './setup'` |
| `src/cli/commands/init.ts` | 核心逻辑迁入 use.ts，文件删除 |
| `src/cli/commands/index.ts` | 移除 setup 注册；remote 分发改 subcommand；sync `--reset` → `reset`；run `--custom` → `custom`；删除 `run --debug`；删除 `list lang` |
| `src/cli/commands/remote.ts` | `set` 改为位置 subcommand 触发（代码已有 `RemoteAction = 'set'`） |
| `src/cli/commands/sync.ts` | `--reset` flag → `reset` subcommand |
| `src/cli/commands/run.ts` | `--custom` flag → `custom` subcommand；删除 `--debug` |
| `src/cli/commands/list.ts` | 删除 `lang` 类别 |
| `src/cli/commands/types.ts` | 迁入 Question 接口；清理 setup 专属翻译键 |

### 11.3 不变文件

| 文件 | 说明 |
|------|------|
| `src/cli/commands/candidates.ts` | 目标扫描 |
| `src/cli/commands/activeTarget.ts` | active target 读写 |
| `src/cli/commands/status.ts` | 状态检查 |
| `src/cli/commands/build.ts` | 构建 |
| `src/cli/commands/stop.ts` | 停止 |
| `src/cli/commands/clean.ts` | 清理 |
| `src/cli/commands/doctor.ts` | 诊断 |
| `src/cli/commands/server.ts` | 服务器 CRUD |
| `src/core/settingsIO.ts` | 配置持久化 |
| `src/core/projectTypeDetector.ts` | 项目类型检测 |
| `src/qt/env/envDetector.ts` | 工具链环境检测 |

### 11.4 文档更新

| 文件 | 变更 |
|------|------|
| `docs/operations/command-consolidation/v2/setup.md` | 标记废弃或删除 |
| `docs/operations/command-consolidation/v2/use.md` | 更新 use target 规格 |
| `docs/operations/command-consolidation/v2/remote.md` | 更新 remote set subcommand |
| `docs/operations/command-consolidation/v2/run.md` | 更新 custom subcommand，删除 --debug |
| `docs/operations/command-consolidation/v2/sync.md` | 更新 reset subcommand |
| `docs/operations/command-consolidation/v2/list.md` | 删除 lang |
| `docs/operations/command-consolidation/v2/index.md` | 更新命令列表 |

### 11.5 VSCode 影响

| Command ID | 变更 |
|------------|------|
| `forja.setup` | 删除注册 + 从 `package.json` contributes 移除 |

### 11.6 代码清理清单

| 文件 | 问题 | 处理 |
|------|------|------|
| `use.ts` | `import type { Question } from './setup'` | Question 类型迁移到 `types.ts` |
| `use.ts` | `nextAction: 'forja setup'`（工具链未配置时） | 改为 `forja use target` 或 `forja doctor` |
| `sync.ts` | JSON 输出推荐 `forja setup remote` | 改为 `forja remote set` + `forja use execution --remote` |
| `index.ts` | setup 命令注册 + handleSetup 函数 | 删除 |
| `index.ts` | KEYWORD_SUGGESTIONS 中引用 `forja setup` | 更新为 `forja use target` |
| `types.ts` | setup 相关翻译键（约 50 个） | 保留 use target 需要的，删除仅 setup 使用的 |

### 11.7 Question 类型归属

当前 `Question` 接口定义在 `setup.ts`，被 `use.ts` 引用。删除 setup.ts 后：
- 将 `Question` 接口迁移到 `types.ts`（与 `Diagnostic`、`ForjaJsonResult` 同级）
- 更新所有 import

---

## 12. 迁移策略

### 12.1 实现顺序

1. 创建 `useTarget/` 目录，拆分 resolve/save/detect/report 四个模块（架构简化 13.2-13.5）
2. `use target` 增强：用新模块吸收 setup 逻辑，替换旧 `runUseTarget`
3. `index.ts` 模板消除（13.6），缩减分发器代码
4. `remote set` subcommand 改造
5. `sync reset` subcommand 改造
6. `run custom` subcommand 改造 + 删除 `--debug`
7. `use` 无参数显示当前配置
8. 删除 `list lang`
9. 删除 `setup.ts` + `init.ts` + 清理引用
10. 更新文档和翻译键

### 12.2 兼容性

- 旧 `forja setup` 不保留兼容别名——直接删除
- `remote --server` 不保留兼容——直接改为 `remote set --server`
- `sync --reset` 不保留兼容——直接改为 `sync reset`
- `run --custom` 不保留兼容——直接改为 `run custom`

---

## 13. 架构简化

当前 CLI 命令层 3748 行、394 个 if 分支。直接把 setup 合并到 use target 会让 `runUseTarget` 从 220 行膨胀到 500+ 行。必须在合并的同时做架构简化。

### 13.1 当前复杂度热点

| 文件 | 行数 | if 分支 | 核心问题 |
|------|------|---------|---------|
| `index.ts` | 1113 | 104 | 重复模板（unknown-flag 12x、port 验证 3x）、handleSetup 90 行 |
| `use.ts` | 598 | 59 | 工具链 4 路分支、Qt/SDK 双路保存 ×3 |
| `init.ts` | 650 | 91 | willPrompt* 组合爆炸（6 变量 × 64 种组合） |
| `setup.ts` | 1035 | 107 | runSetupRemote 400 行 7 步单体函数 |

### 13.2 Qt/SDK 双路统一

**问题**：`if (kind === 'qt') { ... } else { ... }` 在 use.ts 和 init.ts 中重复 6 次以上。

**解法**：提取统一保存函数，kind dispatch 只做一次：

```typescript
// 之前：调用方每次都做 kind 分支
if (kind === 'qt') {
    const qt = loadQtSettings(workspace);
    qt.pinnedProject = ...; qt.mode = ...; qt.arch = ...;
    saveQtSettings(workspace, qt);
} else {
    const sdk = loadSdkSettings(workspace);
    sdk.pinnedProject = ...; sdk.mode = ...; sdk.arch = ...;
    saveSdkSettings(workspace, sdk);
}

// 之后：统一接口，内部做一次 dispatch
function saveTargetFields(workspace: string, kind: 'qt' | 'sdk', fields: {
    project?: string; mode?: string; arch?: string;
    qtPath?: string; vsInstall?: string; jomPath?: string; qmakeTarget?: string;
}): void {
    if (kind === 'qt') {
        const qt = loadQtSettings(workspace);
        if (fields.project) qt.pinnedProject = { root: workspace, relative: fields.project };
        if (fields.mode) qt.mode = fields.mode;
        if (fields.arch) qt.arch = fields.arch;
        if (fields.qtPath) qt.qtPath = fields.qtPath;
        if (fields.vsInstall) qt.vsInstall = fields.vsInstall;
        if (fields.jomPath) qt.jomPath = fields.jomPath;
        if (fields.qmakeTarget) qt.target = fields.qmakeTarget;
        saveQtSettings(workspace, qt);
    } else {
        const sdk = loadSdkSettings(workspace);
        if (fields.project) sdk.pinnedProject = fields.project;
        if (fields.mode) sdk.mode = fields.mode;
        if (fields.arch) sdk.arch = fields.arch;
        if (fields.vsInstall) sdk.vsInstall = fields.vsInstall;
        saveSdkSettings(workspace, sdk);
    }
}
```

调用方不再关心 kind，传字段即可。同样模式应用于 load 和 update。

### 13.3 willPrompt* 组合爆炸 → 逐字段 resolve

**问题**：init.ts 的 6 个 `willPrompt*` 变量互相依赖，理论 64 种组合。

**解法**：每个字段独立 resolve 函数，互不依赖：

```typescript
// 之前：6 个 willPrompt 布尔变量 + 交叉依赖 + tracker 计数
const willPromptTarget = needTargetResolution && totalTargets > 1 && interactive && !project;
const willPromptQt = !qtPath && (reset || !existingQt.qtPath) && qtCandidates.length > 1 && interactive;
// ... 4 more

// 之后：每个字段独立 resolve，3 条路径
async function resolveTarget(candidates, existing, options): Promise<string> {
    if (options.project) return options.project;          // flag 指定
    if (existing && !options.reset) return existing;      // 已配置
    if (candidates.length === 1) return candidates[0];    // 单选项
    if (options.interactive) return await choose(...);    // 交互选
    return undefined; // → JSON 模式返回 question
}

async function resolveQtPath(detected, existing, options): Promise<string> {
    if (options.qtPath) return options.qtPath;
    if (existing?.qtPath && !options.reset) return existing.qtPath;
    if (detected.qtCandidates.length === 1) return detected.qtCandidates[0].path;
    if (options.interactive) return await choose(...);
    return undefined;
}

// mode、arch、vsInstall、jomPath 同理
```

每个 resolve 函数只有 3-4 条清晰路径，没有交叉依赖。主流程变成线性调用：

```typescript
const target = await resolveTarget(candidates, existing, options);
const qtPath = await resolveQtPath(detected, existing, options);
const vsInstall = await resolveVsPath(detected, existing, options);
const mode = await resolveMode(existing, options);
const arch = await resolveArch(existing, options);
```

### 13.4 工具链解析统一

**问题**：use.ts 中工具链解析有 4 路分支（stored / interactive / json / default），逻辑重复。

**解法**：统一为优先级链：

```typescript
function resolveToolchain(project: string, stored: TargetToolchainConfig | undefined,
    env: EnvDetection, options: ResolveOptions): { qtPath?: string; vsInstall?: string; jomPath?: string; questions?: Question[] } {

    // 优先级 1：已存储的工具链
    if (stored?.qtPath || stored?.vsInstall) return stored;

    // 优先级 2：flag 指定
    if (options.qtPath || options.vsInstall) return { qtPath: options.qtPath, vsInstall: options.vsInstall };

    // 优先级 3：环境单选项
    if (env.qtCandidates.length === 1 && env.vsCandidates.length === 1) {
        return { qtPath: env.qtCandidates[0].path, vsInstall: env.vsCandidates[0].installPath };
    }

    // 优先级 4：交互选择
    if (options.interactive) return promptToolchain(env);

    // 优先级 5：返回 questions
    return { questions: buildToolchainQuestions(env) };
}
```

5 条路径，按优先级排列，不嵌套。

### 13.5 单体函数拆分

**问题**：`runSetupRemote` 400 行 7 步，`runUseTarget` 220 行。

**解法**：合并 setup 后的 `runUseTarget` 拆为 4 个阶段函数：

```typescript
async function runUseTarget(workspace: string, options: UseTargetOptions): Promise<UseResult> {
    // Phase 1: Detect — 扫描 target + 检测工具链环境
    const ctx = await detectContext(workspace);

    // Phase 2: Resolve — 逐字段解析（13.3 的 resolve 函数）
    const resolved = await resolveAll(ctx, options);

    // Phase 3: Save — 统一保存（13.2 的统一接口）
    saveAll(workspace, resolved);

    // Phase 4: Report — 构建结果 + 摘要
    return buildResult(resolved, ctx);
}
```

每个阶段函数 50-100 行，独立可测试。

### 13.6 index.ts 模板消除

**问题**：每个 handler 重复 unknown-flag 校验（4 行 × 12 次）、outputResult + exitCode 模式。

**解法**：提取 handler 包装器：

```typescript
type Handler = (argv: string[], workspace: string, wantsJson: boolean) => Promise<ForjaJsonResult>;

function withValidation(knownFlags: Set<string>, flagsWithValues: Set<string>, handler: Handler): Handler {
    return async (argv, workspace, wantsJson) => {
        const unknown = findUnknownFlags(argv, knownFlags, flagsWithValues);
        if (unknown.length > 0) {
            return { ok: false, action: 'unknown', diagnostics: [diag('error', unknownFlagsMessage(unknown, knownFlags))] };
        }
        return handler(argv, workspace, wantsJson);
    };
}
```

每个 handler 只关注自己的逻辑，校验由包装器处理。

### 13.7 目标文件结构

```
src/cli/commands/
├── index.ts              — 纯分发，handler 用 withValidation 包装（~400 行，从 1113 行缩减）
├── types.ts              — 类型 + Question 接口 + 翻译键
├── use.ts                — use 命令（target/execution/lang）
├── useTarget/
│   ├── index.ts          — runUseTarget 入口（~50 行）
│   ├── detect.ts         — Phase 1: 扫描 + 环境检测（~80 行）
│   ├── resolve.ts        — Phase 2: 逐字段 resolve 函数（~150 行）
│   ├── save.ts           — Phase 3: 统一保存（~80 行）
│   └── report.ts         — Phase 4: 结果构建 + 文本格式化（~80 行）
├── remote.ts             — remote 命令（show/set/restore/reset）
├── server.ts             — server CRUD
├── build.ts              — 构建
├── run.ts                — 运行
├── stop.ts               — 停止
├── clean.ts              — 清理
├── doctor.ts             — 诊断
├── sync.ts               — 同步
├── list.ts               — 列举
├── status.ts             — 状态
├── candidates.ts         — 目标扫描
├── activeTarget.ts       — active target 读写
└── prompt.ts             — 交互工具
```

删除的文件：`setup.ts`、`init.ts`（逻辑拆分到 `useTarget/` 下）。

### 13.8 复杂度目标

| 指标 | 当前 | 目标 |
|------|------|------|
| 命令层总行数 | 3748 | ~2500 |
| 最大函数行数 | 400 (runSetupRemote) | <150 |
| if 分支密度 | 10.5/百行 | <7/百行 |
| Qt/SDK 双路重复 | 6 次 | 1 次（统一接口内部） |
| willPrompt* 变量 | 6 个交叉依赖 | 0（逐字段 resolve） |

---

## 14. 验证点

### setup 移除
- [ ] `forja use target`（无 flag）首次使用：扫描 → 检测 → 引导（带步骤编号）→ 保存 → 摘要（含版本号）
- [ ] `forja use target`（无 flag）已配置：显示当前值 → 逐项修改（跳过保持原值）
- [ ] `forja use target --project B`：切换 target + 恢复工具链（含 jomPath/qmakeTarget）
- [ ] `forja use target --project B`（未配过的 target）：切换 + 引导配工具链
- [ ] `forja use target --project app.pro`：提示输入 qmake TARGET（交互模式）
- [ ] `forja use target --jom-path <path>`：只改 jom 路径
- [ ] `forja use target --json`（未配置）：返回 questions（含 qmakeTarget/jomPath）
- [ ] 工具链缺失时输出警告（Qt/VS/jom/make）
- [ ] `forja setup` 命令不存在
- [ ] `forja setup remote` 命令不存在

### 命令表面整理
- [ ] `forja remote set --server X --remote-path Y` 正常工作
- [ ] `forja remote --server X`（无 set）报错并提示正确用法
- [ ] `forja sync reset` 正常工作
- [ ] `forja sync --reset` 报错并提示正确用法
- [ ] `forja run custom <name>` 正常工作
- [ ] `forja run --custom <name>` 报错并提示正确用法
- [ ] `forja run --debug` 不存在
- [ ] `forja use`（无参数）显示当前配置
- [ ] `forja list lang` 不存在
- [ ] `use.ts` 中无 `import from './setup'` 引用
- [ ] `use.ts` 中无 `nextAction: 'forja setup'`
- [ ] `sync.ts` 中无 `forja setup remote` 引用
- [ ] `index.ts` KEYWORD_SUGGESTIONS 中无 `forja setup` 引用
