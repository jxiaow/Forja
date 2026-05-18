# Compilot �?CLI

命令行工具，用于 C++ 项目的构建、运行和环境管理�?

支持 Qt (qmake) 项目�?SDK (.sln/Makefile) 项目。专�?AI 编程工具设计，也可独立使用�?

## 安装

```bash
# CLI
npm install -g compilot-cli-x.x.x.tgz

# AI Skill
cp -r skills/compilot/ <ai-tool-skills-dir>/compilot/
```

Skill 文件位于 CLI 包的 `skills/compilot/` 目录下，安装�?AI 助手可直接调�?compilot 命令�?

## 快速开�?

```bash
# 1. 查看环境状�?
compilot qt status --json

# 2. 初始化（检测环境、保存配置，只需一次）
compilot qt init --json

# 3. 之后直接�?
compilot qt build --json
compilot qt run --detach --json

# SDK 项目
compilot sdk build --json
compilot sdk status --json
```

`init` 会将检测到�?Qt 路径、VS 环境、项目选择等保存到 `.compilot/settings.json`，后续命令自动读取，不需要每次指�?`--project`、`--mode`、`--arch`�?

## 通用选项

所有命令都支持以下选项�?

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--plan` | 仅显示命令计划，不执�?|
| `--json` | 输出结构�?JSON |
| `` | 精简 JSON（仅 ok、diagnostics、logFile 等关键字段） |
| `--detach` | 后台执行，日志落文件，CLI 立即返回 |

提示�?

- 命令默认执行，加 `--plan` 查看计划而不执行
- `--json` 组合适合 AI 工具调用，输出精简且结构化
- 不加 `--json` 时输出人类可读文本，适合终端直接使用
- `--detach` 适合耗时较长的命令（build、run），CLI 立即返回，通过 `logs` 查看结果
- `run --detach`：前台编译，编译成功�?detach 启动程序；编译失败直接返回错�?
- `build/clean --detach`：整个命令序列后台执行，输出落日志文�?
- `--project` 支持相对路径（相对于 workspace），workspace 下只有一�?`.pro` 时可省略

## JSON 输出结构

所�?`--json` 输出共享以下关键字段�?

```jsonc
{
  "ok": true,              // 是否成功
  "action": "build",       // 当前动作
  "target": "MyApp",      // 项目名（Qt: qmakeTarget, SDK: 项目文件名）
  "project": "app.pro",   // 当前项目（相对路径）
  "commands": [...],       // 将要/已执行的 shell 命令列表
  "candidates": [...],     // 候�?.pro 文件列表（status 时）
  "diagnostics": [         // 诊断信息（warning/error/info�?
    { "level": "warning", "message": "..." }
  ],
  "nextActions": [...],    // 建议的下一步操�?
  "resolved": {            // 当前生效的构建配�?
    "mode": "debug",
    "arch": "x86",
    "qtPath": "...",
    "vsDevShell": "..."
  },
  "rccProjectPath": "...", // RCC 项目路径（status 时）
  "errors": [...],         // 编译错误行（build/run 失败时）
  "logFile": "...",        // 日志文件路径（detach 模式�?
  "exitCode": 0            // 进程退出码
}
```

`` 模式只保�?`ok`、`action`、`project`、`candidates`、`diagnostics`、`nextActions`、`resolved`、`rccProjectPath`、`errors`、`logFile`、`exitCode` 中的非空字段�?

## Qt 命令

### `compilot qt status`

查看当前项目状态、环境检测结果、候�?`.pro` 文件列表�?

```bash
compilot qt status --json
```

| 选项 | 说明 |
|------|------|
| `--save-local` | 将检测结果写�?.compilot/cache.json |

### `compilot qt init`

检�?Qt �?Visual Studio 环境，保存到 `.compilot/`�?

```bash
compilot qt init --json
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件（支持相对路径） |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--qt-path <path>` | 手动指定 Qt 路径 |
| `--vs-dev-shell <path>` | 手动指定 VsDevShell 路径 |

### `compilot qt qmake`

生成 Makefile�?

```bash
compilot qt qmake
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |

### `compilot qt build`

编译项目�?

```bash
compilot qt build
compilot qt build --project "app/app.pro" --mode release
compilot qt build --plan --json    # 仅查看命令计�?
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |

### `compilot qt run`

先杀掉已运行的程序，再编译（�?RCC 增量检查），编译成功后启动程序�?

```bash
compilot qt run
compilot qt run --detach
compilot qt run --project "app/app.pro" --mode release
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |

`--detach` 时：前台编译，编译成功后 detach 启动程序。编译失败直接返回错误�?

