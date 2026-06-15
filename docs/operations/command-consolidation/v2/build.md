# `forja build`

[← 返回总览](index.md)

**职责**：构建当前 active target。统一处理 Qt/SDK/local/remote。

**语法**：
```
forja build [fresh|qmake|rcc] [--workspace <path>] [--plan] [--json]
```

**Action 矩阵**：

| 命令 | Qt 目标 | SDK 目标 |
|------|---------|----------|
| `forja build` | 必要时 qmake/rcc，然后 build | 正常 build |
| `forja build fresh` | clean + qmake + rcc + build | rebuild 或 clean + build |
| `forja build qmake` | 只跑 qmake | 失败：SDK 没有 qmake |
| `forja build rcc` | 只跑 rcc | 失败：SDK 没有 rcc |

**行为**：
1. 读取 active target；缺失时返回 `forja list` + `forja use`。
2. `runAt=local`：调用本地 Qt/SDK 后端。
3. `runAt=remote`：先做远程 preflight + workspace prepare，再调用远程后端。
4. `qmake`/`rcc` 只适用于 Qt target，SDK 下失败。
5. `--plan` 不执行，只输出 CommandPlan。

**吸收的旧命令**：
`forja qt qmake`、`forja qt rcc`、`forja qt build`、`forja sdk build`、`forja sdk rebuild`、`forja remote qt qmake`、`forja remote qt build`、`forja remote sdk build`、`forja remote sdk rebuild`

**Result**：
```ts
interface BuildResult extends ForjaJsonResult {
    action: 'build';
    buildAction: 'default' | 'fresh' | 'qmake' | 'rcc';
    plan?: CommandPlan;
    durationMs?: number;
    exitCode?: number;
    errors?: string[];
}
```
