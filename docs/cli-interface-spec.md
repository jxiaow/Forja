# CLI 接口规范

本文档定义 forja CLI 的输入参数、输出结构和数据类型，供 AI 工具和集成方参考。

> **注意**：本文是当前公开命令的接口规范；使用示例参见 [CLI 使用文档](README-cli.md)。

## 调用约定

```
forja <subcommand> [action] [options]
```

- 当前公开子命令：`init` | `status` | `list` | `use` | `server` | `remote` | `build` | `run` | `stop` | `clean` | `sync`
- 所有命令加 `--json` 输出结构化 JSON
- 退出码：`0` 成功，`1` 失败
- 即使发生异常，`--json` 模式也保证输出合法 JSON
- 未知 flag 会报错，不会静默忽略

---

## 通用参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--workspace <path>` | string | `process.cwd()` | 操作根目录 |
| `--json` | boolean | `false` | JSON 格式输出 |
| `--lang <locale>` | string | 系统 locale | 语言覆盖（`zh` / `en`） |
| `--help`, `-h` | boolean | `false` | 显示帮助 |

---

## 命令参数矩阵

### `forja status`

无额外参数。runtime 信息始终包含在输出中。

### `forja init`

| 参数 | 类型 | 说明 |
|------|------|------|
| `--workroot <path>` | string | 指定并注册 workroot |
| `--answers <path>` | string | 使用答案文件完成全新初始化 |
| `--json` | boolean | 输出初始化问题或结果，不读取旧配置 |

初始化项目选择先返回 `projectGroup`，再返回 `project`。分组按顶层目录生成；`.worktrees/<branch>/...` 跳过工作树层级，`xyframework/*` 统一归组，`build` 项目完整保留。JSON 中 `project.choicesBy.questionId` 指向 `projectGroup`，`project.choicesBy.values` 保存组名到完整项目路径数组的映射；答案仍使用原有 `project` 字段。

### `forja list`

**必须指定分类参数**。

| 分类 | 说明 |
|------|------|
| `targets` | Qt/C++ 候选目标 |
| `env` | 工具链路径（子分类 qt/vs/jom/make） |

`list targets --all` 使用 `targetGroups` 按顶层项目组返回目标；扫描包含 `build` 与 `.worktrees`。

注意：服务器列表通过 `forja server` 查看，远程配置通过 `forja remote` 查看。

### `forja use`

| 子命令 | 参数 | 说明 |
|--------|------|------|
| `target` | `--project`, `--answers`, `--mode`, `--arch`, `--qt`, `--vs`, `--jom` | 选择项目和本地构建配置 |

选择新项目但缺少 mode 或 Windows arch 时，返回 `status: "needs-input"` 与对应 `questions`，不写入默认值。Linux arch 唯一为 `x64`，因此不返回 arch 问题。

### `forja remote`

| 子命令 | 参数 | 说明 |
|--------|------|------|
| 无 | `--json` | 查看当前远程配置 |
| `setup` | `--server <id>`, `--remote-path <path>` | 为当前 workroot 选择同步服务器、设置远端路径并启用同步，然后部署远端 CLI |
| `bootstrap` | `--force` | 单独打包并部署当前本地 CLI 到已配置服务器 |

远程构建、运行、诊断、仓库操作和传输配置当前不属于公开 CLI 契约。

### `forja server`

| 子命令 | 参数 | 说明 |
|--------|------|------|
| `add` | `--name`, `--host`, `--username`, `--port`, `--auth-mode`, `--private-key-path`, `--password`, `--strict-host-key-checking` | 添加服务器 |
| `update <id>` | 同 add | 更新服务器 |
| `remove <id>` | 无 | 删除服务器 |

### `forja build`

| 参数 | 类型 | 说明 |
|------|------|------|
| 位置参数 | `fresh` \| `qmake` \| `rcc` | 构建动作（默认 default） |
| `--plan` | boolean | 只输出计划 |
| `--project <path>` | path | 直接指定项目 |
| `--jobs <N>` | number | 并行编译数 |

### `forja run`

| 参数 | 类型 | 说明 |
|------|------|------|
| `--detach` | boolean | 后台运行 |
| `--custom <name>` | string | 运行自定义命令 |
| `--plan` | boolean | 只输出计划 |
| `designer <ui-file>` | 子命令 | 打开 Qt Designer |

### `forja stop`

无额外参数。

### `forja clean`

| 参数 | 类型 | 说明 |
|------|------|------|
| `--plan` | boolean | 只输出计划 |

### `forja sync`

| 参数 | 类型 | 说明 |
|------|------|------|
| 位置参数 | `status` \| `reset` \| `ignore` | 同步动作 |
| `--file <path-or-glob>` | path（可重复） | 指定文件或通配符（`*` 不跨目录，`**` 递归） |
| `--dry-run` | boolean | 预览同步文件，不执行上传或删除 |
| `--add` / `--rm` | string | 仅用于 `sync ignore` 管理忽略规则 |

**交互行为**：无 `--json` 时，`forja sync` 先显示计划摘要，交互确认 `[y/N]` 后才执行。`--json` 模式直接执行（AI/脚本用）。

---

## JSON 输出结构

### 基础信封

