# `forja stop`

[← 返回总览](index.md)

**职责**：停止当前运行目标。

**语法**：
```
forja stop [--workspace <path>] [--json]
```

**行为**：
- Qt local：停止本地进程。
- Qt remote：远程 bridge stop。
- SDK：返回 `state: "unsupported"`。
- 无运行记录：`state: "not-running"`，不视为错误。

**吸收的旧命令**：`forja qt stop`、`forja remote qt stop`

**Result**：
```ts
interface StopResult extends ForjaJsonResult {
    action: 'stop';
    state: 'stopped' | 'not-running' | 'unsupported';
    runtime?: RuntimeState;
}
```
