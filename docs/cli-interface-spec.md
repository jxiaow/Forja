# CLI 接口规范

本文档定义 compilot CLI 的输入参数、输出结构和数据类型，供 AI 工具和集成方参考。

## 调用约定

```
compilot <subcommand> <action> [options]
```

- 当前已实现子命令：`qt` | `sdk` | `cleanup`
- `remote` 相关内容是远程部署设计稿，当前 CLI dispatcher 尚未实现 `compilot remote ...`
- 所有命令加 `--json` 输出结构化 JSON
- 退出码：`0` 成功，`1` 失败
- 即使发生异常，`--json` 模式也保证输出合法 JSON

---

## 通用参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--workspace <path>` | string | `process.cwd()` | 操作根目录，用于定位本地配置、扫描项目和执行命令 |
| `--json` | boolean | `false` | JSON 格式输出 |

`--workspace` 不是 `.pro` 文件路径。Qt 多项目仓库中，`--workspace` 指向仓库/工作区根目录，具体 `.pro` 通过 `compilot qt use --project <relative.pro>` 选择；`build` / `run` / `clean` / `qmake` 只读取该 workspace 已保存的项目和构建配置。

## Qt 命令参数矩阵

`status` 是推荐第一条命令。`build` / `run` / `clean` / `qmake` / `stop` 只读取已保存配置，不接受构建配置参数；缺项目、mode/arch 未确认或配置不完整时返回 `compilot qt status --json`，由 `status` 统一给出后续动作。

| 命令 | 允许参数 |
|------|----------|
| `status` | `--workspace`, `--json` |
| `init` | `--workspace`, `--json`, `--plan`, `--dry-run` |
| `use` | `--workspace`, `--json`, `--plan`, `--dry-run`, `--project`, `--mode`, `--arch`, `--qt-path`, `--vs-dev-shell`, `--target` |
| `env` | `--workspace`, `--json` |
| `projects` | `--workspace`, `--json` |
| `qmake` | `--workspace`, `--json`, `--plan`, `--dry-run` |
| `build` | `--workspace`, `--json`, `--plan`, `--dry-run` |
| `run` | `--workspace`, `--json`, `--plan`, `--dry-run`, `--detach` |
| `clean` | `--workspace`, `--json`, `--plan`, `--dry-run` |
| `stop` | `--workspace`, `--json` |
| `logs` | `--workspace`, `--json` |
| `sync` | `--workspace`, `--json`, `--plan`, `--dry-run`, `--server`, `--repo` |
| `rcc` | `--workspace`, `--json`, `--plan`, `--dry-run` |

`sync --plan` / `sync --dry-run` 只做本地预览，返回目标服务器、远程路径、仓库列表、待同步文件和跳过文件，不执行 SSH/SCP。

## Qt use 配置参数

以下参数只允许用于 `compilot qt use`。`compilot qt init` 只做自动初始化，不接收显式构建配置：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--project <path>` | string | 自动检测 / 已保存值 | 当前项目文件路径（.pro） |
| `--mode <mode>` | `debug` \| `release` | `debug` / 已保存值 | 构建模式；默认值只是 `status` 建议，需 `use` 写入确认 |
| `--arch <arch>` | `x86` \| `x64` | 平台默认值 / 已保存值 | 目标架构；单架构平台由 `init` 自动写入，多架构平台需 `use` 写入确认 |
| `--qt-path <path>` | string | 自动检测 / 已保存值 | Qt 安装路径 |
| `--vs-dev-shell <path>` | string | 自动检测 / 已保存值 | VS DevShell 路径 |
| `--target <name>` | string | `.pro` TARGET / 已保存值 | QMake TARGET 覆盖 |

## SDK 命令参数矩阵

`status` 是 SDK 推荐第一条命令。`build` / `rebuild` / `clean` 只读取已保存配置，不接受构建配置参数；缺项目、缺本地配置或配置不完整时返回 `compilot sdk status --json`，由 `status` 统一给出后续动作。

| 命令 | 允许参数 |
|------|----------|
| `status` | `--workspace`, `--json` |
| `init` | `--workspace`, `--json` |
| `use` | `--workspace`, `--json`, `--project`, `--mode`, `--arch`, `--vs-dev-cmd` |
| `env` | `--workspace`, `--json` |
| `projects` | `--workspace`, `--json` |
| `build` | `--workspace`, `--json`, `--plan`, `--dry-run` |
| `rebuild` | `--workspace`, `--json`, `--plan`, `--dry-run` |
| `clean` | `--workspace`, `--json`, `--plan`, `--dry-run` |

## SDK use 配置参数

以下参数只允许用于 `compilot sdk use`。`compilot sdk init` 只做自动初始化，不接收显式构建配置：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--project <path>` | string | 自动检测 / 已保存值 | 当前 SDK 项目入口文件（Windows `.sln`，非 Windows `Makefile`） |
| `--mode <mode>` | `debug` \| `release` | `debug` / 已保存值 | 构建模式 |
| `--arch <arch>` | `x86` \| `x64` | 平台默认值 / 已保存值 | 目标架构；非 Windows 只支持 `x64` |
| `--vs-dev-cmd <path>` | string | 自动检测 / 已保存值 | Windows `VsDevCmd.bat` 路径 |