```typescript
interface ForjaJsonResult {
  ok: boolean;
  action: string;
  workspace?: string;
  activeTarget?: ActiveTarget;
  diagnostics?: Diagnostic[];
  nextAction?: string;
  [key: string]: unknown;
}
```

### 核心类型

```typescript
interface ActiveTarget {
  kind: 'qt' | 'cpp';
  project: string;
  mode: 'debug' | 'release';
  arch: 'x86' | 'x64';
}

interface Diagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;                     // 人读文本，跟随 locale
  hint?: string;
  fix?: string;                        // 可执行的修复命令
  params?: Record<string, string>;
}

interface RuntimeState {
  running: boolean;
  pid?: number;
  executablePath?: string;
  logFile?: string;
}

type ReadinessState = 'ready' | 'configured' | 'blocked' | 'missing' | 'unknown' | 'not-selected';

interface Readiness {
  target?: ReadinessState;
  toolchain?: ReadinessState;
  sync?: ReadinessState;
  runtime?: ReadinessState;
}
```

### 命令特定 Result

```typescript
interface StatusResult extends ForjaJsonResult {
  action: 'status';
  readiness: Readiness;
  runtime?: RuntimeState;
}

interface InitResult extends ForjaJsonResult {
  action: 'init';
  local: {
    qtTargets: number;
    cppTargets: number;
    toolchain: { qt?: boolean; vs?: boolean; jom?: boolean; make?: boolean };
    configured: boolean;
  };
}

interface ListResult extends ForjaJsonResult {
  action: 'list';
  category: 'targets' | 'env';
  targetGroups?: Record<string, TargetCandidate[]>;
  env?: EnvSummary;
}

interface UseResult extends ForjaJsonResult {
  action: 'use';
  useTarget?: string;
  changed: string[];
  activeTarget?: ActiveTarget;
}

interface BuildResult extends ForjaJsonResult {
  action: 'build';
  buildAction: 'default' | 'fresh' | 'qmake' | 'rcc';
  plan?: CommandPlan;
  durationMs?: number;
  exitCode?: number;
  errors?: string[];
}

interface RunResult extends ForjaJsonResult {
  action: 'run';
  runAction: 'default' | 'detach' | 'debug' | 'custom' | 'designer';
  runtime?: RuntimeState;
  exitCode?: number;
  logFile?: string;
}

interface StopResult extends ForjaJsonResult {
  action: 'stop';
  state: 'stopped' | 'not-running' | 'unsupported' | 'running';
  runtime?: RuntimeState;
}

interface CleanResult extends ForjaJsonResult {
  action: 'clean';
  state?: 'cleaned' | 'already-clean';
  plan?: CommandPlan;
  durationMs?: number;
  exitCode?: number;
}

interface SyncResult extends ForjaJsonResult {
  action: 'sync';
  syncAction: 'run' | 'plan' | 'reset' | 'status' | 'ignore';
  plan?: SyncPlan;
  server?: string;
  remotePath?: string;
  uploaded?: string[];
  deleted?: string[];
  skipped?: string[];
}
```

`targetGroups` 的键即项目分组；组内 `TargetCandidate` 不再重复携带 `group` 字段。

---

## 配置文件格式

### `~/.forja/workspaces.json`

新版本 workroot 注册表，只保存已确认的 workroot 路径。旧 `~/.forja/projects/` 不读取。

### `~/.forja/workspaces/<hash>.json`

项目级配置由 canonical workspace store 管理。新版本首次运行必须先执行 `forja init`；不读取、不迁移旧格式。

```jsonc
// Workspace 配置
{
  "schemaVersion": 1,
  "workroot": "C:/Code/myapp",
  "activeTarget": "qt-app-debug-x64",
  "targets": {},
  "qtModulePrefs": {},
  "cppModulePrefs": {},
  "remote": {},
  "sync": {}
}
```

### `~/.forja/servers.json`

```jsonc
[
  {
    "id": "uuid-string",
    "name": "开发服务器",
    "host": "10.0.0.100",
    "port": 22,
    "username": "dev",
    "authMode": "key",
    "privateKeyPath": "~/.ssh/id_rsa",
    "password": "",
    "remotePathHistory": [
      "/home/dev/project-a",
      "/home/dev/project-b"
    ]
  }
]
```

`remotePathHistory` 为可选的服务器级目录历史，按最近使用优先排列；当前项目实际选择的目录仍保存在项目 remote 配置中。

---

## 错误处理约定

1. **`--json` 模式始终输出合法 JSON**，即使内部异常
2. 异常时输出格式：`{ "ok": false, "action": "...", "diagnostics": [{ "level": "error", "message": "..." }] }`
3. `diagnostics` 中的 `message` 跟随 locale，`fix` 提供可执行的修复命令
4. `nextAction` 提供可直接执行的命令建议
5. 退出码：`0` = 成功，`1` = 失败

---

## Locale

诊断消息和文本输出支持多语言。

**优先级**：`--lang` flag > 已保存的 lang > `FORJA_LANG` 环境变量 > 系统 locale > 默认 `en`

**不影响**：
- `nextAction` 命令字符串 — 永远英文命令
- `ReadinessState` 值 — 永远英文枚举
