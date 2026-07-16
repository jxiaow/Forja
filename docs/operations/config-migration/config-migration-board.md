# Execution Board

> Status date: 2026-07-16

> **状态：superseded。** 本看板不再驱动实现。新版本不迁移、不兼容、不读取旧配置，执行顺序以 [`workroot-redesign-board.md`](../workroot-redesign/workroot-redesign-board.md) 为准。

## Historical Scope

本 initiative 曾计划把配置写入 `~/.forja/projects/<hash>.json`，并提供旧路径清理。该方案已取消：

- 新版本使用 `~/.forja/workspaces.json` 和 `~/.forja/workspaces/<hash>.json`；
- 旧 `~/.forja/projects/` 保留但完全忽略；
- 不执行旧格式迁移、字段合并或兼容 fallback；
- 不新增 `cleanup` 作为迁移流程。

## Work Packages

| ID | Status | Decision |
| --- | --- | --- |
| CM-01~CM-02 | deferred | 旧 projects 路径和平铺格式方案不再执行 |
| CM-03 | cancelled | 不做旧配置迁移 |
| CM-04~CM-09 | deferred | 由 canonical workspace store initiative 重新定义 |
| CM-10 | deferred | 不作为迁移辅助命令 |

Current next item: none; follow `docs/operations/workroot-redesign/`.
