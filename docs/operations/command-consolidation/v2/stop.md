# `forja stop`

[← 返回总览](index.md)

**职责**：停止当前 active target 的运行中进程。停止是幂等操作：没有运行记录不视为失败。

**语法**：
```
forja stop [--workspace <path>] [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 查看是否运行中 | `forja status` |
| 停止当前 Qt 运行进程 | `forja stop` |
| 解除远端 lock | `forja doctor unlock <lock-id>` |
| 停止构建任务 | 现阶段不纳入 `stop`，由后端任务系统处理 |

## 行为

1. 读取 active target；缺失时返回 `forja list` + `forja use target --project <path>`。
2. `kind=qt, runAt=local`：读取本地 run state，停止记录中的进程。
3. `kind=qt, runAt=remote`：通过 remote bridge stop。
4. `kind=sdk`：返回 `state: "unsupported"`，不视为成功运行能力。
5. 无运行记录或进程已退出：返回 `state: "not-running"`，`ok: true`。
6. stop 不执行 clean，不删除日志，不释放非 runtime lock。

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja qt stop` | `forja stop` |
| `forja remote qt stop` | `forja stop`（runAt=remote） |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.qt.stop` | `forja.stop` | 停止本地 Qt runtime |
| `forja.remote.qt.stop` | `forja.stop` | 停止远程 Qt runtime |

## Result

```ts
interface StopResult extends ForjaJsonResult {
    action: 'stop';
    activeTarget?: ActiveTarget;
    state: 'stopped' | 'not-running' | 'unsupported';
    runtime?: RuntimeState;
}
```

## 诊断码

| code | level | 触发条件 | nextActions |
|------|-------|----------|-------------|
| `stop.targetNotSelected` | error | 没有 active target | `forja list`, `forja use target --project <path>` |
| `stop.unsupportedTarget` | error | SDK target 执行 stop | `forja status` |
| `stop.remoteMissing` | error | runAt=remote 配置不完整 | `forja list remote`, `forja use remote --server <id> --remote-path <path>` |
| `stop.remoteBlocked` | error | remote bridge stop 失败 | `forja doctor --remote` |
| `stop.commandFailed` | error | 本地 kill 或远程 stop 失败 | `forja status` |

## 正常场景

```json
{
    "ok": true,
    "action": "stop",
    "state": "stopped",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "runtime": { "running": false, "runAt": "local" },
    "nextActions": ["forja run"]
}
```

```json
{
    "ok": true,
    "action": "stop",
    "state": "not-running",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "nextActions": ["forja run"]
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "stop",
    "state": "unsupported",
    "activeTarget": { "kind": "sdk", "project": "sdk/project.sln", "mode": "release", "arch": "x64", "runAt": "local" },
    "diagnostics": [
        { "code": "stop.unsupportedTarget", "level": "error", "message": "SDK targets do not support stop" }
    ],
    "nextActions": ["forja status"]
}
```

## 文本输出

```
Forja stop succeeded
Target: qt app/app.pro release x64 local
Runtime: stopped
Next:
  forja run
```

## 验证点

- 无运行记录时 `ok: true` 且 `state: "not-running"`。
- Qt local 读取本地 run state 并停止对应 pid。
- Qt remote 通过 bridge stop。
- SDK target 返回 unsupported。