## 远程模式参数（设计稿，暂未实现）

| 参数 | 类型 | 说明 |
|------|------|------|
| `--remote` | boolean | 启用远程编译部署 |
| `--fast` | boolean | 跳过 preCheck + branchSync + baselineCheck |
| `--from <stage>` | string | 从指定阶段开始（见阶段列表） |
| `--force` | boolean | 忽略基线不一致等非致命错误 |

远程阶段：`preCheck` → `branchSync` → `sync` → `baselineCheck` → `build` → `transfer` → `stop` → `launch`

---

## Qt CLI 输出结构

### 类型定义

```typescript
interface QtCliResult {
  ok: boolean;                    // 是否成功
  action: CliAction;              // 执行的动作
  mode: "dryRun" | "execute";    // 执行模式（--plan 时为 dryRun）
  workspace: string;              // 工作区绝对路径
  project: string | null;         // 当前项目路径（相对于 workspace）
  commands: string[];             // shell 命令列表
  shellCommand: string;           // 拼接后的完整命令（可直接执行）
  candidates: string[];           // 候选 .pro 文件列表（相对路径）
  diagnostics: Diagnostic[];      // 诊断信息
  nextActions: string[];          // 建议的下一步操作（人类可读）
  resolved: ResolvedConfig | null; // 当前生效的构建配置
  errors: string[];               // 编译错误行
  exitCode: number | null;        // 进程退出码（execute 模式）
  durationMs: number;             // 执行耗时（ms）
  logFile: string | null;         // 日志文件路径（--detach 模式）
  executablePath?: string;        // run 成功时解析出的可执行文件绝对路径
  stdout: string;                 // 进程标准输出（execute 模式）
  stderr: string;                 // 进程标准错误（execute 模式）
  rccProjectPath: string | null;  // RCC 项目路径
}

type CliAction = "init" | "use" | "status" | "env" | "projects" | "qmake" | "build" | "clean" | "run" | "stop" | "sync" | "logs" | "rcc";

interface Diagnostic {
  level: "info" | "warning" | "error";
  message: string;
  hint?: string;                  // 可选的修复建议
}

interface ResolvedConfig {
  mode: "debug" | "release";
  arch: "x86" | "x64";
  qtPath: string;                 // Qt 安装路径（可能为空）
  vsDevShell: string;             // VsDevShell 路径（可能为空）
  qmakeTarget: string;            // QMake TARGET 名称
  qtVersion?: string;             // Qt 版本号（如 "5.15.2"）
  vsVersion?: string;             // VS 版本号（如 "2022"）
}
```

### JSON 输出字段规则

JSON 模式省略空/默认值字段，只保留非空字段：

