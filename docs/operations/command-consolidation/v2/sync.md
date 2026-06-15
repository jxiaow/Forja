# `forja sync`

[← 返回总览](index.md)

**职责**：同步变更文件到远程。保留为顶层命令，因为同步是独立用户目标。

**语法**：
```
forja sync [--workspace <path>] [--file <path>] [--repo <name-or-path>] [--json]
forja sync plan [--workspace <path>] [--file <path>] [--repo <name-or-path>] [--json]
forja sync reset [--workspace <path>] [--json]
```

**行为**：
1. 读取 sync 配置。
2. 缺少 server/remote path 时失败，不尝试 SSH，返回 `forja list servers` + `forja use --server`。
3. `plan` 只输出计划。
4. `--file` 限定同步文件（可重复）。
5. `--repo` 限定 repo 或覆盖单仓库远程路径。
6. `reset` 只清状态，不上传。
7. 如果配置启用 artifact transfer，sync 可在普通同步后执行传输；`sync plan` 只展示摘要。

**从主帮助移除的旧命令**：
`forja sync use`、`forja sync servers`、`forja sync server`、`forja sync add-server`、`forja sync update-server`、`forja sync remove-server`、`forja sync test-connection`

Server CRUD 迁移期保留为兼容命令。新用户不通过 `sync` 接触 server CRUD。

**Result**：
```ts
interface SyncResult extends ForjaJsonResult {
    action: 'sync';
    syncAction: 'run' | 'plan' | 'reset';
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
