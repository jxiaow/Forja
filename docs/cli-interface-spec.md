# CLI 接口规范

本文档定�?compilot CLI 的输入参数、输出结构和数据类型，供 AI 工具和集成方参考�?

## 调用约定

```
compilot <subcommand> <action> [options]
```

- 子命令：`qt` | `sdk` | `remote`
- 所有命令加 `--json` 输出结构�?JSON，加 `` 精简输出
- 退出码：`0` 成功，`1` 失败
- 即使发生异常，`--json` 模式也保证输出合�?JSON

---

## 通用参数

| 参数 | 类型 | 默认�?| 说明 |
|------|------|--------|------|
| `--workspace <path>` | string | `process.cwd()` | 工作区根目录 |
| `--project <path>` | string | 自动检�?| 项目文件路径�?pro / .sln / Makefile�?|
| `--mode <mode>` | `debug` \| `release` | `debug` | 构建模式 |
| `--arch <arch>` | `x86` \| `x64` | `x86` | 目标架构 |
| `--plan` | boolean | `false` | 仅输出命令计划，不执�?|
| `--json` | boolean | `false` | JSON 格式输出 |
| `` | boolean | `false` | 精简 JSON（省略空字段�?|

## 远程模式参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--remote` | boolean | 启用远程编译部署 |
| `--fast` | boolean | 跳过 preCheck + branchSync + baselineCheck |
| `--from <stage>` | string | 从指定阶段开始（见阶段列表） |
| `--force` | boolean | 忽略基线不一致等非致命错�?|

远程阶段：`preCheck` �?`branchSync` �?`sync` �?`baselineCheck` �?`build` �?`transfer` �?`stop` �?`launch`

---

## Qt CLI 输出结构

### 类型定义

```typescript
interface QtCliResult {
  ok: boolean;                    // 是否成功
  action: CliAction;              // 执行的动�?
  mode: "dryRun" | "execute";    // 执行模式�?-plan 时为 dryRun�?
  workspace: string;              // 工作区绝对路�?
  project: string | null;         // 当前项目路径（相对于 workspace�?
  commands: string[];             // shell 命令列表
  shellCommand: string;           // 拼接后的完整命令（可直接执行�?
  candidates: string[];           // 候�?.pro 文件列表（相对路径）
  diagnostics: Diagnostic[];      // 诊断信息
  nextActions: string[];          // 建议的下一步操作（人类可读�?
  resolved: ResolvedConfig | null; // 当前生效的构建配�?
  errors: string[];               // 编译错误�?
  exitCode: number | null;        // 进程退出码（execute 模式�?
  durationMs: number;             // 执行耗时（ms�?
  logFile: string | null;         // 日志文件路径�?-detach 模式�?
  stdout: string;                 // 进程标准输出（execute 模式�?
  stderr: string;                 // 进程标准错误（execute 模式�?
  rccProjectPath: string | null;  // RCC 项目路径
}

type CliAction = "init" | "status" | "qmake" | "build" | "clean" | "run" | "stop" | "sync" | "logs" | "rcc";

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
  qtVersion?: string;             // Qt 版本号（�?"5.15.2"�?
  vsVersion?: string;             // VS 版本号（�?"2022"�?
}
```

### `` 模式字段规则

brief 模式省略�?默认值字段，只保留非空字段：

| 字段 | 保留条件 |
|------|----------|
| `ok` | 始终保留 |
| `action` | 始终保留 |
| `target` | 非空时保�?|
| `diagnostics` | 非空数组时保�?|
| `nextActions` | 非空数组时保�?|
| `exitCode` | �?null 时保�?|
| `errors` | 非空数组时保�?|
| `logFile` | 非空时保�?|
| `project` | 非空时保�?|
| `candidates` | 非空数组时保�?|
| `resolved` | �?null 时保留（只含非空子字段） |
| `rccProjectPath` | 非空时保�?|

brief + detach 成功时额外保�?`resolved: { mode, arch }`�?

---

## Qt CLI �?Action 输出特征

### `status`

```jsonc
{
  "ok": true,
  "action": "status",
  "resolved": { "mode": "debug", "arch": "x86", "qtPath": "C:/Qt/5.15.2/msvc2019", ... },
  "candidates": ["app/app.pro", "lib/lib.pro"],
  "rccProjectPath": "XYRcc/XYRcc.pro",
  "diagnostics": []
}
```

