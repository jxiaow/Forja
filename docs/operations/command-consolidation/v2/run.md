# `forja run`

[← 返回总览](index.md)

**职责**：运行当前 active target。Qt 支持运行、后台运行、调试运行和已保存自定义命令；SDK 默认不支持运行，提示先构建。

**语法**：
```
forja run [--detach] [--custom <name>] [--plan] [--workspace <path>] [--json]
forja run designer <ui-file> [--workspace <path>] [--json]
```

> **注意**：`--debug` 仅在 VSCode 中可用（通过 `forja.debug` 命令或状态栏调试按钮），CLI 不支持调试会话。

## 命令边界

| 问题 | 归属 |
|------|------|
| 构建目标 | `forja build` |
| 前台/后台运行 Qt 应用 | `forja run` / `forja run --detach` |
| 调试 Qt 应用 | `forja.debug` (VSCode only) |
| 执行已保存自定义命令 | `forja run --custom <name>` |
| 预览运行命令 | `forja run --plan` |
| 用 Qt Designer 打开 .ui 文件 | `forja run designer <ui-file>` |
| 查看运行状态 | `forja status` |
| 停止运行 | `forja stop` |

## 行为

1. 读取 active target；缺失时返回 `forja list` + `forja use target --project <path>`。
2. `kind=qt, runAt=local`：必要时构建，然后运行本地可执行文件。
3. `kind=qt, runAt=remote`：远程 prepare 后通过 bridge 运行。
4. `kind=sdk`：失败，提示 `forja build`；不猜测可执行产物。
5. `--detach`：后台运行，返回 `RuntimeState.pid/logFile`。
6. `--custom <name>`：只允许引用已保存的自定义命令名称，不接受任意 shell 字符串。
7. `designer <ui-file>` 调用 Qt Designer 打开指定 `.ui` 文件，不要求 active target 正在运行。
8. `--plan` 只展示构建/运行计划，不启动进程、不写 runtime state。
9. 在前台 JSON streaming 未实现前，`--json` 推荐与 `--detach` 一起使用；前台模式可在进程结束后返回结果。

## 吸收的旧命令

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja qt run` | `forja run` | |
| `forja qt run --plan` | `forja run --plan` | |
| `forja qt run --detach` | `forja run --detach` | |
| `forja qt debug` | `forja.debug` | VSCode only，需要 VSCode 调试器 |
| `forja qt runCustomCommand` | `forja run --custom <name>` | |
| `forja qt openWithQtDesigner` | `forja run designer <ui-file>` | |
| `forja remote qt run` | `forja run`（runAt=remote） | |
| `forja remote qt runDetached` | `forja run --detach`（runAt=remote） | |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.qt.run` | `forja.run` | 运行当前目标 |
| `forja.qt.debug` | `forja.debug` | VSCode only，启动调试会话 |
| `forja.qt.runCustomCommand` | `forja.run` | QuickPick 选择 saved custom command |
| `forja.qt.openWithQtDesigner` | `forja.run designer` / `forja.openDesigner` | CLI 或 Explorer 上下文 |
| `forja.remote.qt.run` | `forja.run` | runAt=remote |
| `forja.remote.qt.runDetached` | `forja.run` | runAt=remote + detach |

## Result

```ts
interface RunResult extends ForjaJsonResult {
    action: 'run';
    runAction: 'default' | 'detach' | 'debug' | 'custom' | 'designer';
    activeTarget?: ActiveTarget;
    plan?: CommandPlan;
    runtime?: RuntimeState;
    exitCode?: number;
    logFile?: string;
}
```

## 诊断码

| code | level | 触发条件 | nextActions |
|------|-------|----------|-------------|
| `run.targetNotSelected` | error | 没有 active target | `forja list`, `forja use target --project <path>` |
| `run.targetMissing` | error | 项目文件不存在 | `forja list`, `forja use target --project <path>` |
| `run.unsupportedTarget` | error | SDK target 执行 run | `forja build` |
| `run.debugRequiresVSCode` | error | CLI 使用 `--debug` | 使用 VSCode `forja.debug` 命令 |
| `run.customNotFound` | error | 指定的 custom command 不存在 | `forja list` 或配置面板 |
| `run.designerFileInvalid` | error | designer action 文件不是 `.ui` 或不存在 | 无 |
| `run.designerMissing` | error | 未找到 Qt Designer | `forja doctor` |
| `run.executableMissing` | error | Qt 可执行文件不存在 | `forja build` |
| `run.remoteMissing` | error | runAt=remote 配置不完整 | `forja list remote`, `forja use remote --server <id> --remote-path <path>` |
| `run.remoteBlocked` | error | remote prepare/bridge 失败 | `forja doctor --remote` |
| `run.commandFailed` | error | 运行命令失败 | `forja doctor` |

## 正常场景

```json
{
    "ok": true,
    "action": "run",
    "runAction": "detach",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "runtime": {
        "running": true,
        "pid": 12345,
        "executablePath": "build/release/app.exe",
        "logFile": "~/.forja/logs/app.log",
        "runAt": "local"
    },
    "nextActions": ["forja status", "forja stop"]
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "run",
    "runAction": "debug",
    "diagnostics": [
        { "code": "run.debugRequiresVSCode", "level": "error", "message": "Debug is only available in VSCode" }
    ],
    "nextActions": []
}
```

```json
{
    "ok": false,
    "action": "run",
    "runAction": "default",
    "activeTarget": { "kind": "sdk", "project": "sdk/project.sln", "mode": "release", "arch": "x64", "runAt": "local" },
    "diagnostics": [
        { "code": "run.unsupportedTarget", "level": "error", "message": "SDK targets do not support run" }
    ],
    "nextActions": ["forja build"]
}
```

## 文本输出

```
Forja run started
Target: qt app/app.pro release x64 local
Runtime: running (pid 12345)
Log: ~/.forja/logs/app.log
Next:
  forja status
  forja stop
```

## 验证点

- Qt local `forja run --detach --json` 返回 pid/logFile。
- `forja run --plan --json` 不启动进程，不写 runtime state。
- CLI `forja run --debug` 返回 `run.debugRequiresVSCode` 错误。
- VSCode `forja.debug` 命令启动调试会话。
- `forja run designer form.ui --json` 覆盖旧 Qt Designer 上下文命令。
- SDK target 下 `forja run --json` 失败并指向 `forja build`。
- runAt=remote 时通过 remote bridge，不直接运行本地 executable。
