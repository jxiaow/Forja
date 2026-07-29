# `forja stop`

[← 返回总览](index.md)

**职责**：停止运行中的程序。通过 PID 直接终止进程（非进程名），精确且不会误杀同名进程。

**语法**：
```
forja stop [--json]
```

**前置条件**：workroot 已注册且有 active target。

## 行为

1. 读取运行状态（PID、executablePath）
2. 无运行进程 → 返回 `state: 'not-running'`
3. SDK target → 返回 `state: 'unsupported'`
4. Qt target：
   - Windows: `taskkill /F /T /PID <pid>`
   - POSIX: `process.kill(pid, 'SIGTERM')` + 验证 SIGTERM 是否生效

## Result

```ts
interface StopResult extends ForjaJsonResult {
    action: 'stop';
    state: 'stopped' | 'not-running' | 'unsupported';
    pid?: number;
}
```

## 与其他命令的关系

| 命令 | 关系 |
|------|------|
| `forja run` | stop 终止 run 启动的进程 |
| `forja status` | 显示运行时状态 |

## 验证点

- `forja stop --json` 终止运行中的进程
- 无运行进程时返回 `state: 'not-running'`
- SDK target 返回 `state: 'unsupported'`
- 按 PID 终止（非进程名）
