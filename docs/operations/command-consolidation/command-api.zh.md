# Forja 统一命令 API 文档

本文档定义 Forja 收敛后的对外命令契约。它面向用户、脚本、AI 工具和 VSCode 适配层，描述每个公开命令的功能、输入、输出和错误语义。

## 公开命令集

只对外暴露以下 10 个顶层命令：

```bash
forja status
forja init
forja list
forja use
forja build
forja run
forja stop
forja clean
forja doctor
forja sync
```

不对外暴露这些旧式入口：

```bash
forja qt ...
forja sdk ...
forja remote ...
forja sync use
forja sync servers
forja sync test-connection
```

旧入口在迁移期可以继续存在，但属于隐藏兼容入口，不进入主帮助、Command Palette、QuickPick、`nextActions` 或 AI 工具推荐路径。

## 最终可见动作

公开 API 的可见动作必须受控。顶层命令不扩张，二级动作也不能变成新的模块树。

| 主命令 | 可见动作 | 说明 |
| --- | --- | --- |
| `forja status` | 无 | 查看当前状态和下一步。 |
| `forja init` | 无 | 自动初始化。 |
| `forja list` | `targets`、`env`、`servers`、`remote-repos` | 只读列举可选项。默认 `targets`。 |
| `forja use` | 无 | 选择目标、构建配置、执行端和远程配置。复杂配置优先走交互流程。 |
| `forja build` | `fresh`、`qmake`、`rcc` | 构建相关动作。 |
| `forja run` | 无 | 运行当前目标。调试用 `--debug` 修饰。 |
| `forja stop` | 无 | 停止当前运行目标。 |
| `forja clean` | 无 | 清理构建产物。 |
| `forja doctor` | `fix`、`unlock`、`restore`、`reset`、`clean-untracked` | 诊断和恢复动作。 |
| `forja sync` | `plan`、`reset` | 同步和同步预览。 |

不进入公开动作的能力：

- 服务器增删改、remote repo mapping、remote forja-bin、build-order、artifact transfer 配置属于低频高级配置。它们可以由 `forja use` 的交互流程承接，或在迁移期通过旧兼容命令承接，但不出现在主帮助和 `nextActions`。
- artifact transfer 的执行不再暴露为 `forja sync transfer ...`。如果当前配置启用产物传输，`forja sync` 在同步流程中执行或给出提示；`forja status` / `forja doctor` 负责展示和检查其配置状态。
- VSCode-only 工具动作，例如 “用 Qt Designer 打开”，保留为上下文命令，不进入 CLI 公开 API。

## 通用概念

### ActiveTarget

所有执行类命令围绕当前目标工作。

```ts
interface ActiveTarget {
  kind: 'qt' | 'sdk';
  project: string;
  mode: 'debug' | 'release';
  arch: 'x86' | 'x64';
  runAt: 'local' | 'remote';
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `kind` | 当前目标类型，`qt` 表示 qmake 项目，`sdk` 表示 `.sln` 或 `Makefile` 项目。 |
| `project` | 当前项目入口文件，优先使用相对 workspace 的路径。 |
| `mode` | 构建模式。 |
| `arch` | 目标架构。非 Windows 平台通常只允许 `x64`。 |
| `runAt` | 执行端。`local` 表示本机执行，`remote` 表示通过远程流水线执行。 |

### Candidate

`forja list` 返回的候选目标。

```ts
interface TargetCandidate {
  kind: 'qt' | 'sdk';
  project: string;
  label: string;
  current: boolean;
  configured: boolean;
  diagnostics?: Diagnostic[];
}
```

### Diagnostic

所有 JSON 输出中的诊断项使用统一结构。

```ts
interface Diagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  hint?: string;
}
```

### JSON 输出 Envelope

所有 `--json` 输出必须是合法 JSON。命令成功时退出码为 `0`，失败时退出码为 `1`。

基础结构：

```ts
interface ForjaJsonResult {
  ok: boolean;
  action: string;
  workspace?: string;
  activeTarget?: ActiveTarget;
  diagnostics?: Diagnostic[];
  nextActions?: string[];
}
```

输出约定：

- `ok` 和 `action` 必须始终存在。
- `diagnostics` 只在有诊断时输出。
- `nextActions` 只输出新命令，不输出旧命令。
- 文本模式可以提示兼容命令迁移；JSON 模式不输出噪音文案。
- 路径字段优先使用正斜杠或平台原生路径，但语义必须稳定。

### 共享数据结构

#### Readiness

`status` 和 `doctor` 使用 readiness 表达就绪状态。

```ts
type ReadinessState = 'ready' | 'blocked' | 'missing' | 'unknown' | 'not-selected';

