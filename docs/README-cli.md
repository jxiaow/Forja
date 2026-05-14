# Compilot — CLI

命令行工具，用于 C++ 项目的构建、运行和环境管理。

支持 Qt (qmake) 项目和 SDK (.sln/Makefile) 项目。专为 AI 编程工具设计，也可独立使用。

## 安装

```bash
# CLI
npm install -g compilot-cli-x.x.x.tgz

# AI Skill（Kiro 全局）
cp -r skills/compilot/ ~/.kiro/skills/compilot/

# AI Skill（仅当前项目）
cp -r skills/compilot/ <project>/.kiro/skills/compilot/
```

Skill 文件位于 CLI 包的 `skills/compilot/` 目录下，安装后 AI 助手可直接调用 compilot 命令。

## 快速开始

```bash
# 1. 查看环境状态
compilot qt status --json --brief

# 2. 初始化（检测环境、保存配置，只需一次）
compilot qt init --execute --json --brief

# 3. 之后直接用
compilot qt build --execute
compilot qt run --execute

# SDK 项目
compilot sdk build --execute
compilot sdk status --json
```

`init` 会将检测到的 Qt 路径、VS 环境、项目选择等保存到 `.compilot/settings.json`，后续命令自动读取，不需要每次指定 `--project`、`--mode`、`--arch`。

## 通用选项

所有命令都支持以下选项：

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--execute` | 执行命令（不加则为 dry-run，仅显示命令计划） |
| `--json` | 输出结构化 JSON |
| `--brief` | 精简 JSON（仅 ok、diagnostics、logFile 等关键字段） |

提示：

- `--json --brief` 组合适合 AI 工具调用，输出精简且结构化
- 不加 `--json` 时输出人类可读文本，适合终端直接使用
- 执行类命令（build、run）加 `--json` 会等进程结束才一次性输出，看不到实时编译过程；如果只需要知道成功/失败，用 `--json --brief`
- `--project` 支持相对路径（相对于 workspace），workspace 下只有一个 `.pro` 时可省略

## JSON 输出结构

所有 `--json` 输出共享以下关键字段：

```jsonc
{
  "ok": true,              // 是否成功
  "action": "build",       // 当前动作
  "project": "app.pro",   // 当前项目（相对路径）
  "commands": [...],       // 将要/已执行的 shell 命令列表
  "candidates": [...],     // 候选 .pro 文件列表（status 时）
  "diagnostics": [         // 诊断信息（warning/error/info）
    { "level": "warning", "message": "..." }
  ],
  "nextActions": [...],    // 建议的下一步操作
  "resolved": {            // 当前生效的构建配置
    "mode": "debug",
    "arch": "x86",
    "qtPath": "...",
    "vsDevShell": "..."
  },
  "rccProjectPath": "...", // RCC 项目路径（status 时）
  "errors": [...],         // 编译错误行（build/run 失败时）
  "logFile": "...",        // 日志文件路径（detach 模式）
  "exitCode": 0            // 进程退出码（execute 模式）
}
```

`--brief` 模式只保留 `ok`、`action`、`project`、`candidates`、`diagnostics`、`nextActions`、`resolved`、`rccProjectPath`、`errors`、`logFile`、`exitCode` 中的非空字段。

## Qt 命令

### `compilot qt status`

查看当前项目状态、环境检测结果、候选 `.pro` 文件列表。

```bash
compilot qt status --json --brief
```

| 选项 | 说明 |
|------|------|
| `--save-local` | 将检测结果写入 .compilot/cache.json |

### `compilot qt init`

检测 Qt 和 Visual Studio 环境，保存到 `.compilot/`。

```bash
compilot qt init --execute --json --brief
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件（支持相对路径） |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--qt-path <path>` | 手动指定 Qt 路径 |
| `--vs-dev-shell <path>` | 手动指定 VsDevShell 路径 |

### `compilot qt qmake`

生成 Makefile。

```bash
compilot qt qmake --execute
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |

### `compilot qt build`

编译项目。

```bash
compilot qt build --execute
compilot qt build --execute --project "app/app.pro" --mode release
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |

### `compilot qt run`

先杀掉已运行的程序，再编译（含 RCC 增量检查），编译成功后启动程序。

```bash
compilot qt run --execute
compilot qt run --execute --detach
compilot qt run --execute --project "app/app.pro" --mode release
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |
| `--detach` | 后台启动，日志落文件，CLI 立即返回 |

### `compilot qt logs`

查看后台启动的程序运行日志（`--detach` 模式启动后的输出）。

```bash
compilot qt logs --json
```

### `compilot qt stop`

停止运行中的程序。

```bash
compilot qt stop --execute
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件（用于推断进程名） |

### `compilot qt clean`

清理构建产物。

```bash
compilot qt clean --execute
```

| 选项 | 说明 |
|------|------|
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |

### `compilot qt sync`

将 git 变更文件同步到远程服务器。

```bash
compilot qt sync --execute
compilot qt sync --execute --server "开发服务器"
```

| 选项 | 说明 |
|------|------|
| `--server <name>` | 指定服务器名称（对应 servers.json 中的 name） |

### `compilot qt rcc`

编译 `.qrc` 资源文件为 `.rcc` 二进制，并复制到可执行文件输出目录。

```bash
compilot qt rcc --execute
```

RCC 项目路径解析顺序：
1. `.compilot/settings.json` 中的 `rccProjectPath` 配置
2. 自动扫描 workspace 下的 `XYRcc/` 目录
3. 自动扫描 workspace 父目录下的 `XYRcc/` 目录

`run` 命令会自动检查 RCC 资源是否有变更，有变更时自动插入 rcc 编译步骤。

## SDK 命令

SDK 命令用于 `.sln` 或 `Makefile` 项目。支持 `--workspace`、`--execute`、`--json` 通用选项。

### `compilot sdk status`

查看 SDK 项目状态和候选项目列表。

```bash
compilot sdk status --json
```

### `compilot sdk build`

编译 SDK 项目。

```bash
compilot sdk build --execute
compilot sdk build --execute --json
```

### `compilot sdk rebuild`

重新编译（clean + build）。

```bash
compilot sdk rebuild --execute
```

### `compilot sdk clean`

清理 SDK 构建产物。

```bash
compilot sdk clean --execute
```

## 本地状态

配置保存在项目目录下：

```
.compilot/
├── settings.json     # 唯一配置源（mode、arch、路径、项目选择等）
├── cache.json        # 环境检测缓存（自动生成）
└── sync-config.json  # 同步开关 + 忽略列表（项目级）
```

执行日志保存在系统临时目录：`%TEMP%/compilot-logs/<workspace>/`（Linux: `/tmp/compilot-logs/<workspace>/`）

全局服务器列表：

```
~/.compilot/
└── servers.json      # 服务器配置（含远程根路径）
```

## 配置优先级

```
CLI 参数 > .compilot/settings.json > .compilot/cache.json > 环境变量 > 自动检测 > 默认值
```

## 支持平台

- Windows (MSVC + jom)
- Linux (GCC + make)

## License

MIT
