# forja setup — 已废弃

> **状态**：已删除（2026-07-05）
> **替代**：`forja use target`（本地配置）、`forja remote set`（远程配置）

`forja setup` 命令已整体删除，包括 `forja setup`（本地）和 `forja setup remote`（远程）。

## 替代方案

| 原功能 | 替代命令 |
|--------|---------|
| 本地初始化（选 target + 配工具链） | `forja use target` |
| 远程初始化 | `forja remote set` + `forja use execution --remote` + `forja sync` |
| `--reset` 全量重配 | `forja use target --qt-path` 等 flags 直接覆盖 |

详见 `docs/operations/setup-removal.md`。