| 字段 | 保留条件 |
|------|----------|
| `ok` | 始终保留 |
| `action` | 始终保留 |
| `diagnostics` | 非空数组时保留（仅 warning/error 级别） |
| `nextActions` | 非空数组时保留 |
| `exitCode` | 非 null 时保留 |
| `errors` | 非空数组时保留 |
| `logFile` | 非空时保留 |
| `executablePath` | 非空时保留，通常在 `run` 成功或 `run --plan` 可解析目标时返回 |
| `project` | 非空时保留 |
| `commands` | 非空数组时保留 |
| `shellCommand` | 非空时保留 |
| `candidates` | 非空数组时保留 |
| `resolved` | 非 null 时保留（只含非空子字段，含 configHints） |
| `rccProjectPath` | 非空时保留 |
| `durationMs` | > 0 时保留 |
| `stdout` / `stderr` | 非空时保留 |

detach 成功时 `resolved` 只含 `{ mode, arch }`。

---

## Qt CLI 各 Action 输出特征

### `status`

```jsonc
{
  "ok": true,
  "action": "status",
  "resolved": { "mode": "debug", "arch": "x86", "qtPath": "C:/Qt/5.15.2/msvc2019", ... },
  "nextAction": "build",
  "nextActions": ["compilot qt build --json"],
  "candidates": ["app/app.pro", "lib/lib.pro"],
  "rccProjectPath": "XYRcc/XYRcc.pro",
  "diagnostics": []
}
```

- 不执行任何命令，只返回环境状态
- `candidates` 列出所有找到的 .pro 文件
- `resolved` 反映当前配置（settings + 环境检测）
- `nextAction` 是摘要动作；`nextActions` 是可直接执行的建议命令
- 没有本地配置时返回 `init`；已有配置但缺项目时返回 `projects` 并建议 `use --project`；mode/arch 未确认时返回 `use` 并建议写入默认建议值；缺工具链时返回 `env` 并建议 `use --qt-path` / `use --vs-dev-shell`

### `build` / `run` / `clean` / `qmake`

```jsonc
// --plan 模式
{
  "ok": true,
  "action": "build",
  "mode": "dryRun",
  "commands": ["call VsDevShell.ps1 ...", "cd /d ...", "jom /NOLOGO"],
  "shellCommand": "call VsDevShell.ps1 ... && cd /d ... && jom /NOLOGO",
  "resolved": { "mode": "debug", "arch": "x86", ... }
}

// execute 模式成功
{
  "ok": true,
  "action": "run",
  "mode": "execute",
  "exitCode": 0,
  "executablePath": "C:/workspace/debug/app.exe",
  "durationMs": 12345,
  "commands": [...]
}

// execute 模式失败
{
  "ok": false,
  "action": "build",
  "mode": "execute",
  "exitCode": 2,
  "errors": ["main.cpp(42): error C2065: 'foo': undeclared identifier"],
  "diagnostics": [{ "level": "error", "message": "编译失败" }]
}
```

### `build --detach` / `run --detach`

```jsonc
// detach 成功
{
  "ok": true,
  "action": "run",
  "exitCode": 0,
  "logFile": "C:/Users/.../compilot-logs/workspace/run.log",
  "executablePath": "C:/workspace/release/x86/XYWinQT.exe",
  "resolved": { "mode": "release", "arch": "x86" }
}
```

`logs --json` 返回最近一次 `run --detach` 的状态。Windows 下 `running` 优先按 `executablePath` 的真实进程名判断，避免启动器 PID 退出后误判：

```jsonc
{
  "ok": true,
  "action": "logs",
  "pid": 13228,
  "executablePath": "C:/workspace/release/x86/XYWinQT.exe",
  "running": true,
  "logFile": "C:/Users/.../compilot-logs/workspace/run.log",
  "tail": "..."
}
```

### 错误情况

```jsonc
// 工作区不存在
{
  "ok": true,
  "action": "status",
  "diagnostics": [{ "level": "error", "message": "工作区不存在: C:/nonexist" }]
}

// 未找到 .pro 文件
{
  "ok": false,
  "action": "build",
  "diagnostics": [{ "level": "error", "message": "未配置项目" }],
  "nextActions": ["compilot qt status --json"]
}

// Qt 环境未配置
{
  "ok": true,
  "action": "status",
  "diagnostics": [{ "level": "warning", "message": "未配置 Qt" }],
  "nextAction": "env",
  "nextActions": ["compilot qt env --json", "compilot qt use --qt-path <path> --json"]
}
```

---

## SDK CLI 输出结构

### 类型定义

