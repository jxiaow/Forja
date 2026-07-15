# Workroot Redesign: 基于显式 workroot 的 Target 管理重构

> Status date: 2026-07-15

This document serves as the overview for the current initiative. Granular backlog and status are split into the following operations documents:

- [Main Design](./workroot-redesign.md): complete design document
- [Execution Board](./workroot-redesign-board.md): single source of truth for backlog and status

## 1. Current Conclusion

- Primary goal: 用显式 workroot 替代 cwd 作为配置锚点，解决"从不同目录运行得到不同配置"的根本问题。
- Current assessment: **已完成**。所有 8 个工作包已实现，TypeScript 编译通过。
- Implementation summary: 新增 `src/core/workspaceStore.ts` 和 `forja init` 命令，所有 CLI/VSCode 命令已迁移到 workspaceStore，`createActionPlan` 改为纯参数化。

## 2. Key Design Decisions

1. **workroot 显式注册**：`forja init` 注册 workroot，所有命令从 cwd 向上查找已注册 workroot。
2. **不做任何兼容**：旧 CLI 入口、旧配置文件、QtSettings target 字段全部移除，干净切割。
3. **不做数据迁移**：用户从零开始配置。
4. **单一存储**：per-workspace 文件包含 targets + 模块偏好，QtSettings/SdkSettings 的 target 字段移除。
5. **createActionPlan 纯参数化**：调用方传入所有值，不再内部读 QtSettings。
6. **分两阶段实施**：Phase 1 核心 CLI + 存储，Phase 2 VSCode 侧 + 清理。

## 3. Stage-Level Todo

### Phase 1: Core CLI + Storage

1. WS-01: workspaceStore core API + 类型定义
2. WS-02: resolveWorkroot 实现
3. WS-03: `forja init` 命令
4. WS-04: CLI target 命令迁移 (use/list/status)
5. WS-05: build/run/clean + createActionPlan 纯参数化
6. WS-06: Phase 1 验证

### Phase 2: VSCode + Cleanup

7. WS-07: VSCode 侧迁移
8. WS-08: 旧代码清理 + 验证

## 4. Execution Order

由 [Execution Board](./workroot-redesign-board.md) 中最高优先级的 `todo / in_progress` 工作包决定。
