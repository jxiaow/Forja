# Forja 统一命令 API 文档

本文档定义 Forja 收敛后的对外命令契约。它面向用户、脚本、AI 工具和 VSCode 适配层，描述每个公开命令的功能、输入、输出和错误语义。

## 公开命令集

对外暴露以下 11 个顶层命令：

```bash
forja status
forja setup
forja list
forja use
forja server
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

| 主命令 | 可见动作 | 说明 |
| --- | --- | --- |
| `forja status` | `--process` | 查看当前状态和下一步。 |
| `forja setup` | `--local-only` | 一站式初始化（本地 + 远程）。 |
| `forja list` | `targets`、`env`、`servers`、`remote-repos`、`remote`、`config`、`lang` | 只读列举可选项和配置。默认 `targets`。 |
| `forja use` | `target`、`execution`、`sync`、`remote`、`qt`、`sdk`、`lang` | 选择目标、构建配置、执行端和远程配置。 |
| `forja server` | `add`、`update`、`remove` | 管理共享 SSH server。 |
| `forja build` | `fresh`、`qmake`、`rcc` | 构建相关动作。 |
| `forja run` | `designer <ui-file>`、`--custom <name>`、`--detach` | 运行当前目标。 |
| `forja stop` | 无 | 停止当前运行目标。 |
| `forja clean` | 无 | 清理构建产物。 |
| `forja doctor` | `fix`、`unlock`、`restore`、`reset`、`clean-untracked` | 诊断和恢复动作。 |
| `forja sync` | `plan`、`reset`、`transfer` | 同步和同步预览。 |

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

| 字段 | 含义 |
| --- | --- |
| `kind` | 当前目标类型，`qt` 表示 qmake 项目，`sdk` 表示 `.sln` 或 `Makefile` 项目。 |
| `project` | 当前项目入口文件，优先使用相对 workspace 的路径。 |
| `mode` | 构建模式。 |
| `arch` | 目标架构。非 Windows 平台通常只允许 `x64`。 |
| `runAt` | 执行端。`local` 表示本机执行，`remote` 表示通过远程流水线执行。 |

### Candidate

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
  code: string;                        // 稳定机器码，格式: <domain>.<condition>
  level: 'info' | 'warning' | 'error';
  message: string;                     // 人读文本，跟随 locale
  hint?: string;                       // 人读提示，跟随 locale
  params?: Record<string, string>;     // 模板变量，供 message/hint 插值
}
```

`code` 不随语言变化，AI/脚本用 `code` 判断，不依赖 `message` 文本。

### JSON 输出 Envelope

所有 `--json` 输出必须是合法 JSON。命令成功时退出码为 `0`，失败时退出码为 `1`。

```ts
interface ForjaJsonResult {
  ok: boolean;
  action: string;
  workspace?: string;
  activeTarget?: ActiveTarget;
  diagnostics?: Diagnostic[];
  nextActions?: string[];
  [key: string]: unknown;   // 各命令可扩展额外字段
}
```

输出约定：

- `ok` 和 `action` 必须始终存在。
- `diagnostics` 只在有诊断时输出。
- `nextActions` 只输出新命令，不输出旧命令。
- 文本模式下 `nextActions` 中去除 `--json` 后缀。

### 共享数据结构

#### Readiness

```ts
type ReadinessState = 'ready' | 'configured' | 'blocked' | 'missing' | 'unknown' | 'not-selected';

interface Readiness {
  target?: ReadinessState;
  toolchain?: ReadinessState;
  sync?: ReadinessState;
  remote?: ReadinessState;
  runtime?: ReadinessState;
}
```

#### CheckResult

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

```ts
interface CommandPlan {
  mode: 'dryRun';
  commands?: string[];
  shellCommand?: string;
  willWrite?: string[];
  willRun?: string[];
}
```

#### ServerSummary / ServerDetail

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