interface Readiness {
  target?: ReadinessState;
  toolchain?: ReadinessState;
  sync?: ReadinessState;
  remote?: ReadinessState;
  runtime?: ReadinessState;
  transfer?: ReadinessState;
}
```

#### CheckResult

`doctor` 的检查项。

```ts
interface CheckResult {
  name: string;
  status: 'ready' | 'blocked' | 'warning' | 'skipped' | 'unknown';
  message?: string;
  diagnostics?: Diagnostic[];
  nextActions?: string[];
}
```

#### RuntimeState

`status --process`、`run`、`stop` 可返回运行态信息。

```ts
interface RuntimeState {
  running: boolean;
  pid?: number;
  executablePath?: string;
  logFile?: string;
  runAt: 'local' | 'remote';
}
```

#### CommandPlan

带 `--plan` 的构建、清理、初始化命令可以返回计划。

```ts
interface CommandPlan {
  mode: 'dryRun';
  commands?: string[];
  shellCommand?: string;
  willWrite?: string[];
  willRun?: string[];
}
```

#### ServerSummary

服务器列表和远程配置摘要不输出密码。

```ts
interface ServerSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMode: 'key' | 'password';
  selected?: boolean;
}
```

#### RemoteSummary

远程相关配置摘要。

```ts
interface RemoteSummary {
  runAt: 'local' | 'remote';
  server?: ServerSummary;
  remotePath?: string;
  remoteWorkspace?: string;
  remoteForjaBin?: string;
  buildOrder?: string[];
  transferConfigured?: boolean;
}
```

#### SyncPlan

同步预览输出。

```ts
interface SyncPlan {
  mode: 'dryRun';
  server: string;
  remotePath: string;
  repos: string[];
  pending: string[];
  deleted: string[];
  skipped: string[];
  skippedDetails?: Array<{ file: string; reason: string }>;
}
```

#### Command Result Types

每个命令的 JSON 输出都继承 `ForjaJsonResult`。

```ts
interface StatusResult extends ForjaJsonResult {
  action: 'status';
  readiness: Readiness;
  runtime?: RuntimeState;
  remote?: RemoteSummary;
}

interface InitResult extends ForjaJsonResult {
  action: 'init';
  detected: {
    qtTargets: number;
    sdkTargets: number;
  };
  saved?: Partial<ActiveTarget>;
  plan?: CommandPlan;
}

interface ListResult extends ForjaJsonResult {
  action: 'list';
  category: 'targets' | 'env' | 'servers' | 'remote-repos';
  targets?: TargetCandidate[];
  servers?: ServerSummary[];
  remote?: RemoteSummary;
  env?: Record<string, unknown>;
}

interface UseResult extends ForjaJsonResult {
  action: 'use';
  activeTarget?: ActiveTarget;
  remote?: RemoteSummary;
  changed: string[];
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
  runtime?: RuntimeState;
  exitCode?: number;
  logFile?: string;
}

interface StopResult extends ForjaJsonResult {
  action: 'stop';
  state: 'stopped' | 'not-running' | 'unsupported';
  runtime?: RuntimeState;
}

interface CleanResult extends ForjaJsonResult {
  action: 'clean';
  plan?: CommandPlan;
  durationMs?: number;
  exitCode?: number;
}

interface DoctorResult extends ForjaJsonResult {
  action: 'doctor';
  doctorAction: 'check' | 'fix' | 'unlock' | 'restore' | 'reset' | 'clean-untracked';
  checks?: CheckResult[];
  changed?: string[];
}

