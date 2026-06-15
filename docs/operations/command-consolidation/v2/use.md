# `forja use`

[← 返回总览](index.md)

**职责**：选择目标、构建配置、执行端。唯一普通配置入口。

**公开语法**（进入主帮助）：
```
forja use [--workspace <path>] [--json]
forja use --target <project> [--json]
forja use --kind qt|sdk [--json]
forja use --mode debug|release [--arch x86|x64] [--json]
forja use --local [--json]
forja use --remote [--json]
forja use --server <id> --remote-path <path> [--json]
```

**隐藏语法**（不进入主帮助，迁移期兼容）：
```
forja use --remote-workspace <path>
forja use --remote-forja-bin <path>
```

低频高级配置（server CRUD、remote repo mapping、build-order、artifact transfer）不进入 `use` 公开语法。它们由 `forja init --remote` 引导流程或旧兼容命令承接。

**行为**：
1. 无参数 + 交互终端：进入选择流程。
2. 有参数：只更新显式传入字段，保留其他字段。
3. `--target` 推断 kind：`.pro` → qt，`.sln`/`Makefile` → sdk。
4. `--kind` 只有该类型唯一候选时自动成功，否则返回 `forja list`。
5. `--remote` 不自动创建服务器配置。
6. 成功后返回 `nextActions: ["forja status"]`。

**吸收的旧命令**：
`forja qt use`、`forja sdk use`、`forja sync use`、`forja remote workspace use`、`forja remote forja-bin use`、`forja remote.execution.pick/local/remote`

**Result**：
```ts
interface UseResult extends ForjaJsonResult {
    action: 'use';
    activeTarget?: ActiveTarget;
    remote?: RemoteSummary;
    changed: string[];
}
```
