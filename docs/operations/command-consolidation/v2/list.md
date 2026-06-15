# `forja list`

[← 返回总览](index.md)

**职责**：只读列举可选项。纯文件/配置枚举，不做系统探测。

**语法**：
```
forja list [targets|servers|remote-repos|env] [--workspace <path>] [--json]
forja list servers --detail <id> [--json]
```

**行为**：
- `targets`（默认）：列出 Qt .pro + SDK .sln/Makefile，标记当前目标和配置完整度。
- `servers`：列出 ServerSummary，不输出密码。
- `servers --detail <id>`：返回 ServerDetail。
- `remote-repos`：列出远程 repo 映射。
- `env`：列出系统上检测到的工具链路径（Qt/VS/jom/make）。纯路径发现，不做健康验证。

**吸收的旧命令**：
`forja qt projects`、`forja sdk projects`、`forja sync servers`、`forja sync server`、`forja remote repo list`、`forja qt env`、`forja sdk env`

**Result**：
```ts
interface ListResult extends ForjaJsonResult {
    action: 'list';
    category: 'targets' | 'servers' | 'remote-repos' | 'env';
    targets?: TargetCandidate[];
    servers?: ServerSummary[] | ServerDetail;
    remote?: RemoteSummary;
    env?: EnvSummary;
}

interface EnvSummary {
    qt?: Array<{ path: string; version?: string }>;
    vs?: Array<{ path: string; version?: string }>;
    jom?: string;              // Windows only
    make?: string;             // POSIX only
}
```