```typescript
interface SdkCliResult {
  ok: boolean;                    // 是否成功
  action: "init" | "use" | "env" | "projects" | "status" | "build" | "rebuild" | "clean";
  workspace?: string;             // 工作区绝对路径（status 时返回）
  ready?: boolean;                // 配置是否可直接执行 build（status 时）
  checks?: Record<string, boolean>; // settings/project/vsDevCmd/make 检查项
  missing?: string[];             // 缺失项
  nextAction?: string;            // status 建议的下一条动作
  nextActions?: string[];         // 错误或 use 后建议的命令
  project?: string | null;        // 当前项目路径（相对于 workspace）
  candidates?: string[];          // 候选项目列表（status 时）
  resolved?: {
    mode: "debug" | "release";
    arch: "x86" | "x64";
    vsDevCmdPath?: string;
    project?: string;
  };
  commands?: string[];            // shell 命令列表（--plan 时）
  shellCommand?: string;          // 拼接后的 shell 命令（--plan 时）
  exitCode?: number;              // 执行退出码（execute 模式）
  durationMs?: number;            // 执行耗时（execute 模式）
  errors?: string[];              // 编译错误行
  diagnostics?: Diagnostic[];     // 诊断信息
}
```

### `status`

```jsonc
{
  "ok": true,
  "action": "status",
  "workspace": "C:/projects/myapp",
  "ready": true,
  "checks": {
    "settings": true,
    "project": true,
    "vsDevCmd": true
  },
  "nextAction": "build",
  "project": "MyApp.sln",
  "candidates": ["MyApp.sln"],
  "resolved": {
    "mode": "debug",
    "arch": "x86"
  }
}
```

### `use`

```jsonc
{
  "ok": true,
  "action": "use",
  "resolved": {
    "mode": "release",
    "arch": "x64",
    "project": "Makefile"
  },
  "nextActions": ["compilot sdk status --json"]
}
```

### `build --plan`

```jsonc
{
  "ok": true,
  "action": "build",
  "project": "MyApp.sln",
  "commands": ["msbuild \"C:/projects/myapp/MyApp.sln\" /t:Build /p:Configuration=Debug /p:Platform=Win32 /m"],
  "shellCommand": "msbuild \"C:/projects/myapp/MyApp.sln\" /t:Build /p:Configuration=Debug /p:Platform=Win32 /m",
  "resolved": {
    "mode": "debug",
    "arch": "x86"
  }
}
```

### 错误

```jsonc
{
  "ok": false,
  "action": "build",
  "diagnostics": [{ "level": "error", "message": "尚未初始化" }],
  "nextActions": ["compilot sdk status --json"]
}
```

---

## Remote 模式输出结构（设计稿，暂未实现）

以下协议尚未接入当前 CLI 入口，不能作为已发布命令调用。`--remote` 模式计划返回 `DeployResult`：

```typescript
interface DeployResult {
  ok: boolean;
  stages: StageResult[];
  buildResult?: BuildResult;      // 编译阶段的详细结果
  error?: string;                 // 失败原因
}

interface StageResult {
  stage: DeployStage;             // 阶段名
  ok: boolean;
  message: string;
  durationMs: number;
}

type DeployStage = "preCheck" | "branchSync" | "sync" | "baselineCheck" | "build" | "transfer" | "stop" | "launch";
```

### 成功

```jsonc
{
  "ok": true,
  "stages": [
    { "stage": "preCheck", "ok": true, "message": "所有仓库 HEAD 已 push", "durationMs": 120 },
    { "stage": "branchSync", "ok": true, "message": "分支同步完成", "durationMs": 3400 },
    { "stage": "sync", "ok": true, "message": "同步 12 个文件", "durationMs": 5600 },
    { "stage": "baselineCheck", "ok": true, "message": "基线一致", "durationMs": 800 },
    { "stage": "build", "ok": true, "message": "编译成功", "durationMs": 45000 },
    { "stage": "transfer", "ok": true, "message": "传输完成", "durationMs": 2100 },
    { "stage": "stop", "ok": true, "message": "已停止旧进程", "durationMs": 500 },
    { "stage": "launch", "ok": true, "message": "启动成功", "durationMs": 1200 }
  ]
}
```

