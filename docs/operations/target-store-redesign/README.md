# Target Store Redesign

本目录记录多 target 数据模型整改方案。

- [Current Plan](./current-target-store-redesign.md)
- [Execution Board](./target-store-redesign-board.md)
- [Verification Matrix](./target-store-redesign-matrix.md)
- [Decision Log](./target-store-redesign-decisions.md)

核心结论：Forja 应以 workspace 为命名空间，持久化多个 target profile，并通过唯一 `activeTargetId` 表达当前激活 target。
