# Execution Board

> Status date: 2026-07-09

This file is the single source of truth for the current initiative's backlog and status.

## Usage Rules

- Only advance one work package to closeable state at a time
- Work packages must have a fixed `ID`
- Status values: `todo` / `in_progress` / `done` / `blocked` / `deferred`
- After completion, must sync [Verification Matrix](./target-store-redesign-matrix.md)
- If new architectural conclusions, deferred items, or reopen conditions arise, must sync [Decision Log](./target-store-redesign-decisions.md)

## Current Execution Order

1. TS-01: TargetStore schema and core API
2. TS-02: Legacy config migration
3. TS-03: CLI migration
4. TS-04: VSCode UI migration
5. TS-05: Legacy write cleanup
6. TS-06: Verification and documentation

## Work Packages

| ID | Priority | Status | Goal | Scope | Risk | Completion criteria | Dependencies | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TS-01 | P1 | todo | 建立 workspace 级 TargetStore schema 和纯 IO API | `src/core/settingsIO.ts` 或 `src/core/targetStore.ts` | high | 可读写 `targets` store；sanitize 不信任 JSON；导出 active target helper | none | 写接口和测试计划 |
| TS-02 | P1 | todo | 从旧配置合成新 store | `core/settingsIO`、旧 `activeTarget`、Qt/SDK settings、`targetToolchains` | high | 旧用户配置首次读取能得到等价 active target 和 profiles | TS-01 | 定义迁移优先级 |
| TS-03 | P1 | todo | CLI 改读 TargetStore | `src/cli/commands/*`、`useTarget/*` | high | `list/use/status/build/run` 不再以 pinnedProject 作为当前项目来源 | TS-01, TS-02 | 从 `requireActiveTarget` 收口 |
| TS-04 | P2 | todo | VSCode UI 改读 TargetStore | `src/ui/statusBar.ts`、`src/ui/configPanel/*`、settingsStore watcher | high | 状态栏切换、配置面板保存 mode/arch/qmakeTarget 都写 target profile | TS-03 | 找 UI 写旧字段入口 |
| TS-05 | P2 | todo | 清理旧 target 写入路径 | Qt/SDK settings writers、fallback helpers | medium | 不再新增写入 `activeTarget`、`pinnedProject`、`targetToolchains` | TS-04 | 标记兼容入口 |
| TS-06 | P1 | todo | 完整验证和文档同步 | tests、README、CLI spec | medium | 迁移、CLI、UI 数据流都有测试或明确手工验证记录 | TS-05 | 补测试矩阵 |

## Current Work Package Details

### TS-01

- Goal: 新增 `TargetStore` schema、load/save/sanitize、active target accessor、target ID helper。
- Not doing this round: 不迁移所有 CLI/UI 调用点。
- Current progress: 方案已落盘，尚未实现。

### TS-02

- Goal: 定义并实现旧数据迁移优先级。
- Migration priority:
  1. 旧 `activeTarget` 生成 active profile。
  2. Qt `pinnedProject` 生成 Qt profile。
  3. SDK `pinnedProject` 生成 SDK profile。
  4. `targetToolchains[project]` 补充对应 profile 的 toolchain。
  5. 若多个旧来源指向同一 project/mode/arch，合并为一个 profile。
- Not doing this round: 不删除旧 JSON 文件。
- Current progress: 方案已确定，尚未实现。
