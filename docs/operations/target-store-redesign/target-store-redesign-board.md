# Execution Board

> **状态：deferred / superseded。** 本 initiative 已并入 `docs/operations/workroot-redesign/`。新版本不做旧配置迁移或兼容，以下工作包仅保留为历史决策记录，不再单独执行。

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
| TS-01 | P2 | deferred | 建立 workspace 级 TargetStore schema 和纯 IO API | 已并入 `workroot-redesign/WS-01` | — | 由 canonical workspace store 验收 | — | 不单独执行 |
| TS-02 | P2 | deferred | 从旧配置合成新 store | 不再执行 | — | 明确不做迁移 | — | 不执行 |
| TS-03 | P2 | deferred | CLI 改读 TargetStore | 已并入 `workroot-redesign/WS-04` | — | 由 canonical workspace store 验收 | — | 不单独执行 |
| TS-04 | P2 | deferred | VSCode UI 改读 TargetStore | 已并入 `workroot-redesign/WS-06` | — | 由 WorkspaceContext 验收 | — | 不单独执行 |
| TS-05 | P2 | deferred | 清理旧 target 写入路径 | 已并入 `workroot-redesign/WS-10` | — | 旧格式不读、不写 | — | 不单独执行 |
| TS-06 | P2 | deferred | 完整验证和文档同步 | 已并入 `workroot-redesign/WS-09` | — | 新契约验证通过 | — | 不单独执行 |

## Current Work Package Details

### TS-01（历史记录）

- Goal: 新增 target schema、load/save/sanitize、active target accessor、target ID helper。
- Current progress: 方案已并入 `workroot-redesign/WS-01`，不单独执行。

### TS-02（明确取消）

- Goal: 取消旧数据迁移。
- Decision: 新版本完全忽略旧 `activeTarget`、`pinnedProject`、`targetToolchains` 和旧 `projects/` 文件。
- Current progress: 已取消，保留本节作为决策记录。
