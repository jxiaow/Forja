# Execution Board

> Status date: 2026-07-14

This file is the single source of truth for the current initiative's backlog and status.

## Usage Rules

- Only advance one work package to closeable state at a time
- Work packages must have a fixed `ID`
- Status values: `todo` / `in_progress` / `done` / `blocked` / `deferred`
- After completion, must sync verification records

## Current Execution Order

1. WS-01: workspaceStore core API
2. WS-02: resolveWorkroot
3. WS-03: `forja init`
4. WS-04: CLI target 命令迁移
5. WS-05: createActionPlan 纯参数化
6. WS-06: Phase 1 验证
7. WS-07: VSCode 侧迁移
8. WS-08: 旧代码清理 + 验证

## Work Packages

| ID | Priority | Status | Goal | Scope | Risk | Completion criteria | Dependencies | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WS-01 | P1 | done | workspaceStore 类型定义 + load/save API | `src/core/workspaceStore.ts` (新增) | high | 可读写 workspaces.json 和 per-workspace 文件；sanitize 不信任 JSON | none | — |
| WS-02 | P1 | done | resolveWorkroot(cwd) 实现 | `src/core/workspaceStore.ts` | medium | 从 cwd 向上查找已注册 workroot，最深前缀匹配 | WS-01 | — |
| WS-03 | P1 | done | `forja init` 命令 | `src/cli/commands/init.ts` (新增), `src/cli/commands/index.ts` | high | 注册 workroot，扫描项目，配置 target，写入 per-workspace 文件 | WS-01, WS-02 | — |
| WS-04 | P1 | done | CLI target 命令迁移 | `src/cli/commands/useTarget/*`, `list.ts`, `status.ts`, `activeTarget.ts`, `candidates.ts`, `use.ts` | high | use/list/status 改为从 workspaceStore 读写 | WS-01, WS-02, WS-03 | — |
| WS-05 | P1 | done | build/run/clean + createActionPlan 纯参数化 | `src/cli/commands/build.ts`, `run.ts`, `clean.ts`, `src/qt/shared/qtCore.ts` | high | createActionPlan 不再内部读 QtSettings，调用方传入所有值 | WS-04 | — |
| WS-06 | P1 | done | Phase 1 验证 | tests | medium | TypeScript 编译通过，0 错误 | WS-05 | — |
| WS-07 | P2 | done | VSCode 侧迁移 | `src/vscode/workspaceResolver.ts`, `commands.ts`, `src/ui/statusBar.ts`, `src/ui/configPanel/messageHandler.ts`, `src/qt/project/projectManager.ts` | high | 状态栏、配置面板、workspace 解析全部改用 workspaceStore | WS-06 | — |
| WS-08 | P2 | done | 旧代码清理 + 验证 | `src/core/settingsIO.ts`, 旧类型 | medium | 移除旧 target 相关代码，TypeScript 编译通过 | WS-07 | — |

## Current Work Package Details

### WS-01

- Goal: 新增 `src/core/workspaceStore.ts`，定义 WorkspaceConfig / TargetProfile 类型，实现 workspaces.json 和 per-workspace 文件的 load/save/sanitize API。
- Not doing this round: 不迁移旧配置，不改任何命令。
- Current progress: 方案已落盘，尚未实现。
