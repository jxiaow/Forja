# `forja remote`

[← 返回总览](index.md)

**职责**：远程配置和仓库操作。`remote set` 是一步完成远程初始化的显式子命令；其余子命令管理远程高级配置和仓库操作。

**语法**：
```
forja remote set --server <name> --remote-path <path> [--json]
forja remote restore <repo> <paths...> [--json]
forja remote reset <repo> <paths...> [--all] [--json]
```

**高级语法**（进入高级帮助）：
```
forja remote workspace set --mode legacy|staged [--path <remoteWorkspace>] [--profile <name>] [--json]
forja remote workspace clear [--json]
forja remote repo set --local <name> --remote <name> --role primary|mapped|remote-only|existing-remote|skip [--path <remotePath>] [--baseline auto|status-only] [--overlay true|false] [--mount symlink] [--asset local[=remote]] [--json]
forja remote repo remove --local <name> [--json]
forja remote repo clear [--json]
forja remote forja-bin set --path <remoteForjaBin> [--json]
forja remote forja-bin clear [--json]
forja remote build-order set <qt:build|qt:clean|qt:qmake|sdk:build|sdk:rebuild|sdk:clean>... [--json]
forja remote build-order clear [--json]
forja remote transfer set --server <id> --path <deployPath> --artifact <path>... [--json]
forja remote transfer clear [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 配置远程构建 server 和路径 | `forja remote set` |
| 切换本地/远程执行 | `forja use execution --local` / `forja use execution --remote` |
| 配置 sync server/path | `forja use sync --server <id> --remote-path <path>` |
| 添加/修改/删除共享 server | `forja server add ...` / `forja server update <id> ...` / `forja server remove <id>` |
| 查看远程配置 | `forja list remote` |
| 测试 SSH 连接 | `forja doctor --remote` |
| 恢复远程仓库文件 | `forja remote restore <repo> <paths...>` |
| 重置远程仓库 | `forja remote reset <repo> <paths...>` |

## `forja remote set`

`remote set` 是远程初始化的一步入口，等价于原 `forja setup remote` 的远程配置部分。

### 行为

1. 验证 `--server` 指向的共享 server 存在且可达。
2. 设置远程路径 `--remote-path`。
3. 保存远程配置（remote settings: server + path）。
4. 保存同步配置（sync settings: enable + server + path）。
5. 部署 Forja 到远程（SSH 检测 `~/.forja/bin/forja`，已有则跳过）。
6. 远程 init（bridge init）。
7. 切换执行模式（activeTarget.runAt → `remote`）。

### 幂等性

已配置 + SSH 可达 → 跳过全部步骤（检测远程 Forja 版本号）。
已配置 + SSH 不可达 → `ok: false`，标记 failed 并返回 `nextAction: "forja doctor --remote"`。

### nextAction

| 场景 | nextAction |
|------|-----------|
| 全部成功 | `forja build` |
| server 不存在 | `forja server add` |
| SSH 不可达 | `forja doctor --remote` |

## 仓库操作

`remote restore` 和 `remote reset` 是破坏性仓库操作，不进入普通帮助和 nextActions。

| 子命令 | 行为 |
|--------|------|
| `remote restore <repo> <paths...>` | 从远程恢复指定文件 |
| `remote reset <repo> <paths...>` | 重置远程仓库指定路径 |
| `remote reset <repo> <paths...> --all` | 包含 untracked 文件的完全重置 |

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja setup remote` | `forja remote set` |
| `forja remote qt init` | `forja remote set` + `forja use execution --remote` + `forja sync` |
| `forja remote sdk init` | `forja remote set` + `forja use execution --remote` + `forja sync` |
| `forja remote workspace use` | `forja use remote workspace set` |
| `forja remote workspace clear` | `forja use remote workspace clear` |
| `forja remote repo list` | `forja list remote`（repos 段） |
| `forja remote repo set/remove/clear` | `forja use remote repo set/remove/clear` |
| `forja remote forja-bin status` | `forja list remote` |
| `forja remote forja-bin use/clear` | `forja use remote forja-bin set/clear` |
| `forja remote build-order status` | `forja list remote` |
| `forja remote build-order set/clear` | `forja use remote build-order set/clear` |
| `forja remote transfer status` | `forja list remote` |
| `forja remote transfer set/clear` | `forja use remote transfer set/clear` |
| `forja remote qt restore` | `forja remote restore <repo> <paths...>` |
| `forja remote qt reset` | `forja remote reset <repo> <paths...>` |
| `forja remote qt clean-untracked` | `forja remote reset <repo> <paths...> --all` |
| `forja remote sdk restore/reset/clean-untracked` | `forja remote restore/reset <repo> <paths...>` |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.remote.status` | `forja.status` | remote readiness |
| `forja.remote.doctor` | `forja.doctor` | 远程诊断 |
| `forja.remote.test` | `forja.doctor` | 连接测试 |
| `forja.remote.bootstrap` | `forja.doctor` | 部署远端 Forja |
| `forja.remote.transfer.status` | `forja.list` | transfer 配置状态 |

## Result

```ts
interface RemoteSetResult extends ForjaJsonResult {
    action: 'remote-set';
    server?: ServerSummary;
    remotePath?: string;
    syncEnabled?: boolean;
    forjaDeployed?: boolean;
    forjaVersion?: string;
    executionMode?: 'remote';
    steps?: {
        serverSetup?: string;
        remoteConfig?: string;
        syncSetup?: string;
        forjaDeploy?: string;
        remoteInit?: string;
        executionSwitch?: string;
    };
}
```

## 诊断码

| code | level | 触发条件 | nextAction |
|------|-------|----------|------------|
| `remote.serverNotFound` | error | --server 指向不存在的 server | `forja server` |
| `remote.serverUnreachable` | error | SSH 连接失败 | `forja doctor --remote` |
| `remote.remotePathRequired` | error | 未提供 --remote-path | `forja remote set --server <name> --remote-path <path>` |
| `remote.forjaDeployFailed` | error | Forja 部署失败 | `forja doctor fix --remote` |
| `remote.remoteInitFailed` | error | 远程 init 失败 | `forja doctor --remote` |

## 正常场景

```json
{
    "ok": true,
    "action": "remote-set",
    "server": { "id": "abc-123", "name": "dev", "host": "10.0.0.1", "port": 22, "username": "xw", "authMode": "key" },
    "remotePath": "/home/xw/workspace/app",
    "syncEnabled": true,
    "forjaDeployed": true,
    "forjaVersion": "0.7.0",
    "executionMode": "remote",
    "steps": {
        "serverSetup": "done",
        "remoteConfig": "done",
        "syncSetup": "done",
        "forjaDeploy": "done",
        "remoteInit": "done",
        "executionSwitch": "done"
    },
    "nextAction": "forja build"
}
```

## 文本输出

```
Remote configured
  Server: dev (xw@10.0.0.1)
  Remote path: /home/xw/workspace/app
  Sync: enabled
  Forja: 0.7.0 (deployed)
  Execution: remote
Next:
  forja build
```

## 验证点

- `forja remote set --server dev --remote-path /home/dev/workspace --json` 完成远程配置。
- `forja remote set` 在 server 不存在时返回 `remote.serverNotFound`。
- `forja remote set` 在 SSH 不可达时返回 `remote.remoteServerUnreachable`。
- `forja remote set` 幂等：已配置且可达时跳过部署。
- `forja remote restore <repo> <paths...>` 恢复指定文件。
- `forja remote reset <repo> <paths...> --all` 包含 untracked 文件。