### 失败

```jsonc
{
  "ok": false,
  "stages": [
    { "stage": "preCheck", "ok": true, "message": "...", "durationMs": 100 },
    { "stage": "branchSync", "ok": true, "message": "...", "durationMs": 3000 },
    { "stage": "sync", "ok": true, "message": "...", "durationMs": 4000 },
    { "stage": "baselineCheck", "ok": true, "message": "...", "durationMs": 600 },
    { "stage": "build", "ok": false, "message": "编译失败 (.): main.cpp:42 error", "durationMs": 12000 }
  ],
  "buildResult": { "ok": false, "errors": ["main.cpp:42: error: ..."], "exitCode": 2 },
  "error": "编译失败 (.): main.cpp:42 error"
}
```

---

## `compilot remote test` 输出结构（设计稿，暂未实现）

```typescript
interface RemoteTestResult {
  ok: boolean;
  action: "test";
  checks: RemoteCheck[];
}

interface RemoteCheck {
  name: string;    // 检查项名称（如 "SSH 连通"、"路径存在"、"compilot 已安装"、"版本兼容"）
  ok: boolean;
  detail: string;  // 成功时为详情，失败时为错误原因
}
```

### 示例

```jsonc
{
  "ok": true,
  "action": "test",
  "checks": [
    { "name": "SSH 连通", "ok": true, "detail": "" },
    { "name": "路径存在", "ok": true, "detail": "/home/dev/project" },
    { "name": "compilot 已安装", "ok": true, "detail": "v0.6.28" },
    { "name": "版本兼容", "ok": true, "detail": "远程 v0.6.28" }
  ]
}
```

---

## 配置文件格式

### `~/.compilot/projects/<hash>.json`

项目级配置由 `src/core/settingsIO.ts` 管理，按 workspace hash 存储到用户数据目录。文件通过 `type` 区分 Qt、SDK 和 sync 配置。

```jsonc
{
  "type": "qt",
  "mode": "debug",                    // "debug" | "release"
  "arch": "x86",                      // "x86" | "x64"
  "qtPath": "",                       // Qt 安装路径
  "vsDevShellPath": "",               // VsDevShell.ps1 路径
  "pinnedProject": "",              // 固定的 .pro 文件路径（相对）
  "qmakeTarget": "",                  // QMake TARGET 覆盖
  "rccProjectPath": "",               // RCC 项目路径
  "designerPath": "",                 // Qt Designer 路径
  "qtSourcePath": "",                 // Qt 源码路径
  "scanExcludeDirs": "",              // 扫描排除目录（逗号分隔）
  "cStandard": "c11",                 // C 标准
  "cppStandard": "c++17",            // C++ 标准
  "fileSyncPromptEnabled": true,      // .pri 文件同步提示
  "qmakeReminderEnabled": true        // QMake 提醒
}
```

同步配置也保存在同一目录：

```jsonc
{
  "type": "sync",
  "syncEnabled": true,
  "syncSelectedServer": "server-uuid",
  "syncRemotePath": "/home/dev/project",
  "syncIgnore": "node_modules, build"
}
```

### `~/.compilot/servers.json`

```jsonc
[
  {
    "id": "uuid-string",
    "name": "开发服务器",
    "host": "10.0.0.100",
    "port": 22,
    "username": "dev",
    "authMode": "key",              // "key" | "password"
    "privateKeyPath": "~/.ssh/id_rsa",
    "password": "",                 // authMode=password 时使用
    "remotePath": "/home/dev/project"
  }
]
```

### `.compilot/sync-state.json`

同步运行状态写入项目目录下的 `.compilot/sync-state.json`。远程部署、branchSync 和 buildOrder 仍属于设计稿，当前实现不读取独立 deploy 配置文件。

---

## 错误处理约定

1. **`--json` 模式始终输出合法 JSON**，即使内部异常
2. 异常时输出格式：`{ "ok": false, "diagnostics": [{ "level": "error", "message": "..." }] }`
3. `diagnostics` 中的 `hint` 字段提供修复建议（可选）
4. `nextActions` 提供可直接执行的命令建议
5. 退出码：`0` = 成功或 `--plan` 模式，`1` = 失败