interface SyncResult extends ForjaJsonResult {
  action: 'sync';
  syncAction: 'run' | 'plan' | 'reset';
  plan?: SyncPlan;
  server?: string;
  remotePath?: string;
  uploaded?: string[];
  deleted?: string[];
  skipped?: string[];
  transfer?: {
    configured: boolean;
    planned?: boolean;
    executed?: boolean;
    artifacts?: string[];
  };
}
```

### 通用参数

| 参数 | 适用命令 | 含义 |
| --- | --- | --- |
| `--workspace <path>` | 所有命令 | 指定工作区。默认当前目录。 |
| `--json` | 所有命令 | 输出结构化 JSON。 |
| `--plan` | `init`、`build`、`clean` | 只预览，不执行会产生外部影响的动作。 |

### 动作与参数规则

公开命令遵循：

```bash
forja <主命令> <动作> [对象] [--修饰参数]
```

规则：

- 动作用位置参数表达，例如 `forja build qmake`、`forja doctor unlock <lock-id>`、`forja sync plan`。
- `--flag` 只表达修饰参数，例如 `--json`、`--workspace`、`--remote`、`--force`、`--recursive`、`--file`。
- 不使用 `--restore`、`--reset`、`--unlock`、`--clean-untracked` 这类“看起来是开关、实际是动作”的公开新语法。
- 迁移期可以兼容旧 flag 形态，但新帮助、`nextActions`、VSCode API 和 AI 工具推荐路径必须使用位置动作。

## `forja status`

### 功能

查看当前工作区状态和下一步建议。它是轻量、只读命令，不做深度 SSH、不做完整工具链探测、不修改配置。

### 语法

```bash
forja status [--process] [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--process` | boolean | 否 | 同时返回当前目标运行态，覆盖旧 `qt ps` / `remote qt ps` 能力。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### 行为

1. 读取 workspace。
2. 读取 `activeTarget`。
3. 读取 Qt、SDK、Sync、Remote 设置摘要。
4. 如果没有 `activeTarget`：
   - 如果有多个候选目标，不猜。
   - 返回 `nextActions: ["forja list", "forja use"]`。
5. 如果有 `activeTarget`：
   - 检查项目文件是否存在。
   - 检查 `mode`、`arch`、`runAt` 是否有效。
   - 汇总本地、同步、远程和运行状态。
6. 传入 `--process` 时，返回 `runtime` 字段；不传时只给摘要 readiness。

### JSON 输出

```json
{
  "ok": true,
  "action": "status",
  "workspace": "C:/repo",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "readiness": {
    "target": "ready",
    "sync": "configured",
    "remote": "not-selected"
  },
  "nextActions": ["forja build"]
}
```

### 失败示例

没有当前目标且存在多个候选：

```json
{
  "ok": false,
  "action": "status",
  "diagnostics": [
    {
      "level": "warning",
      "message": "当前工作区存在多个 Forja 目标，尚未选择 active target"
    }
  ],
  "nextActions": ["forja list", "forja use"]
}
```

## `forja init`

### 功能

首次初始化。它只写入可自动确定的配置，不替用户做模糊选择。

### 语法

```bash
forja init [--workspace <path>] [--remote] [--plan] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--workspace` | path | 否 | 工作区路径。 |
| `--remote` | boolean | 否 | 同时检查远程初始化条件。 |
| `--plan` | boolean | 否 | 预览将保存的配置，不写入。 |
| `--json` | boolean | 否 | 输出 JSON。 |

不接受：

```bash
--project
--mode
--arch
--qt-path
--vs-dev-shell
--vs-dev-cmd
```

这些显式选择属于 `forja use`。

### 行为

1. 扫描 Qt 目标。
2. 扫描 SDK 目标。
3. 检测 Qt、VS、jom、make 等工具链。
4. 保存无歧义的默认配置。
5. 如果整个 workspace 只有一个目标，则保存为 `activeTarget`。
6. 如果存在多个目标或同时存在 Qt/SDK，不选择，返回 `forja list` 和 `forja use`。
7. `--remote` 只处理远程初始化前置条件，不替用户选择服务器。

### JSON 输出

```json
{
  "ok": true,
  "action": "init",
  "workspace": "C:/repo",
  "detected": {
    "qtTargets": 2,
    "sdkTargets": 1
  },
  "saved": {
    "mode": "debug",
    "arch": "x64"
  },
  "nextActions": ["forja list", "forja use"]
}
```

## `forja list`

### 功能

列出可选项。它只读，不修改配置。

### 语法

```bash
forja list [targets|env|servers|remote-repos] [--workspace <path>] [--json]
forja list servers --detail <id> [--json]
```

默认分类是 `targets`。

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `category` | enum | 否 | `targets`、`env`、`servers`、`remote-repos`。 |
| `--detail <id>` | string | 否 | 查看单个服务器详情，仅用于 `servers`。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### 行为

`targets`：

- 列出 Qt `.pro`。
- 列出 SDK `.sln` / `Makefile`。
- 标记当前目标。
- 标记配置是否完整。

`env`：

- 列出 Qt/VS/jom/make 候选。
- 不保存设置。

`servers`：

- 列出服务器 ID、名称、host、username。
- 不输出密码。

`remote-repos`：

- 列出远程 repo 映射。

### JSON 输出

```json
{
  "ok": true,
  "action": "list",
  "category": "targets",
  "targets": [
    {
      "kind": "qt",
      "project": "apps/client/client.pro",
      "label": "Qt apps/client/client.pro",
      "current": true,
      "configured": true
    },
    {
      "kind": "sdk",
      "project": "sdk/NemoSDK.sln",
      "label": "SDK sdk/NemoSDK.sln",
      "current": false,
      "configured": false
    }
  ]
}
```

## `forja use`

### 功能

选择当前 Forja 使用的目标、构建配置、执行端和远程配置。它是唯一普通配置入口。

### 语法

```bash
forja use [--workspace <path>] [--json]
forja use --target <project> [--json]
forja use --kind qt|sdk [--json]
forja use --mode debug|release [--arch x86|x64] [--json]
forja use --local [--json]
forja use --remote [--json]
forja use --server <id> --remote-path <path> [--json]
forja use --remote-workspace <path> [--json]
forja use --remote-forja-bin <path> [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--target <project>` | path | 否 | 选择当前项目。`.pro` 推断为 Qt，`.sln`/`Makefile` 推断为 SDK。 |
| `--kind qt|sdk` | enum | 否 | 只切换目标类型。只有该类型唯一候选时才自动成功。 |
| `--mode debug|release` | enum | 否 | 设置构建模式。 |
| `--arch x86|x64` | enum | 否 | 设置架构。 |
| `--local` | boolean | 否 | 设置 `runAt=local`。 |
| `--remote` | boolean | 否 | 设置 `runAt=remote`。 |
| `--server <id>` | string | 否 | 选择远程服务器。 |
| `--remote-path <path>` | path | 和 `--server` 一起使用 | 设置远程工作根路径。 |
| `--remote-workspace <path>` | path | 否 | 设置 staged/managed remote workspace 路径。 |
| `--remote-forja-bin <path>` | path | 否 | 设置远端 Forja 可执行文件路径。 |

### 行为

1. 无参数且是交互终端：进入选择流程。
2. 有参数：只更新显式传入字段。
3. `--target` 必须位于 workspace 内。
4. `--kind` 遇到多个候选时失败并提示 `forja list`。
5. `--remote` 不自动创建服务器配置。
6. 成功后返回 `nextActions: ["forja status"]`。

### JSON 输出

```json
{
  "ok": true,
  "action": "use",
  "changed": ["activeTarget", "runAt"],
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "release",
    "arch": "x64",
    "runAt": "remote"
  },
  "nextActions": ["forja status"]
}
```

### 常见失败

多个 Qt 目标时执行：

```bash
forja use --kind qt --json
```

输出：

```json
{
  "ok": false,
  "action": "use",
  "diagnostics": [
    {
      "level": "warning",
      "message": "检测到多个 Qt 目标，无法仅根据 kind 自动选择"
    }
  ],
  "nextActions": ["forja list", "forja use --target <project>"]
}
```

## `forja build`

### 功能

构建当前 active target。它统一处理 Qt、SDK、本地和远程。

### 语法

```bash
forja build [fresh|qmake|rcc] [--workspace <path>] [--plan] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 否 | 为空、`fresh`、`qmake`、`rcc`。 |
| `--plan` | boolean | 否 | 只输出计划，不执行构建。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### Action 语义

| 命令 | Qt 目标 | SDK 目标 |
| --- | --- | --- |
| `forja build` | 必要时 qmake/rcc，然后 build。 | 正常 build。 |
| `forja build fresh` | clean + qmake + rcc + build。 | rebuild 或 clean + build。 |
| `forja build qmake` | 只跑 qmake。 | 失败：SDK 没有 qmake 步骤。 |
| `forja build rcc` | 只跑 rcc。 | 失败：SDK 没有 rcc 步骤。 |

### 行为

1. 读取 active target。
2. 没有 active target 时失败，返回 `forja list` 和 `forja use`。
3. `runAt=local` 时调用本地 Qt/SDK 后端。
4. `runAt=remote` 时先做远程 preflight 和 workspace prepare，再调用远程 Qt/SDK 后端。
5. `qmake` 和 `rcc` 只适用于 Qt target。
6. `--plan` 不执行构建、不修改远端。

### JSON 输出

```json
{
  "ok": true,
  "action": "build",
  "buildAction": "qmake",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "durationMs": 1200
}
```

失败示例：

```json
{
  "ok": false,
  "action": "build",
  "buildAction": "qmake",
  "activeTarget": {
    "kind": "sdk",
    "project": "sdk/NemoSDK.sln",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "diagnostics": [
    {
      "level": "error",
      "message": "当前 SDK 目标没有 qmake 构建步骤"
    }
  ],
  "nextActions": ["forja build"]
}
```

## `forja run`

### 功能

运行当前目标。Qt 支持运行；SDK 默认不支持运行。

### 语法

```bash
forja run [--detach] [--debug] [--custom <name>] [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--detach` | boolean | 否 | 后台运行。 |
| `--debug` | boolean | 否 | 调试运行，覆盖旧 `forja.qt.debug` 能力。仅 Qt 目标支持。 |
| `--custom <name>` | string | 否 | 运行已保存的自定义命令，覆盖旧 `forja.qt.runCustomCommand` 能力。仅 Qt 目标支持。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### 行为

1. 读取 active target。
2. Qt local：必要时构建，然后运行。
3. Qt remote：远程准备后运行。
4. SDK：失败，提示 `forja build`。
5. `--detach --json` 返回 pid 和 logFile。
6. `--debug` 和 `--custom` 互斥。
7. `--custom` 只允许引用已保存的自定义命令名称，不接受任意 shell 字符串，避免把 `run` 变成通用 shell 执行器。

### JSON 输出

```json
{
  "ok": true,
  "action": "run",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "pid": 12345,
  "logFile": "C:/repo/.forja/logs/run.log"
}
```

## `forja stop`

### 功能

停止当前运行目标。

### 语法

```bash
forja stop [--workspace <path>] [--json]
```

### 行为

- Qt local：停止本地进程。
- Qt remote：停止远程进程。
- SDK：返回不支持运行态。
- 没有运行记录：返回 `state: "not-running"`，不视为严重错误。

### JSON 输出

```json
{
  "ok": true,
  "action": "stop",
  "state": "stopped"
}
```

## `forja clean`

### 功能

清理当前目标构建产物。

### 语法

```bash
forja clean [--workspace <path>] [--plan] [--json]
```

### 行为

- Qt local：调用 Qt clean。
- SDK local：调用 SDK clean。
- Remote：远程 preflight 后调用远程 clean。
- `--plan` 只输出计划，不删除产物。

### JSON 输出

```json
{
  "ok": true,
  "action": "clean",
  "activeTarget": {
    "kind": "sdk",
    "project": "sdk/NemoSDK.sln",
    "mode": "release",
    "arch": "x64",
    "runAt": "local"
  }
}
```

## `forja doctor`

### 功能

深度诊断。它比 `status` 慢，负责检查工具链、同步配置、SSH、远端 Forja、远程 workspace 和恢复建议。

### 语法

```bash
forja doctor [--remote] [--workspace <path>] [--json]
forja doctor fix [--remote] [--workspace <path>] [--json]
forja doctor unlock <lock-id> [--force] [--workspace <path>] [--json]
forja doctor restore <repo> <paths...> [--workspace <path>] [--json]
forja doctor reset <repo> <paths...> [--workspace <path>] [--json]
forja doctor clean-untracked <repo> <paths...> [--recursive] [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 否 | 为空、`fix`、`unlock`、`restore`、`reset`、`clean-untracked`。 |
| `--remote` | boolean | 否 | 即使当前 `runAt=local`，也检查远程配置。 |
| `lock-id` | string | `unlock` | 解远程锁。 |
| `repo` | string | 恢复场景 | 指定远端 repo。 |
| `paths...` | path[] | 恢复场景 | 受影响的远端路径。 |
| `--recursive` | boolean | 否 | 递归清理未跟踪文件。 |
| `--force` | boolean | 否 | 强制执行显式恢复动作。 |

### 行为

1. 检查当前 active target。
2. 检查本地工具链。
3. 检查 sync 配置。
4. 当 `runAt=remote` 或传入 `--remote` 时检查远程。
5. `fix` 只允许非破坏性修复。
6. 恢复类动作必须显式传入对应参数，不能由普通 `doctor` 自动执行。

### JSON 输出

```json
{
  "ok": false,
  "action": "doctor",
  "doctorAction": "check",
  "checks": [
    { "name": "localToolchain", "status": "ready" },
    { "name": "remoteForjaBin", "status": "missing" }
  ],
  "nextActions": ["forja doctor fix --remote"]
}
```

## `forja sync`

### 功能

同步变更文件。它保留为顶层命令，因为“同步”是独立用户目标。

### 语法

```bash
forja sync [--workspace <path>] [--file <path>] [--repo <name-or-path>] [--json]
forja sync plan [--workspace <path>] [--file <path>] [--repo <name-or-path>] [--json]
forja sync reset [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 否 | 为空、`plan`、`reset`。 |
| `--file <path>` | path | 否 | 指定单个文件，可重复。 |
| `--repo <name-or-path>` | string | 否 | 指定 repo 名称或单仓库远程目标路径。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### 行为

1. 读取 sync 配置。
2. 缺少 server 或 remote path 时失败，不尝试 SSH。
3. `plan` 只输出计划。
4. `--file` 限定同步文件。
5. `--repo` 限定 repo 或覆盖单仓库远程路径。
6. `reset` 只清状态，不上传。
7. 如果当前配置启用了 artifact transfer，`sync` 可以在普通同步后执行产物传输；`sync plan` 只展示将要传输的摘要，不执行传输。
8. artifact transfer 的配置不通过公开 `sync transfer ...` 子命令暴露；状态查看归 `status`，深度检查归 `doctor`，选择/修改归 `use` 的高级配置流程。

### JSON 输出

```json
{
  "ok": true,
  "action": "sync",
  "syncAction": "run",
  "server": "dev",
  "remotePath": "/home/dev/workspace",
  "uploaded": ["app/src/main.cpp", "app/src/main.h"],
  "deleted": [],
  "skipped": [],
  "transfer": {
    "configured": true,
    "executed": true,
    "artifacts": ["build/app.zip"]
  }
}
```

缺配置示例：

```json
{
  "ok": false,
  "action": "sync",
  "diagnostics": [
    {
      "level": "error",
      "message": "尚未配置同步服务器或远程路径"
    }
  ],
  "nextActions": [
    "forja list servers",
    "forja use --server <id> --remote-path <path>"
  ]
}
```

## 错误码和退出码

| 情况 | 退出码 | JSON `ok` |
| --- | --- | --- |
| 成功 | `0` | `true` |
| 参数错误 | `1` | `false` |
| 配置缺失 | `1` | `false` |
| 构建失败 | `1` | `false` |
| 远程连接失败 | `1` | `false` |
| 用户取消交互 | `0` | `false` 或不输出变更，具体由交互实现决定 |

## VSCode 对外命令 API

VSCode Command Palette 只显示：

| Command ID | 标题 | 对应 CLI |
| --- | --- | --- |
| `forja.status` | `Forja: Status` | `forja status` |
| `forja.init` | `Forja: Init` | `forja init` |
| `forja.list` | `Forja: List Targets` | `forja list` |
| `forja.use` | `Forja: Use Target` | `forja use` |
| `forja.build` | `Forja: Build` | `forja build` |
| `forja.run` | `Forja: Run` | `forja run` |
| `forja.stop` | `Forja: Stop` | `forja stop` |
| `forja.clean` | `Forja: Clean` | `forja clean` |
| `forja.doctor` | `Forja: Doctor` | `forja doctor` |
| `forja.sync` | `Forja: Sync Changes` | `forja sync` |

兼容命令 ID 继续注册但隐藏，例如：

```text
forja.qt.build
forja.sdk.build
forja.remote.qt.build
```

## 兼容与弃用

- 旧 CLI 命令迁移期继续可用。
- 旧 VSCode command ID 不删除。
- 新文档、新 `nextActions`、新帮助文本只推荐统一命令。
- 文本输出可以提示迁移；JSON 输出不默认加入弃用噪音。
- 对外 API 以本文档为准。
