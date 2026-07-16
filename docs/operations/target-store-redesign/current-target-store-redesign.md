# Target Store Redesign: 多 target 数据模型整改

> Status date: 2026-07-16

> **状态：已并入 workroot-redesign。** 本文保留数据模型讨论，但不再作为独立执行计划。新版本采用全新的 workspace store，不读取、不迁移、不兼容旧 target 配置。

This document serves as the overview for the current initiative. Granular backlog, verification records, and decision status are split into the following operations documents:

- [Execution Board](./target-store-redesign-board.md): single source of truth for backlog and status
- [Verification Matrix](./target-store-redesign-matrix.md): verification records for each work package
- [Decision Log](./target-store-redesign-decisions.md): decisions, deferred items, and reopen conditions

## 1. Current Conclusion

- Primary goal: 将当前分散的 target 状态收敛为 workspace 级 `targets` store，支持多个已保存 target，但同一时间只有一个激活 target。
- Current assessment: 现状里 `activeTarget`、Qt `pinnedProject`、SDK `pinnedProject`、`targetToolchains`、配置面板状态都能影响当前 target，事实源过多，导致 list/use/status/build/run 之间容易不一致。
- Current biggest issue: target 相关事实被拆散保存，且读写入口不统一。后续整改并入 workroot-redesign，由 canonical workspace store 作为唯一事实源。

## 2. Target Data Model

`targets` store 是 workspace 级配置文件。读写任何 target 之前必须先解析 workspace root。配置文件仍放在用户数据目录 `~/.forja/projects/`，文件名由 `workspace + type` hash 得到。

```json
{
  "workspace": "C:/Code/my-workspace",
  "type": "targets",
  "version": 1,
    "activeTargetId": "qt-app-debug-x64",
  "targets": {
    "qt-app-debug-x64": {
      "id": "qt-app-debug-x64",
      "name": "Qt App Debug x64",
      "kind": "qt",
      "project": "app/app.pro",
      "mode": "debug",
      "arch": "x64",
      "runAt": "local",
      "toolchain": {
        "qtPath": "C:/Qt/6.6.3/msvc2019_64",
        "qtVersion": "6.6.3",
        "vsInstall": "C:/Program Files/Microsoft Visual Studio/2022/Community",
        "jomPath": "C:/Qt/Tools/QtCreator/bin/jom/jom.exe",
        "qmakeTarget": "MyApp"
      }
    },
    "sdk-core-release-x64": {
      "id": "sdk-core-release-x64",
      "name": "SDK Core Release x64",
      "kind": "cpp",
      "project": "core/Core.sln",
      "mode": "release",
      "arch": "x64",
      "runAt": "local",
      "toolchain": {
        "vsInstall": "C:/Program Files/Microsoft Visual Studio/2022/Community"
      }
    }
  }
}
```

### Field Rules

- `workspace`: 配置归属的 workspace root。所有 target 的 `project` 默认相对此路径。
- `type`: 固定为 `targets`。
- `version`: schema 版本，初始为 `1`。
- `activeTargetId`: 唯一激活 target。允许为 `null`，表示尚未选择。
- `targets`: 已保存 target profile。扫描出来但未保存的项目只作为 candidate，不自动进入 store。
- `TargetProfile.id`: 稳定 ID，不要求和项目路径完全一致。建议由 kind/project/mode/arch 派生，冲突时追加短 hash。
- `TargetProfile.name`: UI 展示名，可由用户改名；默认由项目名 + mode + arch 生成。
- `TargetProfile.project`: workspace 相对路径；只有跨盘或 workspace 外项目才允许绝对路径。
- `TargetProfile.toolchain`: target 私有工具链快照。Qt target 可包含 Qt/VS/JOM/qmakeTarget，SDK target 通常只需要 VS。

### Ownership Rules

- target 相关字段只写入 `targets` store：`project`、`mode`、`arch`、`runAt`、`toolchain`、`qmakeTarget`。
- Qt settings 只保留 Qt 模块偏好：`qmakeArgs`、语言标准、designer、source path、RCC path、scan exclude、自定义命令、提醒开关。
- SDK settings 只保留 SDK 模块偏好：例如 `scanDepth`。
- `activeTarget`、Qt `pinnedProject`、SDK `pinnedProject`、`targetToolchains` 不再读取，也不进入迁移流程；它们只属于旧版本遗留格式。

## 3. Workspace Resolution Rule

所有 target 操作必须先得到 workspace root：

1. CLI 显式 `--workspace` 优先。
2. VSCode 使用当前 workspace folder / project root resolver。
3. CLI 无显式 workspace 时，从 cwd 向上解析到可作为 Forja workspace 的目录。
4. 找不到 workspace 时，不读写 target store；返回可操作诊断，引导用户指定 `--workspace` 或打开 workspace。

同一个项目文件在不同 workspace 下是不同 target。target store 不做跨 workspace 共享。

## 4. Stage-Level Todo

### Stage 1: TargetStore core（并入 WS-01）

- Goal: 在 canonical workspace store 中新增纯 Node.js target 读写 API，包含 schema sanitize、active target helper 和 ID 生成。
- Non-goal: 不读取旧配置，不做旧配置迁移，不改 `extension.ts` activate 签名。
- Completion criteria: 能从新 workspace 文件读写多个 target，旧 `projects/` 存在时行为不变。

### Stage 2: CLI target command migration（并入 WS-04）

- Goal: `list targets`、`use target`、`status`、`build`、`run` 改为通过 TargetStore 获取当前 target 和保存 target profile。
- Non-goal: 不新增复杂 profile 管理命令；先保持现有 `use target --project/mode/arch` 语义。
- Completion criteria: CLI 不再依赖 Qt/SDK `pinnedProject` 判定当前项目；全新 workspace 首次运行经 `forja init` 后可继续工作。

### Stage 3: VSCode UI migration

- Goal: 状态栏、配置面板、项目选择和 mode/arch 切换都改为读写 TargetStore。
- Non-goal: 不重做配置面板 UI，只收敛数据流。
- Completion criteria: UI 切 Qt/SDK 或切项目时只修改 `activeTargetId` 或对应 target profile，不再写旧 pinned 字段。

### Stage 4: Cleanup and legacy isolation（并入 WS-10）

- Goal: 清理 fallback 和旧字段读写路径，确保旧格式不会被新版本读取。
- Non-goal: 不自动删除用户旧配置文件，也不提供迁移命令。
- Completion criteria: 代码里没有新的 target 状态写入或读取旧 `activeTarget` / `pinnedProject` / `targetToolchains`；测试覆盖旧格式隔离。

## 5. Execution Order

1. TS-01: schema and TargetStore API
2. TS-02: migration from old config files
3. TS-03: CLI read/write migration
4. TS-04: VSCode status bar and config panel migration
5. TS-05: cleanup of legacy target writes
6. TS-06: verification and docs update

Current next item: determined by the highest-priority `todo / in_progress` work package at the top of the [Execution Board](./target-store-redesign-board.md).
