# `forja clean`

[← 返回总览](index.md)

**职责**：清理当前目标构建产物。

**语法**：
```
forja clean [--workspace <path>] [--plan] [--json]
```

**吸收的旧命令**：`forja qt clean`、`forja sdk clean`、`forja remote qt clean`、`forja remote sdk clean`

**Result**：
```ts
interface CleanResult extends ForjaJsonResult {
    action: 'clean';
    plan?: CommandPlan;
    durationMs?: number;
    exitCode?: number;
}
```
