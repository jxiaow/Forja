# Execution Board

> Status date: 2026-07-16

This file is the single source of truth for the current initiative's backlog and status.

## Usage Rules

- Only advance one work package to closeable state at a time
- Work packages must have a fixed `ID`
- Status values: `todo` / `in_progress` / `done` / `blocked` / `deferred`
- After completion, must sync verification records

## Current Execution Order

1. WS-00: 冻结 `forja init` 与新 JSON 契约
2. WS-01: workspaceStore core API
3. WS-02: resolveWorkroot
4. WS-03: `forja init`
5. WS-04: CLI target 命令迁移
6. WS-05: createActionPlan 纯参数化
7. WS-06: VSCode 首次初始化与生命周期
8. WS-07: multi-root 与 CMake
9. WS-08: remote 安全与 destructive action 防护
10. WS-09: 测试、CI、打包和文档
11. WS-10: 旧代码清理 + 验证

## Work Packages

| ID | Priority | Status | Goal | Scope | Risk | Completion criteria | Dependencies | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WS-00 | P0 | done | 冻结 `forja init`、JSON envelope 和新存储路径 | CLI help、`docs/cli-interface-spec.md`、命令契约测试 | high | 文档、help、测试只描述新入口；旧 `setup` 不再作为当前契约 | none | — |
| WS-01 | P1 | done | workspaceStore 类型定义 + load/save API | `src/core/workspaceStore.ts`, workspace schema | high | 包含 schemaVersion、target/module/remote/sync 字段；只读写 `~/.forja/workspaces*`；旧 `projects/` 不被读取；损坏显式报错；16 个单测覆盖 | WS-00 | — |
| WS-02 | P1 | done | resolveWorkroot(cwd) 实现 | `src/core/workspaceStore.ts`, `src/vscode/workspaceResolver.ts` | medium | 从 cwd 向上查找已注册 workroot，最深前缀匹配；未注册返回可操作诊断；multi-root 上下文不默认取第一个 folder | WS-01 | — |
| WS-03 | P1 | done | `forja init` 命令 | `src/cli/commands/init.ts`, `src/cli/commands/index.ts` | high | 全新配置可完成注册、扫描、target 配置和写入 | WS-01, WS-02 | — |
| WS-04 | P1 | done | CLI target 命令迁移 | `src/cli/commands/useTarget/*`, `list.ts`, `status.ts`, `activeTarget.ts`, `candidates.ts`, `use.ts` | high | use/list/status 只从新 workspace store 读写 | WS-01, WS-02, WS-03 | — |
| WS-05 | P1 | done | build/run/clean + createActionPlan 纯参数化 | `src/cli/commands/build.ts`, `run.ts`, `clean.ts`, `src/qt/shared/qtCore.ts` | high | createActionPlan 不读旧 settings；所有值来自 active target/module prefs；15 个单测覆盖 | WS-04 | — |
| WS-06 | P1 | done | VSCode 首次初始化与生命周期 | `src/extension.ts`, `src/vscode/settingsStore.ts`, `workspaceResolver.ts`, `commands.ts` | high | 首次打开提示注册 workroot；promptToolchainIfNeeded 迁移到 settingsStore；C++ fallback 改用 getCppSetting | WS-03 | Extension Host smoke |
| WS-07 | P1 | done | multi-root 与 CMake | `src/vscode/*`, `src/core/cppProjectScanner.ts`, `package.json`, CMake build path | high | active folder 跟随活跃编辑器 ✅；CMake 扫描/构建链路完整 ✅；per-folder 独立 workroot ✅ | WS-06 | Extension Host smoke |
| WS-08 | P1 | done | remote 安全与 destructive action 防护 | `src/core/ssh.ts`, `src/core/serverStore.ts`, `src/cli/commands/index.ts` | high | host key 默认启用严格检查；remote reset/server remove 交互确认 + JSON 模式 --force | WS-04 | — |
| WS-09 | P1 | done | 测试、CI、打包和文档 | `src/test/*`, `scripts/build-cli.js`, `docs/*` | high | test 356/356 全绿 ✅；package:all 成功 ✅；v2 文档 kind:sdk 已修复 ✅；CLI hermetic ✅ | WS-05, WS-07, WS-08 | Extension Host smoke |
| WS-10 | P2 | done | 旧代码清理 + 验证 | `src/core/settingsIO.ts`, `src/cpp/cli/*`, `src/qt/cli/*`, dead routes | medium | loadQtSettings/saveQtSettings 移除；qt/cli index+args 删除；cpp/cli index+settings+requirements 删除；setupTitle 翻译修复；活跃文档 kind:sdk 修复 | WS-09 | — |

## Current Work Package Details

### 所有工作包已完成

WS-00 到 WS-10 全部标记为 done。

### 仍需手动验证的项目

- **Extension Host smoke**：在 VSCode 中验证"首次打开 → 修改 → 重启 → 状态仍存在"
- **WSL/remote smoke**：在受控 WSL/remote 环境中验证远程构建流程
