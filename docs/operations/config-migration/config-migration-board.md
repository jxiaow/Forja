# Execution Board

> Status date: 2026-06-09

## Current Execution Order

1. CM-01: settingsIO 路径改造
2. CM-02: 配置格式平铺化
3. CM-03: 旧配置自动迁移
4. CM-04: sync 向上查找逻辑
5. CM-05: workspaceResolver 适配
6. CM-06: qtCore init 适配
7. CM-07: sdk cli init 适配
8. CM-08: settingsStore (VSCode) 适配
9. CM-09: 去除项目目录旧配置目录创建
10. CM-10: cleanup 命令

## Work Packages

| ID    | Priority | Status | Goal | Scope | Risk | Completion criteria | Dependencies | Next step |
|-------|----------|--------|------|-------|------|---------------------|--------------|-----------|
| CM-01 | P1 | done | 配置路径改为 ~/.forja/projects/<hash>.json | settingsIO.ts | medium | 读写新路径，hash 基于完整 workspace 路径 | none | — |
| CM-02 | P1 | done | 去除 qt/sdk/sync 前缀分组，平铺存储 | settingsIO.ts | medium | 每个文件只含一种配置，字段平铺 | CM-01 | — |
| CM-03 | ~~removed~~ | ~~done~~ | ~~旧配置迁移~~ | — | — | 不需要兼容，直接切新路径 | — | — |
| CM-04 | P2 | done | sync 读取时向上一级查找 | settingsIO.ts / syncCli.ts | medium | 子目录没有 sync 配置时从父目录读取 | CM-02 | — |
| CM-05 | P1 | done | workspaceResolver 不再决定配置存储位置 | workspaceResolver.ts | low | 只负责解析项目根目录，不影响配置路径 | CM-01 | — |
| CM-06 | P1 | done | qt init 写入新路径 | qtCore.ts | medium | init 后配置出现在 ~/.forja/projects/ | CM-02 | — |
| CM-07 | P1 | done | sdk init 写入新路径 | sdk/cli/index.ts, sdk/cli/settings.ts | medium | init 后配置出现在 ~/.forja/projects/ | CM-02 | — |
| CM-08 | P2 | done | VSCode settingsStore 适配新路径 | settingsStore.ts | medium | 文件监听指向新路径，读写 API 不变 | CM-01 | — |
| CM-09 | P2 | done | init 不再创建项目目录下旧配置目录 | qtCore.ts, localState.ts | low | ensureLocalStateDir 不创建旧配置目录；gitignore no-op | CM-06, CM-07 | — |
| CM-10 | P3 | done | forja cleanup 命令 | cli/cleanup.ts | low | 能列出并删除无效配置 | CM-01 | — |

## Current Work Package Details

### CM-01

- Goal: 实现 `projectConfigPath(workspace: string): string`，返回 `~/.forja/projects/<sha256-12>.json`
- Not doing this round: 不改 load/save 的接口签名
- Current progress: done