### `compilot qt logs`

查看后台执行的日志（`--detach` 模式的输出）�?

```bash
compilot qt logs --json
```

### `compilot qt stop`

停止运行中的程序�?

```bash
compilot qt stop
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件（用于推断进程名�?|

### `compilot qt clean`

清理构建产物�?

```bash
compilot qt clean
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |

### `compilot qt sync`

�?git 变更文件同步到远程服务器�?

```bash
compilot qt sync
compilot qt sync --server "开发服务器"
```

| 选项 | 说明 |
|------|------|
| `--server <name>` | 指定服务器名称（对应 servers.json 中的 name�?|

### `compilot qt rcc`

编译 `.qrc` 资源文件�?`.rcc` 二进制，并复制到可执行文件输出目录�?

```bash
compilot qt rcc
```

RCC 项目路径解析顺序�?
1. `.compilot/settings.json` 中的 `rccProjectPath` 配置
2. 自动扫描 workspace 下的 `XYRcc/` 目录
3. 自动扫描 workspace 父目录下�?`XYRcc/` 目录

`run` 命令会自动检�?RCC 资源是否有变更，有变更时自动插入 rcc 编译步骤�?

## SDK 命令

SDK 命令用于 `.sln` �?`Makefile` 项目。支�?`--workspace`、`--plan`、`--json`、`` 通用选项�?

### `compilot sdk status`

查看 SDK 项目状态和候选项目列表�?

```bash
compilot sdk status --json
```

### `compilot sdk build`

编译 SDK 项目�?

```bash
compilot sdk build
compilot sdk build --json
```

### `compilot sdk rebuild`

重新编译（clean + build）�?

```bash
compilot sdk rebuild
```

### `compilot sdk clean`

清理 SDK 构建产物�?

```bash
compilot sdk clean
```

## Remote 命令

远程编译部署相关操作�?

### `compilot remote test`

测试远程连接（SSH 连通�?+ remotePath 存在 + compilot 版本）�?

```bash
compilot remote test --json
```

### `compilot remote setup`

交互式配置远程编译环境（选择服务器、测试连接、创建远程目录）�?

```bash
compilot remote setup
```

## 远程模式�?-remote�?

Qt �?SDK �?build/run 命令支持 `--remote` 标志，触发完整远程部署流程：

```bash
# Qt 远程编译部署
compilot qt build --remote --json

# SDK 远程编译部署
compilot sdk build --remote --json

# 快速模式（跳过 branchSync �?baselineCheck�?
compilot qt build --remote --fast --json

# 从指定阶段开始（跳过前面的阶段）
compilot qt build --remote --from build --json

# 强制执行（忽略基线不一致警告）
compilot qt build --remote --force --json
```

| 选项 | 说明 |
|------|------|
| `--remote` | 启用远程模式 |
| `--fast` | 快速模式，跳过 preCheck、branchSync �?baselineCheck |
| `--from <stage>` | 从指定阶段开始（preCheck/branchSync/sync/baselineCheck/build/transfer/stop/launch�?|
| `--force` | 忽略基线不一致等非致命错�?|

远程模式执行流程：preCheck �?branchSync �?sync �?baselineCheck �?build �?transfer �?stop �?launch

### 远程配置

远程模式需要以下配置：

```
.compilot/
├── sync-config.json       # selectedServer + branchSync + buildOrder
└── deploy.json            # 部署服务�?+ 启动命令（可选）
```

- `sync-config.json` 中的 `selectedServer` 指定编译�?
- `deploy.json` 配置部署机和启动命令（编译机和部署机相同时可省略�?
- 服务器信息存储在 `~/.compilot/servers.json`

## 本地状�?

配置保存在项目目录下�?

```
.compilot/
├── settings.json     # 唯一配置源（mode、arch、路径、项目选择等）
├── cache.json        # 环境检测缓存（自动生成�?
├── sync-config.json  # 同步开�?+ 忽略列表 + branchSync + buildOrder
└── deploy.json       # 远程部署配置（部署服务器、启动命令）
```

执行日志保存在系统临时目录：`%TEMP%/compilot-logs/<workspace>/`（Linux: `/tmp/compilot-logs/<workspace>/`�?

全局服务器列表：

```
~/.compilot/
└── servers.json      # 服务器配置（含远程根路径�?
```

## 配置优先�?

```
CLI 参数 > .compilot/settings.json > .compilot/cache.json > 环境变量 > 自动检�?> 默认�?
```

## 支持平台

- Windows (MSVC + jom)
- Linux (GCC + make)

## License

MIT
