# `forja sync`

[← 返回总览](index.md)

**职责**：同步变更文件到远程。

**语法**：
```
forja sync [--yes] [--reset] [--file <path>] [--json]
forja sync plan [--file <path>] [--json]
forja sync status [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 上传变更文件 | `forja sync` |
| 预览上传计划 | `forja sync plan` |
| 清除同步状态 | `forja sync --reset` |
| 查看 sync 配置状态 | `forja sync status` |
| 配置 sync server/path | `forja setup remote`（一次性配置） |
| 查看 sync 完整状态 | `forja status`（sync 区块包含 server/port/auth 详情） |
| 查看 servers | `forja server` |
| 测试 SSH | `forja doctor --remote` |
| 共享 server CRUD | `forja server add ...` / `forja server update <id> ...` / `forja server remove <id>` |

## 行为

1. 读取 sync 配置。
2. 缺少 sync server/remote path 时，返回错误 + `nextAction: "forja setup remote"`。sync 不修改配置。
3. `plan` 只输出计划，不上传、不删除远端文件。
4. `--reset` 只清同步状态，不上传。不能与 `plan` 子命令或其他位置参数同时使用。
5. `--yes` 跳过交互确认直接执行（脚本/自动化场景）。
6. `--file <path>` 同步指定文件（可重复）。本地存在则上传，不存在则删除远端副本。指定的文件在所有 git root 中均未找到时报错。
7. 默认交互流程：plan → 显示摘要 → 确认 [y/N] → execute。确认后的执行复用 plan 阶段的分类结果，不重复调用 git status。
8. `--json` 模式直接执行，不弹确认。
9. 同步失败不自动修改 server/path 配置。
10. `status` 显示当前 sync 配置状态（enabled、server 详情、remotePath、ignore 列表）。

## 已移除的功能

| 移除项 | 替代方案 |
|--------|----------|
| `forja sync reset`（子命令形式） | `forja sync --reset` |
| `forja sync transfer` | 概念不属于文件同步，核心函数保留在 `remote/core/transfer.ts` |
| `--repo <name>` | 自动处理所有 git 仓库 |
| `--server <name>` / `--remote-path <path>` | `forja setup remote` 配置，`forja sync` 只读配置 |
| `forja use sync` CLI 入口 | `forja setup remote` 一步完成配置 |

## 吸收的旧命令

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja sync` | `forja sync` | 同名新命令，执行同步 |
| `forja sync --plan` | `forja sync plan` | 位置动作替代 flag-style action |
| `forja sync status` | `forja status` | sync 状态合并到全局 status |
| `forja sync reset` | `forja sync --reset` | flag 替代子命令 |
| `forja sync transfer` | （移除） | 不属于 sync 职责 |
| `forja sync use --server <id> --remote-path <path>` | `forja use sync --server <id> --remote-path <path>` | 配置 sync server/path |
| `forja sync use --enable` | `forja use sync --enable` | 启用 sync |
| `forja sync use --disable` | `forja use sync --disable` | 禁用 sync |
| `forja sync test-connection` | `forja doctor --remote [--server <id>]` | 诊断归 doctor |
| `forja sync servers` | `forja server` | 枚举归 list |
| `forja sync add-server` | `forja server add` | 共享 server CRUD |
| `forja sync update-server --server <id>` | `forja server update <id>` | 共享 server CRUD |
| `forja sync remove-server --server <id>` | `forja server remove <id>` | 共享 server CRUD |
| `forja remote transfer run` | （移除） | 不属于 sync 职责 |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.syncChangedFiles` | `forja.sync` | Explorer 上下文同步动作 |
| `forja.syncTestConnection` | `forja.doctor` | 测试连接归 remote doctor |
| `forja.showSyncTab` | `forja.use` / 配置 UI 内部动作 | 配置面板 tab 切换 |

## Result

```ts
interface SyncResult extends ForjaJsonResult {
    action: 'sync';
    syncAction: 'run' | 'plan' | 'reset' | 'status';
    plan?: SyncPlan;
    server?: string;
    remotePath?: string;
    uploaded?: string[];
    deleted?: string[];
    skipped?: string[];
    // status fields
    enabled?: boolean;
    serverDetail?: { name: string; host: string; username: string; port: number };
    ignore?: string[];
}

interface SyncPlan {
    mode: 'dryRun';
    server: string;
    remotePath: string;
    repos: string[];
    pending: string[];
    deleted: string[];
    skipped: string[];
    skippedDetails?: Array<{ file: string; reason: string }>;
}
```

## 诊断码

| code | level | 触发条件 | nextAction |
|------|-------|----------|------------|
| `sync.notEnabled` | error | 同步未启用 | `forja sync` |
| `sync.notConfigured` | error | 未配置 sync server | `forja sync` |
| `sync.serverNotFound` | error | 配置的 server 不存在 | `forja sync` |
| `sync.noRemotePath` | error | 未配置远程路径 | `forja sync --server <name> --remote-path <path>` |
| `sync.passwordRequired` | error | 密码模式未提供密码 | `FORJA_SSH_PASSWORD=<password> forja sync` |
| `sync.noGitRepos` | error | 工作区无 git 仓库 | `forja status` |
| `sync.filesNotFound` | error | `--file` 指定的文件在所有 git root 中均未找到 | `forja sync --file <path>` |
| `sync.remoteBlocked` | error | SSH/路径/权限失败 | `forja doctor --remote` |

## 正常场景

```json
{
    "ok": true,
    "action": "sync",
    "syncAction": "plan",
    "server": "dev",
    "remotePath": "/home/xw/workspace/app",
    "plan": {
        "mode": "dryRun",
        "server": "dev",
        "remotePath": "/home/xw/workspace/app",
        "repos": ["app"],
        "pending": ["src/main.cpp"],
        "deleted": [],
        "skipped": []
    },
    "nextAction": "forja sync"
}
```

```json
{
    "ok": true,
    "action": "sync",
    "syncAction": "run",
    "server": "dev",
    "remotePath": "/home/xw/workspace/app",
    "uploaded": ["src/main.cpp"],
    "deleted": [],
    "skipped": [],
    "nextAction": "forja status"
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "sync",
    "syncAction": "plan",
    "diagnostics": [
        { "level": "error", "message": "Plan failed: No sync server configured" }
    ],
    "nextAction": "forja doctor --remote"
}
```

## 文本输出

```
Sync plan (dry run)
  Server: dev
  Remote path: /home/xw/workspace/app
  Pending (1):
    src/main.cpp
Next:
  forja sync
```

```
Sync complete
  Server: dev
  Remote path: /home/xw/workspace/app
  Uploaded (1):
    src/main.cpp
Next:
  forja status
```

## 验证点

- `forja sync plan --json` 不上传文件。
- `forja sync --reset --json` 清除同步状态。
- `forja sync --yes --json` 跳过确认直接执行。
- `forja sync status` 返回当前 sync 配置状态。
- `forja sync plan --reset` 返回 reset 冲突错误。
- `forja sync --file <不存在的文件>` 返回 filesNotFound 错误。
- `forja status` 的 sync 区块显示 username@host:port 和 authMode。
- 缺 server/path 时不尝试 SSH。
