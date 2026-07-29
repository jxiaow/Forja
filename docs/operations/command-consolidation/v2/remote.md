# `forja remote`

[← 返回总览](index.md)

**职责**：管理远程执行配置。设置服务器、远程路径、仓库映射、forja-bin 路径、构建顺序和传输配置。

**语法**：
```
forja remote                              # 显示当前远程配置
forja remote set --server <name> [--remote-path <path>]
forja remote restore <repo> <paths...>    # 恢复仓库文件
forja remote reset <repo> <paths...> [--all]  # 重置仓库（破坏性）
```

**前置条件**：workroot 已注册。`set` 需要至少提供 `--server` 或 `--remote-path`。

## 子命令

### `remote`（无子命令）

显示当前远程配置摘要：selected server、remote path、workspace mode、forja-bin、build order、transfer、repos。

### `remote set`

配置远程执行目标。

```bash
forja remote set --server dev                        # 设置服务器
forja remote set --server dev --remote-path /home/dev/ws  # 设置服务器+路径
forja remote set --remote-path /new/path             # 仅更新路径（需已有 server）
```

无参数时返回错误（必须指定 `--server` 和/或 `--remote-path`）。

### `remote restore`

从远端恢复指定仓库的文件到本地。

```bash
forja remote restore qt_client src/app.pro src/main.cpp
```

### `remote reset`

重置远端仓库到干净状态（破坏性操作）。

```bash
forja remote reset qt_client src/
forja remote reset qt_client --all    # 清理所有未跟踪文件
```

## Result

```ts
interface RemoteResult extends ForjaJsonResult {
    action: 'remote';
    remoteAction: 'show' | 'set' | 'restore' | 'reset';
    changed: string[];
    remote?: { selectedServer?: string; remotePath?: string; ... };
}
```

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja server` | 管理服务器池（remote 引用 server） |
| `forja use execution --remote` | 切换到远程执行 |
| `forja sync` | 同步文件到远程 |
| `forja doctor --remote` | 远程诊断 |

## 验证点

- `forja remote set` 无参数时返回错误
- `forja remote set --server <name>` 设置服务器
- `forja remote restore/reset` 需要 `<repo>` 和至少一个 `<path>`
