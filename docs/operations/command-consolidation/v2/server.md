# `forja server`

[← 返回总览](index.md)

**职责**：管理共享 SSH 服务器池。CRUD 操作。服务器不归 remote 或 sync 专属，二者只引用 server。

**语法**：
```
forja server                              # 列出所有服务器
forja server --detail <id>                # 查看服务器详情
forja server add --name <name> --host <host> --username <user> [--port <port>] [--auth-mode key|password] [--private-key-path <path>] [--password <pass>]
forja server update <id> [--host <host>] [--username <user>] [--port <port>] ...
forja server remove <id>
```

**前置条件**：无。服务器是全局的，不依赖 workroot。

## 行为

### `server`（无参数）

列出所有服务器，标记 `selected` 的服务器。

### `server --detail <id>`

显示单个服务器的完整信息（不含密码）。

### `server add`

添加新服务器。必填：`--name`、`--host`、`--username`。

`--auth-mode` 默认 `key`。`key` 模式需要 `--private-key-path`。`password` 模式需要 `--password`。

### `server update <id>`

更新已有服务器的字段。只更新显式传入的字段。

### `server remove <id>`

按 ID 删除服务器。不可恢复。

## Result

```ts
interface ServerResult extends ForjaJsonResult {
    action: 'server';
    servers?: ServerSummary[] | ServerDetail;
}

interface ServerSummary {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: 'key' | 'password';
    selected?: boolean;
}
```

## 存储

服务器列表存储在 `~/.forja/servers.json`，全局共享。

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja remote set --server <name>` | 引用服务器 |
| `forja sync --server <name>` | 引用服务器 |
| `forja doctor --remote --server <id>` | 诊断指定服务器 |

## 验证点

- `forja server add` 缺少必填参数时报错
- `forja server update <id>` 只更新显式传入的字段
- `forja server remove <id>` 删除不存在的 ID 时报错
- `--detail` 不输出密码
