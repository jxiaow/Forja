# `forja run`

[← 返回总览](index.md)

**职责**：运行当前目标。Qt 支持运行，SDK 默认不支持。

**语法**：
```
forja run [--detach] [--debug] [--custom <name>] [--workspace <path>] [--json]
```

**行为**：
1. 读取 active target。
2. Qt local：必要时构建，然后运行。
3. Qt remote：远程 prepare 后运行。
4. SDK：失败，提示 `forja build`。
5. `--detach`：后台运行，返回 pid/logFile。
6. `--debug`：调试运行。仅 Qt 目标。
7. `--custom <name>`：运行已保存的自定义命令（只允许引用已保存名称，不接受任意 shell 字符串）。仅 Qt 目标。
8. `--debug` 和 `--custom` 互斥。
9. `--detach --json` 要求（前台 JSON streaming 未实现前）。

**吸收的旧命令**：
`forja qt run`、`forja qt run --detach`、`forja qt debug`、`forja qt runCustomCommand`、`forja remote qt run`、`forja remote qt runDetached`

**Result**：
```ts
interface RunResult extends ForjaJsonResult {
    action: 'run';
    runAction: 'default' | 'detach' | 'debug' | 'custom';
    runtime?: RuntimeState;
    exitCode?: number;
    logFile?: string;
}
```