interface ServerDetail extends ServerSummary {
  privateKeyPath?: string;
  strictHostKeyChecking?: boolean;
}
```

不输出密码。

#### EnvSummary

```ts
interface EnvSummary {
  qt?: string;
  vs?: string;
  jom?: string;
  make?: string;
}
```

#### ConfigSummary

```ts
interface ConfigSummary {
  lang?: string;
  qt?: { configured: boolean; project?: string; mode?: string; arch?: string; qtPath?: string; vsInstall?: string };
  sdk?: { configured: boolean; project?: string; mode?: string; arch?: string; vsInstall?: string };
  sync?: { configured: boolean; enabled?: boolean; selectedServer?: string; remotePath?: string };
  remote?: RemoteConfigSummary;
}
```

#### RemoteConfigSummary

```ts
interface RemoteConfigSummary {
  selectedServer?: string;
  server?: ServerSummary;
  remotePath?: string;
  remoteWorkspace?: string;
  remoteForjaBin?: string;
  buildOrder?: { target: string; action: string; args: string[] }[];
  transferConfigured?: boolean;
}
```

#### SyncPlan

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

### 通用参数

| 参数 | 适用命令 | 含义 |
| --- | --- | --- |
| `--workspace <path>` | 所有命令 | 指定工作区。默认当前目录。 |
| `--json` | 所有命令 | 输出结构化 JSON。 |
| `--lang <locale>` | 所有命令 | 临时覆盖语言（`zh` / `en`）。 |
| `--plan` | `setup`、`build`、`clean`、`doctor fix` | 只预览，不执行会产生外部影响的动作。 |

### 动作与参数规则

```bash
forja <主命令> <子命令> [对象] [--修饰参数]
```

- 子命令用位置参数表达：`forja build qmake`、`forja doctor unlock <lock-id>`、`forja sync plan`。
- `--flag` 只表达修饰参数：`--json`、`--workspace`、`--force`、`--file`。
- 未知 flag 会报错，不会静默忽略。

---

## `forja status`

### 功能

查看当前工作区状态和下一步建议。轻量、只读，不做深度 SSH、不做完整工具链探测、不修改配置。

### 语法

```bash
forja status [--process] [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--process` | boolean | 否 | 同时返回当前目标运行态。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### 行为

1. 读取 workspace 和 `activeTarget`。
2. 读取 Qt、SDK、Sync、Remote 设置摘要。
3. 如果没有 `activeTarget`，返回 `nextActions: ["forja list targets", "forja use target --project <path>"]`。
4. 如果有 `activeTarget`，汇总 readiness。
5. `--process` 时返回 `runtime` 字段。

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

---

## `forja setup`

### 功能

一站式初始化。替代旧 `forja init`，同时处理本地初始化和远程配置。

### 语法

```bash
forja setup [--local-only] [--host <host>] [--username <user>] [--port <port>] [--server <id>] [--remote-path <path>] [--plan] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--local-only` | boolean | 否 | 只做本地初始化，跳过远程配置。 |
| `--host <host>` | string | 否 | 远程主机地址（自动创建 server）。 |
| `--username <user>` | string | 否 | 远程用户名。 |
| `--port <port>` | number | 否 | SSH 端口（默认 22）。 |
| `--server <id>` | string | 否 | 指定已有 server ID。 |
| `--remote-path <path>` | path | 否 | 远程工作根路径。 |
| `--plan` | boolean | 否 | 预览，不写入配置。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### 行为

**Phase 1 — 本地初始化**：
1. 扫描 Qt/SDK 目标。
2. 检测工具链（Qt、VS、jom、make）。
3. 保存无歧义的默认配置。

**Phase 2 — 远程配置**（`--local-only` 时跳过）：
1. 解析服务器（`--server` > `--host` 自动创建 > 已有单个 server）。
2. 配置远程路径和同步。
3. 部署 Forja 到远程。
4. 远程初始化。
5. 切换执行模式到 remote。

### JSON 输出

```json
{
  "ok": true,
  "action": "setup",
  "workspace": "C:/repo",
  "local": {
    "qtTargets": 2,
    "sdkTargets": 1,
    "toolchain": { "qt": true, "vs": true, "jom": true },
    "configured": true
  },
  "remote": {
    "serverId": "abc-123",
    "serverName": "dev",
    "host": "10.0.0.1",
    "remotePath": "/home/dev/workspace",
    "syncEnabled": true,
    "forjaDeployed": true,
    "forjaVersion": "0.7.0",
    "executionMode": "remote",
    "configured": true
  },
  "steps": {
    "localConfig": "done",
    "serverSetup": "done",
    "remoteConfig": "done",
    "syncSetup": "done",
    "forjaDeploy": "done",
    "remoteInit": "done",
    "executionSwitch": "done"
  },
  "nextActions": ["forja build", "forja status"]
}
```

---

## `forja list`

### 功能

列出可选项和配置摘要。只读，不修改配置。

### 语法

```bash
forja list <category> [--workspace <path>] [--json]
forja list servers --detail <id> [--json]
```

**必须指定分类参数**，不支持裸 `forja list`。

### 分类

| 分类 | 说明 |
| --- | --- |
| `targets` | 列出 Qt `.pro` 和 SDK `.sln`/`Makefile` 候选目标。 |
| `env` | 列出 Qt/VS/jom/make 候选路径。 |
| `servers` | 列出 SSH server。`--detail <id>` 查看单个详情。 |
| `remote-repos` | 列出远程 repo 映射。 |
| `remote` | 列出远程配置（workspace/bin/build-order/transfer/repos）。 |
| `config` | 列出 Qt/SDK/Sync/Remote 已保存配置摘要。 |
| `lang` | 显示当前语言设置。 |

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `category` | enum | 是 | 分类参数。 |
| `--detail <id>` | string | 否 | 查看单个服务器详情，仅用于 `servers`。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### JSON 输出（targets）

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
    }
  ]
}
```

---

## `forja use`

### 功能

选择当前 Forja 使用的目标、构建配置、执行端和远程配置。

### 语法

```bash
forja use target [--project <path>] [--mode debug|release] [--arch x86|x64] [--json]
forja use execution --local|--remote [--json]
forja use sync --server <id> --remote-path <path> [--enable|--disable] [--json]
forja use remote --server <id> --remote-path <path> [--json]
forja use remote workspace --mode legacy|staged --path <path> [--clear] [--json]
forja use remote repo --local <name> --remote <name> --role <role> --path <path> [--json]
forja use remote forja-bin --path <path> [--clear] [--json]
forja use remote build-order <qt:build> <sdk:build> ... [--clear] [--json]
forja use remote transfer --server <id> --path <path> --artifact <path> [--clear] [--json]
forja use qt --qt-path <path> [--vs-dev-shell <path>] [--qmake-target <name>] [--qmake-args <args>] [--json]
forja use sdk --vs-dev-cmd <path> [--json]
forja use lang <zh|en> [--json]
```

### 子命令说明

| 子命令 | 说明 |
| --- | --- |
| `target` | 选择项目、设置 mode/arch。 |
| `execution` | 切换执行端（local/remote）。 |
| `sync` | 配置同步 server/path、启用/禁用。 |
| `remote` | 快捷设置 server + remote-path。 |
| `remote workspace` | 设置远程 workspace 路径和模式。 |
| `remote repo` | 配置远程 repo 映射。 |
| `remote forja-bin` | 设置远端 Forja 可执行文件路径。 |
| `remote build-order` | 设置远程构建顺序。 |
| `remote transfer` | 配置 artifact transfer。 |
| `qt` | 设置 Qt 工具链路径。 |
| `sdk` | 设置 SDK 工具链路径。 |
| `lang` | 设置界面语言。 |

### JSON 输出

```json
{
  "ok": true,
  "action": "use",
  "useTarget": "target",
  "changed": ["activeTarget"],
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "release",
    "arch": "x64",
    "runAt": "local"
  },
  "nextActions": ["forja status"]
}
```

---

## `forja server`

### 功能

管理共享 SSH server。增删改操作。

### 语法

```bash
forja server add --name <name> --host <host> --username <user> [--port <port>] [--auth-mode key|password] [--private-key-path <path>] [--password <pass>] [--strict-host-key-checking] [--json]
forja server update <id> [--name <name>] [--host <host>] [--username <user>] [--port <port>] [--json]
forja server remove <id> [--json]
```

### 输入（add）

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--name <name>` | string | 是 | 服务器名称。 |
| `--host <host>` | string | 是 | 主机地址。 |
| `--username <user>` | string | 是 | 用户名。 |
| `--port <port>` | number | 否 | SSH 端口（默认 22）。 |
| `--auth-mode key|password` | enum | 否 | 认证模式（默认 key）。 |
| `--private-key-path <path>` | path | 否 | 私钥路径。 |
| `--password <pass>` | string | 否 | 密码（authMode=password 时）。 |
| `--strict-host-key-checking` | boolean | 否 | 启用严格主机密钥检查。 |
| `--no-strict-host-key-checking` | boolean | 否 | 禁用严格主机密钥检查。 |

### JSON 输出

```json
{
  "ok": true,
  "action": "server",
  "serverAction": "add",
  "server": {
    "id": "abc-123",
    "name": "dev",
    "host": "10.0.0.1",
    "port": 22,
    "username": "dev",
    "authMode": "key"
  },
  "changed": ["servers"]
}
```

---

## `forja build`

### 功能

构建当前 active target。统一处理 Qt、SDK、本地和远程。

### 语法

```bash
forja build [fresh|qmake|rcc] [--workspace <path>] [--plan] [--project <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 否 | 为空、`fresh`、`qmake`、`rcc`。 |
| `--plan` | boolean | 否 | 只输出计划，不执行构建。 |
| `--project <path>` | path | 否 | 直接指定项目路径（绕过 activeTarget）。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### Action 语义

| 命令 | Qt 目标 | SDK 目标 |
| --- | --- | --- |
| `forja build` | 必要时 qmake/rcc，然后 build。 | 正常 build。 |
| `forja build fresh` | clean + qmake + rcc + build。 | rebuild 或 clean + build。 |
| `forja build qmake` | 只跑 qmake。 | 失败：SDK 没有 qmake 步骤。 |
| `forja build rcc` | 只跑 rcc。 | 失败：SDK 没有 rcc 步骤。 |

### JSON 输出

```json
{
  "ok": true,
  "action": "build",
  "buildAction": "default",
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

---

## `forja run`

### 功能

运行当前目标。Qt 支持运行；SDK 不支持。

### 语法

```bash
forja run [--detach] [--custom <name>] [--plan] [--workspace <path>] [--json]
forja run designer <ui-file> [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--detach` | boolean | 否 | 后台运行。 |
| `--custom <name>` | string | 否 | 运行已保存自定义命令。仅 Qt。 |
| `--plan` | boolean | 否 | 显示计划，不执行。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

> `--debug` 仅在 VSCode 中可用，CLI 不支持调试会话。

### JSON 输出

```json
{
  "ok": true,
  "action": "run",
  "runAction": "default",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "runtime": {
    "running": true,
    "pid": 12345,
    "executablePath": "C:/repo/debug/app.exe",
    "logFile": "C:/repo/.forja/logs/run.log",
    "runAt": "local"
  }
}
```

---

## `forja stop`

### 功能

停止当前运行目标。

### 语法

```bash
forja stop [--workspace <path>] [--json]
```

### JSON 输出

```json
{
  "ok": true,
  "action": "stop",
  "state": "stopped",
  "runtime": {
    "running": false,
    "pid": 12345,
    "runAt": "local"
  }
}
```

---

## `forja clean`

### 功能

清理当前目标构建产物。

### 语法

```bash
forja clean [--workspace <path>] [--plan] [--json]
```

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
  },
  "state": "cleaned"
}
```

---

## `forja doctor`

### 功能

深度诊断。比 `status` 慢，负责检查工具链、同步配置、SSH、远端 Forja、远程 workspace 和恢复建议。

### 语法

```bash
forja doctor [--remote] [--server <id>] [--workspace <path>] [--json]
forja doctor fix [--remote] [--server <id>] [--plan] [--workspace <path>] [--json]
forja doctor unlock <lock-id> [--force] [--workspace <path>] [--json]
forja doctor restore <repo> <paths...> [--workspace <path>] [--json]
forja doctor reset <repo> <paths...> [--workspace <path>] [--json]
forja doctor clean-untracked <repo> <paths...> [--recursive] [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 否 | 为空、`fix`、`unlock`、`restore`、`reset`、`clean-untracked`。 |
| `--remote` | boolean | 否 | 即使 `runAt=local`，也检查远程。 |
| `--server <id>` | string | 否 | 指定服务器。 |
| `--force` | boolean | 否 | 强制执行恢复动作。 |
| `--recursive` | boolean | 否 | 递归清理未跟踪文件。 |
| `--plan` | boolean | 否 | 只预览修复计划。 |

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

---

## `forja sync`

### 功能

同步变更文件到远程。

### 语法

```bash
forja sync [--workspace <path>] [--file <path>] [--repo <name>] [--server <id>] [--json]
forja sync plan [--workspace <path>] [--file <path>] [--repo <name>] [--server <id>] [--json]
forja sync reset [--workspace <path>] [--json]
forja sync transfer [--workspace <path>] [--json]
```

### 输入

| 输入 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | enum | 否 | 为空、`plan`、`reset`、`transfer`。 |
| `--file <path>` | path | 否 | 指定文件，可重复。 |
| `--repo <name>` | string | 否 | 指定 repo。 |
| `--server <id>` | string | 否 | 临时覆盖服务器。 |
| `--workspace` | path | 否 | 工作区路径。 |
| `--json` | boolean | 否 | 输出 JSON。 |

### JSON 输出

```json
{
  "ok": true,
  "action": "sync",
  "syncAction": "run",
  "server": "dev",
  "remotePath": "/home/dev/workspace",
  "uploaded": ["app/src/main.cpp"],
  "deleted": [],
  "skipped": [],
  "transfer": {
    "configured": true,
    "executed": true,
    "artifacts": ["build/app.zip"]
  }
}
```

---

## 错误码和退出码

| 情况 | 退出码 | JSON `ok` |
| --- | --- | --- |
| 成功 | `0` | `true` |
| 参数错误 | `1` | `false` |
| 配置缺失 | `1` | `false` |
| 构建失败 | `1` | `false` |
| 远程连接失败 | `1` | `false` |
| 未知 flag | `1` | `false` |
| 用户取消交互 | `0` | `false` |

## Locale

诊断消息和文本输出支持多语言。`--lang` flag > 已保存的 lang 设置 > `FORJA_LANG` 环境变量 > 系统 locale > 默认 `en`。

**不影响**：
- `Diagnostic.code` — 永远英文机器码
- `nextActions` 命令字符串 — 永远英文命令

## VSCode 对外命令 API

| Command ID | 标题 | 对应 CLI |
| --- | --- | --- |
| `forja.status` | `Forja: Status` | `forja status` |
| `forja.setup` | `Forja: Setup` | `forja setup` |
| `forja.list` | `Forja: List` | `forja list` |
| `forja.use` | `Forja: Use` | `forja use` |
| `forja.server` | `Forja: Server` | `forja server` |
| `forja.build` | `Forja: Build` | `forja build` |
| `forja.run` | `Forja: Run` | `forja run` |
| `forja.stop` | `Forja: Stop` | `forja stop` |
| `forja.clean` | `Forja: Clean` | `forja clean` |
| `forja.doctor` | `Forja: Doctor` | `forja doctor` |
| `forja.sync` | `Forja: Sync` | `forja sync` |
