# `forja list`

[← 返回总览](index.md)

**职责**：只读列举可选项。它回答“有什么/配了什么”，不做健康验证、不写配置、不执行 SSH mutation。

**语法**：
```
forja list [targets|env] [--workspace <path>] [--json]
forja server --detail <id> [--json]
forja list env <qt|vs|jom|make> [--json]
forja list remote [--detail] [--workspace <path>] [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 有哪些 Qt/SDK 目标 | `forja list` / `forja list targets` |
| 当前目标是否可用 | `forja status` |
| 工具链路径有哪些 | `forja list env` |
| 工具链能不能用 | `forja doctor` |
| 配了哪些服务器 | `forja server` |
| SSH 能不能连 | `forja doctor --remote` |
| 远程 workspace/bin/build-order/transfer 配了什么 | `forja list remote` |
| 远程配置是否完整可用 | `forja status` / `forja doctor --remote` |

## Category 行为

| Category | 默认输入 | 数据来源 | 行为 |
|----------|----------|----------|------|
| `targets` | `forja list` | workspace 文件扫描 + activeTarget | 列出 Qt `.pro`、SDK `.sln`/`Makefile`/`CMakeLists.txt`，标记 current/configured |
| `servers` | `forja server` | serverStore | 列出 ServerSummary，不输出密码 |
| `servers --detail <id>` | - | serverStore | 输出 ServerDetail，不输出密码 |
| `env` | `forja list env` | 本地发现逻辑 | 列出 Qt/VS/jom/make 路径，只做发现 |
| `env <qt\|vs\|jom\|make>` | - | 本地发现逻辑 | 列出指定子分类的已配置/可用项 |
| `remote` | `forja list remote` | remote settings | 列出 workspace/bin/build-order/transfer/repos |
| `remote --detail` | - | remote settings | 展开 buildOrder 和 artifacts 明细 |

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja qt projects` | `forja list` / `forja list targets` |
| `forja sdk projects` | `forja list` / `forja list targets` |
| `forja qt env` | `forja list env` |
| `forja sdk env` | `forja list env` |
| `forja sync servers` | `forja server` |
| `forja sync server` | `forja server --detail <id>` |
| `forja remote repo list` | `forja list remote`（repos 段） |
| `forja remote workspace status` | `forja list remote` |
| `forja remote forja-bin status` | `forja list remote` |
| `forja remote build-order status` | `forja list remote` |
| `forja remote transfer status` | `forja list remote` |

## VSCode 映射

`forja.list` 是新的 Command Palette 可见命令。旧 `selectProject/showActions/workbench/transfer.status` 等命令不直接等价为 list；需要展示候选时统一调用 `forja.list` 背后的候选聚合能力。

## Result

```ts
interface ListResult extends ForjaJsonResult {
    action: 'list';
    category: 'targets' | 'servers' | 'env' | 'remote' | 'config';
    targets?: TargetCandidate[];
    servers?: ServerSummary[] | ServerDetail;
    env?: EnvSummary;
    remote?: RemoteConfigDetail;
    config?: ConfigSummary;
}

interface EnvSummary {
    qt?: Array<{ path: string; version?: string }>;
    vs?: Array<{ path: string; version?: string }>;
    jom?: string;
    make?: string;
}

interface RemoteConfigDetail {
    workspaceMode: 'legacy' | 'staged';
    remoteWorkspace?: string;
    remoteForjaBin?: string;
    buildOrder?: RemoteBuildOrderItem[];
    transfer?: {
        configured: boolean;
        deployServer?: string;
        deployPath?: string;
        artifacts?: string[];
    };
    repos?: RemoteRepoSettings[];
}
```

## 诊断码

| code | level | 触发条件 | nextActions |
|------|-------|----------|-------------|
| `list.workspaceNotFound` | error | workspace 不存在 | 无 |
| `list.categoryUnknown` | error | category 不在允许列表 | `forja list` |
| `list.serverNotFound` | error | `servers --detail` 指向不存在 server | `forja server` |
| `list.configCorrupt` | error | 配置文件无法解析 | `forja doctor fix` |
| `list.noTargets` | info | 没有 Qt/SDK target | `forja init` |
| `list.noServers` | info | 没有 server 配置 | `forja server add --name <name> --host <host> --username <name>` |

## 正常场景

```json
{
    "ok": true,
    "action": "list",
    "category": "targets",
    "targets": [
        { "kind": "qt", "project": "app/app.pro", "label": "app", "current": true, "configured": true, "diagnostics": [] },
        { "kind": "sdk", "project": "sdk/project.sln", "label": "project", "current": false, "configured": false, "diagnostics": [] }
    ],
    "nextActions": ["forja use target --project <path>"]
}
```

```json
{
    "ok": true,
    "action": "list",
    "category": "config",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "config": {
        "qt": { "configured": true, "project": "app/app.pro", "mode": "release", "arch": "x64", "qtPath": "C:/Qt/5.15.2/msvc2019" },
        "sdk": { "configured": true, "project": "sdk/project.sln", "mode": "debug", "arch": "x64", "vsInstall": "C:/Program Files/Microsoft Visual Studio/2022/Professional" },
        "sync": { "configured": false, "enabled": false }
    },
    "nextActions": ["forja use target --project <path>", "forja use qt --qt-path <path>", "forja use sdk --vs-dev-cmd <path>"]
}
```

```json
{
    "ok": true,
    "action": "list",
    "category": "remote",
    "remote": {
        "workspaceMode": "staged",
        "remoteWorkspace": "/home/dev/workspace/app",
        "remoteForjaBin": "$HOME/.forja/bin/forja",
        "transfer": { "configured": true, "deployServer": "dev", "deployPath": "/opt/app" }
    },
    "nextActions": ["forja status"]
}
```

## 文本输出

```
Forja list targets
Workspace: /path/to/workspace
* qt  app/app.pro        configured current
  sdk sdk/project.sln    not-configured
Next:
  forja use target --project <path>
```

## 验证点

- `forja list --json` 同时列出 Qt 和 SDK 候选。
- `forja server --detail <id> --json` 不输出密码。
- `forja list env --json` 只列路径，不做 qmake/MSBuild/make 健康验证。
- `forja list remote --detail --json` 覆盖 workspace/bin/build-order/transfer/repos。
