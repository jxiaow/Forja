# `forja clean`

[�?返回总览](index.md)

**职责**：清理当�?active target 的构建产物。它只处理构建输出，不修改用户源码、不清理远程未跟踪文件、不重置仓库�?

**语法**�?
```
forja clean [--workspace <path>] [--plan] [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 清理 build 目录/中间产物 | `forja clean` |
| rebuild / clean + build | `forja build fresh` |
| 清理残留 Forja 配置 | `forja doctor fix` |
| 远程 git clean 未跟踪文�?| `forja doctor clean-untracked`（隐藏破坏性语法） |
| 删除 server/repo 配置 | `forja server remove <id>` / `forja use remote repo remove --local <name>` |

## 行为

1. 读取 active target；缺失时返回 `forja list targets` + `forja use target --project <path>`�?
2. 校验项目文件是否存在；缺失时返回 `forja list targets`�?
3. `kind=qt`：调用现�?Qt clean 后端�?
4. `kind=sdk`：调用现�?SDK clean 后端�?
5. `runAt=remote`：通过 remote prepared action 执行对应 clean�?
6. `--plan` 只展示将执行的命令，不删除文件�?
7. 无构建产物时视为成功，输�?`state: "already-clean"`�?
8. clean 失败不自动执�?restore/reset/clean-untracked�?

## 吸收的旧命令

| 旧命�?| 新命�?|
|--------|--------|
| `forja qt clean` | `forja clean` |
| `forja sdk clean` | `forja clean` |
| `forja remote qt clean` | `forja clean`（runAt=remote�?|
| `forja remote sdk clean` | `forja clean`（runAt=remote�?|

## VSCode 映射

| �?Command ID | �?Command ID | 说明 |
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

## 诊断场景

| 场景 | level | message 前缀 | nextAction |
|------|-------|-------------|------------|
| 没有 active target | error | `Target not selected:` | `forja list targets` |
| 项目文件不存�?| error | `Target project missing:` | `forja list targets` |
| 远程配置不完�?| error | （透传 remote 层） | `forja doctor --remote` |
| 后端 clean 失败 | error | `Qt clean failed:` / `SDK clean failed:` | `forja doctor` |

## 正常场景

```json
{
    "ok": true,
    "action": "clean",
    "state": "cleaned",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "changed": ["app"],
    "durationMs": 400,
    "exitCode": 0,
    "nextAction": "forja build"
}
```

```json
{
    "ok": true,
    "action": "clean",
    "state": "already-clean",
    "activeTarget": { "kind": "sdk", "project": "sdk/project.sln", "mode": "release", "arch": "x64", "runAt": "local" }
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "clean",
    "diagnostics": [
        { "level": "error", "message": "Target not selected: No active target. Run `forja use target` or `forja use target --project <path>`." }
    ],
    "nextAction": "forja list targets"
}
```

```json
{
    "ok": false,
    "action": "clean",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "diagnostics": [
        { "level": "error", "message": "Qt clean failed: jom: target 'clean' failed" }
    ],
    "nextAction": "forja doctor"
}
```

## 文本输出

```
Clean succeeded
Target: qt · app/app.pro · release/x64 · local
State: cleaned
Cleaned: app
Duration: 400ms
Next:
  forja build
```

## 验证�?

- `forja clean --json` �?Qt/SDK 本地目标分别路由到对�?clean 后端�?
- `forja clean --plan --json` 不删除文件�?
- runAt=remote 时路由到 remote clean�?
- 无构建产物时返回 `state: "already-clean"`�?
- 项目文件不存在时返回结构化错误�?
- clean 失败时诊断信息包含具体错误内容�?