- 不执行任何命令，只返回环境状�?
- `candidates` 列出所有找到的 .pro 文件
- `resolved` 反映当前配置（settings + 环境检测）

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
  "action": "build",
  "mode": "execute",
  "exitCode": 0,
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
// brief 模式
{
  "ok": true,
  "action": "build",
  "exitCode": 0,
  "logFile": "C:/Users/.../compilot-logs/workspace/build-20260516.log",
  "resolved": { "mode": "debug", "arch": "x86" }
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

// 未找�?.pro 文件
{
  "ok": true,
  "action": "build",
  "diagnostics": [{ "level": "warning", "message": "未找�?.pro 文件" }],
  "nextActions": ["在工作区中创�?.pro 文件，或使用 --project 指定路径"]
}

// Qt 环境未配�?
{
  "ok": true,
  "action": "build",
  "diagnostics": [{ "level": "warning", "message": "Qt 路径未配�? }],
  "nextActions": ["compilot qt init --json", "compilot qt build --qt-path C:/Qt/5.15.2/msvc2019 --json"]
}
```

---

## SDK CLI 输出结构

### 类型定义

```typescript
interface SdkCliResult {
  ok: boolean;
  action: "build" | "rebuild" | "clean" | "status";
  workspace: string;
  target: string | null;          // 项目名（文件名去扩展名）
  project: string | null;         // 项目文件路径
  candidates?: string[];          // 候选项目列表（status 时）
  commands: string[];             // shell 命令列表
  shellCommand: string | null;    // 拼接命令�?-plan 时返回，execute 时为 null�?
  exitCode: number | null;        // 执行退出码
  errors: string[];               // 错误信息
  diagnostics: Diagnostic[];      // 诊断信息
  mode?: string;                  // 构建模式（status 时）
  arch?: string;                  // 架构（status 时）
}
```

### `status`

```jsonc
{
  "ok": true,
  "action": "status",
  "workspace": "C:/projects/myapp",
  "target": "MyApp",
  "project": "C:/projects/myapp/MyApp.sln",
  "candidates": ["MyApp.sln"],
  "mode": "debug",
  "arch": "x86"
}
```

### `build --plan`

```jsonc
{
  "ok": true,
  "action": "build",
  "target": "MyApp",
  "commands": ["msbuild MyApp.sln /p:Configuration=Debug /p:Platform=x86"],
  "shellCommand": "msbuild MyApp.sln /p:Configuration=Debug /p:Platform=x86",
  "exitCode": null,
  "diagnostics": [],
  "errors": []
}
```

### 错误

```jsonc
{
  "ok": false,
  "action": "build",
  "diagnostics": [{ "level": "error", "message": "未找�?.sln �?Makefile 项目文件" }]
}
```

---

## Remote 模式输出结构

`--remote` 模式返回 `DeployResult`�?

```typescript
interface DeployResult {
  ok: boolean;
  stages: StageResult[];
  buildResult?: BuildResult;      // 编译阶段的详细结�?
  error?: string;                 // 失败原因
}

interface StageResult {
  stage: DeployStage;             // 阶段�?
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
    { "stage": "preCheck", "ok": true, "message": "所有仓�?HEAD �?push", "durationMs": 120 },
    { "stage": "branchSync", "ok": true, "message": "分支同步完成", "durationMs": 3400 },
    { "stage": "sync", "ok": true, "message": "同步 12 个文�?, "durationMs": 5600 },
    { "stage": "baselineCheck", "ok": true, "message": "基线一�?, "durationMs": 800 },
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

## 配置文件格式

### `.compilot/settings.json`

```jsonc
{
  "mode": "debug",                    // "debug" | "release"
  "arch": "x86",                      // "x86" | "x64"
  "qtPath": "",                       // Qt 安装路径
  "vsDevShellPath": "",               // VsDevShell.ps1 路径
  "selectedProject": "",              // 选中�?.pro 文件路径（相对）
  "qmakeTarget": "",                  // QMake TARGET 覆盖
  "rccProjectPath": "",               // RCC 项目路径
  "designerPath": "",                 // Qt Designer 路径
  "qtSourcePath": "",                 // Qt 源码路径
  "scanExcludeDirs": "",              // 扫描排除目录（逗号分隔�?
  "cStandard": "c11",                 // C 标准
  "cppStandard": "c++17",            // C++ 标准
  "fileSyncPromptEnabled": true,      // .pri 文件同步提示
  "qmakeReminderEnabled": true        // QMake 提醒
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
    "password": "",                 // authMode=password 时使�?
    "remotePath": "/home/dev/project"
  }
]
```

### `.compilot/sync-config.json`

```jsonc
{
  "selectedServer": "server-uuid",
  "syncEnabled": true,
  "syncIgnore": ["build", "*.o", "node_modules"],
  "branchSync": {
    "enabled": true,
    "pinned": {
      "repo-name": "feature/branch"
    }
  },
  "buildOrder": [
    { "workspace": ".", "type": "qt" },
    { "workspace": "./core-lib", "type": "sdk" }
  ]
}
```

### `.compilot/deploy.json`

```jsonc
{
  "version": 1,
  "server": "deploy-server-uuid",
  "launch": {
    "command": "./bin/MyApp",
    "mode": "bg"                    // "bg" (后台) | "fg" (前台)
  }
}
```

---

## 错误处理约定

1. **`--json` 模式始终输出合法 JSON**，即使内部异�?
2. 异常时输出格式：`{ "ok": false, "diagnostics": [{ "level": "error", "message": "..." }] }`
3. `diagnostics` 中的 `hint` 字段提供修复建议（可选）
4. `nextActions` 提供可直接执行的命令建议
5. 退出码：`0` = 成功�?`--plan` 模式，`1` = 失败
