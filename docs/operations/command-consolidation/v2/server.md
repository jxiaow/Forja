# `forja server`

[← 返回总览](index.md)

**职责**：管理共享 SSH server 池。server 不是 remote 或 sync 专属资源；remote execution 和 sync 只保存 server 引用和各自的 remote path。

**语法**：
```
forja server add --name <name> --host <host> --username <name> [--port <port>] [--auth-mode key|password] [--private-key-path <path>] [--password <password>] [--strict-host-key-checking|--no-strict-host-key-checking] [--json]
forja server update <id> [server fields...] [--json]
forja server remove <id> [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 查看 server 列表 | `forja list servers` |
| 查看 server 详情 | `forja list servers --detail <id>` |
| 添加/修改/删除共享 server | `forja server add/update/remove` |
| 配置 sync 使用哪个 server/path | `forja use sync --server <id> --remote-path <path>` |
| 配置 remote execution 使用哪个 server/path | `forja use remote --server <id> --remote-path <path>` |
| 测试 SSH 是否可用 | `forja doctor --remote --server <id>` |

## 行为

1. `server` 只管理 `~/.forja/servers.json`。
2. `add` 创建共享 server，返回生成的 `id`。
3. `update <id>` 只更新显式传入字段。
4. `remove <id>` 删除共享 server；不会自动清理 sync/remote 引用，引用方在 `status`/`doctor` 中报 `serverDeleted` 或 `serverNotFound`。
5. `password` 只用于写入当前 server 凭据；`list servers --detail` 不输出密码。
6. `server` 不负责绑定 sync/remote path，也不切换 `activeTarget.runAt`。

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja sync add-server` | `forja server add` |
| `forja sync update-server --server <id>` | `forja server update <id>` |
| `forja sync remove-server --server <id>` | `forja server remove <id>` |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.config.openPage` | `forja.server` / `forja.use` | 配置 UI 中的 server 管理动作走 `server`，绑定动作走 `use` |
| `forja.showSyncTab` | `forja.server` / `forja.use` / `forja.sync` | 远程页中的 server 管理由 `server` 承接 |

## Result

```ts
interface ServerResult extends ForjaJsonResult {
    action: 'server';
    serverAction: 'add' | 'update' | 'remove';
    server?: ServerDetail;
    removed?: string;
    changed: string[];
}
```

## 诊断码

| code | level | 触发条件 | nextActions |
|------|-------|----------|-------------|
| `server.nameMissing` | error | add 缺 name | `forja server add --name <name> --host <host> --username <name>` |
| `server.hostMissing` | error | add 缺 host | `forja server add --name <name> --host <host> --username <name>` |
| `server.usernameMissing` | error | add 缺 username | `forja server add --name <name> --host <host> --username <name>` |
| `server.notFound` | error | update/remove 指向不存在 server | `forja list servers` |
| `server.authInvalid` | error | auth-mode 与 key/password 字段不匹配 | `forja server update <id> ...` |
| `server.writeFailed` | error | 写 server store 失败 | 无 |

## 正常场景

```json
{
    "ok": true,
    "action": "server",
    "serverAction": "add",
    "server": { "id": "dev", "name": "dev", "host": "192.168.1.10", "port": 22, "username": "xw", "authMode": "key" },
    "changed": ["servers.dev"],
    "nextActions": ["forja use remote --server dev --remote-path <path>", "forja use sync --server dev --remote-path <path>"]
}
```

```json
{
    "ok": true,
    "action": "server",
    "serverAction": "remove",
    "removed": "dev",
    "changed": ["servers.dev"],
    "nextActions": ["forja list servers"]
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "server",
    "serverAction": "update",
    "changed": [],
    "diagnostics": [
        { "code": "server.notFound", "level": "error", "message": "Server does not exist: dev" }
    ],
    "nextActions": ["forja list servers"]
}
```

## 文本输出

```
Forja server added
Server: dev 192.168.1.10:22 xw key
Next:
  forja use remote --server dev --remote-path <path>
  forja use sync --server dev --remote-path <path>
```

## 验证点

- `forja server add --json` 写入共享 server store。
- `forja server update <id> --json` 只更新显式字段。
- `forja server remove <id> --json` 不自动修改 sync/remote 配置。
- `forja list servers --detail <id> --json` 可查看详情但不输出密码。
- 新 help、nextActions、Command Palette 不推荐旧 `sync add-server/update-server/remove-server`。
