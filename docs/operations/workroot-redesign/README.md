# Workroot Redesign: 基于显式 workroot 的 Target 管理重构

> Status date: 2026-07-16

This document serves as the overview for the current initiative. Granular backlog and status are split into the following operations documents:

- [Main Design](./workroot-redesign.md): complete design document
- [Execution Board](./workroot-redesign-board.md): single source of truth for backlog and status

## 1. Current Conclusion

- Primary goal: 用显式 workroot 替代 cwd 作为配置锚点，解决"从不同目录运行得到不同配置"的根本问题。
- Current assessment: **方案已确认，实施未完成**。仓库中存在部分 workspaceStore/init 实现，但在新契约下尚未通过完整的 CLI、VSCode、multi-root、CMake、remote 安全和打包验收。
- Implementation boundary: 本 initiative 采用全新配置切换；旧配置和旧命令不迁移、不兼容、不读取。已有部分实现不能直接视为完成，必须以本 initiative 的验收证据为准。

## 2. Key Design Decisions

1. **workroot 显式注册**：`forja init` 注册 workroot，所有命令从 cwd 向上查找已注册 workroot。
2. **不做任何兼容**：旧 CLI 入口、旧配置文件、QtSettings target 字段全部不读取，干净切割。
3. **不做数据迁移**：用户从零开始配置；旧文件保留在原处，但对新版本不可见。
4. **单一存储**：per-workspace 文件包含 targets + 模块偏好，QtSettings/SdkSettings 的 target 字段移除。
5. **createActionPlan 纯参数化**：调用方传入所有值，不再内部读 QtSettings。
6. **按产品闭环分阶段实施**：先冻结命令与存储契约，再完成 CLI/VSCode、multi-root、CMake、remote 安全、验证和文档收口。

## 3. Stage-Level Todo

### Phase 1: Contract + Canonical Store

1. WS-00: 冻结 `forja init` 与新 JSON 契约
2. WS-01: workspaceStore core API + 类型定义
3. WS-02: resolveWorkroot 实现
4. WS-03: `forja init` 命令
5. WS-04: CLI target 命令迁移 (use/list/status)
6. WS-05: build/run/clean + createActionPlan 纯参数化

### Phase 2: VSCode + Product Completion

7. WS-06: VSCode 首次初始化与生命周期
8. WS-07: multi-root 与 CMake
9. WS-08: remote 安全与 destructive action 防护
10. WS-09: 测试、CI、打包和文档
11. WS-10: 旧代码清理 + 验证

## 4. Execution Order

由 [Execution Board](./workroot-redesign-board.md) 中最高优先级的 `todo / in_progress` 工作包决定。
