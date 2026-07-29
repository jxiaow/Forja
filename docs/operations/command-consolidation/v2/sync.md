# `forja sync`

[← 返回总览](index.md)

**职责**：按 git 变更文件同步到已配置的远程服务器。基于 git diff 增量上传（SCP 传输）。

**语法**：
```
forja sync [--yes] [--file <path>]... [--json]
forja sync plan [--json]
forja sync status [--json]
forja sync reset
forja sync ignore [add|rm] <pattern>
```

**前置条件**：workroot 已注册。sync 配置完整（server + remote path）。

## 子命令

### `sync`（默认执行）

1. 分类 git 变更（modified / untracked / deleted）
2. 显示摘要
3. 交互确认（`--yes` 跳过）
4. SCP 上传/删除远程文件

### `sync plan`

只预览待同步文件，不执行。

### `sync status`

显示当前同步配置状态（server、remote path、enabled、ignore rules）。

### `sync reset`

清除同步状态。下次 sync 会重新计算所有文件。

### `sync ignore`

管理忽略规则。

```bash
forja sync ignore                    # 列出忽略规则
forja sync ignore add "*.log"        # 添加规则
forja sync ignore rm "*.log"         # 删除规则
```

## `--file` 指定同步

```bash
forja sync --file src/main.cpp --file src/util.cpp
```

只同步指定文件。文件必须在 git repo 中。

## Result

```ts
interface SyncResult extends ForjaJsonResult {
    action: 'sync';
    syncAction: 'run' | 'plan' | 'status' | 'reset' | 'ignore';
    pending?: { uploaded: number; deleted: number; skipped: number };
}
```

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja remote set` | 配置 sync 的 server 和 remote path |
| `forja server` | 管理服务器池 |
| `forja status` | sync readiness 在 status 中显示 |
| `forja build` | 远程构建前需先 sync |

## 验证点

- `forja sync --json` 上传变更文件
- `forja sync --yes --json` 跳过确认
- `forja sync plan --json` 只返回计划
- `forja sync --file <path>` 同步指定文件
- `forja sync reset` 清除同步状态
- `forja sync ignore add/rm` 管理忽略规则
