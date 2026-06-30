# `forja clean`

[← 返回总览](index.md)

**职责**：清理当前 active target 的构建产物。它只处理构建输出，不修改用户源码、不清理远程未跟踪文件、不重置仓库。

**语法**：
```
forja clean [--workspace <path>] [--plan] [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 清理 build 目录/中间产物 | `forja clean` |
| rebuild / clean + build | `forja build fresh` |
| 清理残留 Forja 配置 | `forja doctor fix` |
| 远程 git clean 未跟踪文件 | `forja doctor clean-untracked`（隐藏破坏性语法） |
| 删除 server/repo 配置 | `forja server remove <id>` / `forja use remote repo remove --local <name>` |

## 行为

1. 读取 active target；缺失时返回 `forja list` + `forja use target --project <path>`。
2. `kind=qt`：调用现有 Qt clean 后端。
3. `kind=sdk`：调用现有 SDK clean 后端。
4. `runAt=remote`：通过 remote prepared action 执行对应 clean。
5. `--plan` 只展示将执行的命令和可能删除的构建目录，不删除文件。
6. 无构建产物时视为成功，输出 `state: "already-clean"` 或空 changed 列表。
7. clean 失败不自动执行 restore/reset/clean-untracked。

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja qt clean` | `forja clean` |
| `forja sdk clean` | `forja clean` |
| `forja remote qt clean` | `forja clean`（runAt=remote） |
| `forja remote sdk clean` | `forja clean`（runAt=remote） |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.qt.clean` | `forja.clean` | 清理当前 Qt target |
| `forja.sdk.clean` | `forja.clean` | 清理当前 SDK target |
| `forja.remote.qt.clean` | `forja.clean` | runAt=remote |
| `forja.remote.sdk.clean` | `forja.clean` | runAt=remote |

## Result

```ts
interface CleanResult extends ForjaJsonResult {
    action: 'clean';
    activeTarget?: ActiveTarget;
    state?: 'cleaned' | 'already-clean';
    plan?: CommandPlan;
    durationMs?: number;
    exitCode?: number;
    changed?: string[];
}
```

## 诊断码

| code | level | 触发条件 | nextActions |
|------|-------|----------|-------------|
| `clean.targetNotSelected` | error | 没有 active target | `forja list`, `forja use target --project <path>` |
| `clean.targetMissing` | error | 项目文件不存在 | `forja list`, `forja use target --project <path>` |
| `clean.remoteMissing` | error | runAt=remote 但远程配置不完整 | `forja list remote`, `forja use remote --server <id> --remote-path <path>` |
| `clean.remoteBlocked` | error | remote prepare/lock/SSH 失败 | `forja doctor --remote` |
| `clean.commandFailed` | error | 后端 clean 失败 | `forja doctor` |

## 正常场景

```json
{
    "ok": true,
    "action": "clean",
    "state": "cleaned",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "changed": ["build/app"],
    "durationMs": 400,
    "exitCode": 0,
    "nextActions": ["forja build"]
}
```

```json
{
    "ok": true,
    "action": "clean",
    "state": "already-clean",
    "activeTarget": { "kind": "sdk", "project": "sdk/project.sln", "mode": "release", "arch": "x64", "runAt": "local" },
    "nextActions": ["forja build"]
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "clean",
    "diagnostics": [
        { "code": "clean.targetNotSelected", "level": "error", "message": "No active target selected" }
    ],
    "nextActions": ["forja list", "forja use target --project <path>"]
}
```

## 文本输出

```
Forja clean succeeded
Target: qt app/app.pro release x64 local
Cleaned: build/app
Next:
  forja build
```

## 验证点

- `forja clean --json` 对 Qt/SDK 本地目标分别路由到旧 clean 能力。
- `forja clean --plan --json` 不删除文件。
- runAt=remote 时路由到 remote clean。
- 无构建产物时成功且不报错。
