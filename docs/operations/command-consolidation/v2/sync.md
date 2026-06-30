# `forja sync`

[← 返回总览](index.md)

**职责**：同步变更文件到远程。保留为顶层命令，因为同步是独立用户目标，不只是配置细节。

**语法**：
```
forja sync [--workspace <path>] [--file <path>] [--repo <name-or-path>] [--server <id>] [--json]
forja sync plan [--workspace <path>] [--file <path>] [--repo <name-or-path>] [--server <id>] [--json]
forja sync reset [--workspace <path>] [--json]
forja sync transfer [--workspace <path>] [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 上传变更文件 | `forja sync` |
| 预览上传计划 | `forja sync plan` |
| 清除同步状态 | `forja sync reset` |
| 执行 artifact transfer | `forja sync transfer` |
| 查看 sync readiness | `forja status` |
| 查看 servers | `forja list servers` |
| 配置 sync server/path | `forja use sync --server <id> --remote-path <path>` |
| 启用/禁用 sync | `forja use sync --enable` / `forja use sync --disable` |
| 测试 SSH | `forja doctor --remote` |
| 共享 server CRUD | `forja server add ...` / `forja server update <id> ...` / `forja server remove <id>` |

## 行为

1. 读取 sync 配置。
2. 缺少 sync server/remote path 时失败，不尝试 SSH，返回 `forja list servers` + `forja use sync --server <id> --remote-path <path>`。
3. `plan` 只输出计划，不上传、不删除远端文件。
4. `--file` 限定同步文件，可重复。
5. `--repo` 限定 repo 或覆盖单仓库远程路径。
6. `--server <id>` 只作为本次 run/plan 的临时 server 覆盖，不写 sync 配置。
7. `reset` 只清同步状态，不上传。
8. 如果配置启用 artifact transfer，`sync` 可在普通同步后执行传输；`sync plan` 只展示摘要。
9. `transfer` 单独执行已配置的 artifact transfer，对应旧 `remote transfer run`。
10. 同步失败不自动修改 server/path 配置。

## 吸收的旧命令

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja sync` | `forja sync` | 同名新命令，执行同步 |
| `forja sync --plan` | `forja sync plan` | 位置动作替代 flag-style action |
| `forja sync status` | `forja status` / `forja doctor --remote --server <id>` | 当前 sync readiness 归 status；指定 server 检查归 doctor |
| `forja sync use --server <id> --remote-path <path>` | `forja use sync --server <id> --remote-path <path>` | 配置 sync server/path |
| `forja sync use --enable` | `forja use sync --enable` | 启用 sync |
| `forja sync use --disable` | `forja use sync --disable` | 禁用 sync |
| `forja sync test-connection` | `forja doctor --remote [--server <id>]` | 诊断归 doctor |
| `forja sync reset` | `forja sync reset` | 同名新子动作 |
| `forja sync servers` | `forja list servers` | 枚举归 list |
| `forja sync server` | `forja list servers --detail <id>` | 枚举归 list |
| `forja sync add-server` | `forja server add` | 共享 server CRUD |
| `forja sync update-server --server <id>` | `forja server update <id>` | 共享 server CRUD |
| `forja sync remove-server --server <id>` | `forja server remove <id>` | 共享 server CRUD |
| `forja remote transfer run` | `forja sync transfer` | artifact transfer 执行 |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.syncChangedFiles` | `forja.sync` | Explorer 上下文同步动作 |
| `forja.syncTestConnection` | `forja.doctor` | 测试连接归 remote doctor；CLI/API 等价 `forja doctor --remote [--server <id>]` |
| `forja.showSyncTab` | `forja.use` / 配置 UI 内部动作 | 配置面板 tab 切换，不是公开 sync 命令 |

## Result

```ts
interface SyncResult extends ForjaJsonResult {
    action: 'sync';
    syncAction: 'run' | 'plan' | 'reset' | 'transfer';
    plan?: SyncPlan;
    server?: string;
    remotePath?: string;
    uploaded?: string[];
    deleted?: string[];
    skipped?: string[];
    transfer?: {
        configured: boolean;
        planned?: boolean;
        executed?: boolean;
        artifacts?: string[];
    };
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

| code | level | 触发条件 | nextActions |
|------|-------|----------|-------------|
| `sync.notConfigured` | error | 未配置 sync server 或 remote path | `forja list servers`, `forja use sync --server <id> --remote-path <path>` |
| `sync.serverDeleted` | error | sync 配置引用的 server 已不存在 | `forja list servers`, `forja use sync --server <id> --remote-path <path>` |
| `sync.serverNotFound` | error | `--server` 指向不存在 server | `forja list servers` |
| `sync.noChanges` | info | 没有待同步变更 | `forja status` |
| `sync.fileNotFound` | error | `--file` 指向不存在文件 | 无 |
| `sync.repoNotFound` | error | `--repo` 不存在或未映射 | `forja list remote-repos` |
| `sync.remoteBlocked` | error | SSH/路径/权限失败 | `forja doctor --remote` |
| `sync.transferFailed` | error | artifact transfer 失败 | `forja list remote`, `forja doctor --remote` |

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
    "nextActions": ["forja sync"]
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
    "transfer": { "configured": false },
    "nextActions": ["forja status"]
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "sync",
    "syncAction": "run",
    "diagnostics": [
        { "code": "sync.notConfigured", "level": "error", "message": "Sync server or remote path is not configured" }
    ],
    "nextActions": ["forja list servers", "forja use sync --server <id> --remote-path <path>"]
}
```

## 文本输出

```
Forja sync plan
Server: dev
Remote path: /home/xw/workspace/app
Pending:
  src/main.cpp
Next:
  forja sync
```

```
Forja sync succeeded
Uploaded: 1
Deleted: 0
Skipped: 0
Next:
  forja status
```

## 验证点

- `forja sync plan --json` 不上传文件。
- `forja sync plan` 是新位置动作；实现时必须在 sync parser 中新增 `plan` 子命令。
- `forja sync transfer --json` 覆盖旧 `forja remote transfer run`。
- `forja sync --server <id> --json` 临时覆盖本次同步 server，不写配置。
- `forja sync --file <path> --json` 只同步指定文件。
- 缺 server/path 时不尝试 SSH。
- server CRUD 不出现在 `sync`，统一由共享入口 `forja server add` / `forja server update <id>` / `forja server remove <id>` 承接；remote 和 sync 只引用 server。
