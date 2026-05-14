# Compilot — CLI

命令行工具，用于 C++ 项目的构建、运行和环境管理。

支持 Qt (qmake) 项目和 SDK (.sln/Makefile) 项目。专为 AI 编程工具设计，也可独立使用。

## 安装

```bash
# 从本地打包文件安装
npm install -g compilot-cli-x.x.x.tgz
```

## 快速开始

```bash
# 1. 在 Qt 项目目录下初始化（检测环境、保存配置，只需一次）
cd your-qt-project
compilot qt init --execute

# 2. 之后直接用，无需额外参数
compilot qt build --execute
compilot qt run --execute

# SDK 项目
compilot sdk build --execute
compilot sdk status --json
```

`init` 会将检测到的 Qt 路径、VS 环境、项目选择等保存到 `.compilot/settings.json`，后续命令自动读取，不需要每次指定 `--project`、`--mode`、`--arch`。

## Qt 命令

### `compilot qt init`

检测 Qt 和 Visual Studio 环境，保存到 `.compilot/`。

```bash
compilot qt init --execute
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--project <path>` | 指定 `.pro` 文件（支持相对路径） |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--qt-path <path>` | 手动指定 Qt 路径 |
| `--vs-dev-shell <path>` | 手动指定 VsDevShell 路径 |
| `--execute` | 执行初始化（不加则仅预览） |
| `--json` | 输出 JSON |

### `compilot qt status`

查看当前项目状态、环境检测结果、候选 `.pro` 文件列表。

```bash
compilot qt status --json
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--save-local` | 将检测结果写入 .compilot/cache.json |
| `--json` | 输出 JSON（推荐） |

### `compilot qt qmake`

生成 Makefile。

```bash
compilot qt qmake --execute
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |
| `--execute` | 执行（不加则仅显示命令计划） |
| `--json` | 输出 JSON |

### `compilot qt build`

编译项目。

```bash
compilot qt build --execute
compilot qt build --execute --project "app/app.pro"
compilot qt build --execute --mode release --arch x86
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |
| `--execute` | 执行编译（不加则仅显示命令计划） |
| `--json` | 输出 JSON（不建议，无实时输出） |

### `compilot qt run`

先杀掉已运行的程序，再编译，编译成功后启动程序。

```bash
compilot qt run --execute
compilot qt run --execute --detach
compilot qt run --execute --project "app/app.pro" --mode release
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |
| `--execute` | 执行（不加则仅显示命令计划） |
| `--detach` | 后台启动，日志落文件，CLI 立即返回 |
| `--json` | 输出 JSON |
| `--brief` | 精简 JSON（仅 ok、diagnostics、logFile） |

### `compilot qt logs`

查看后台启动的程序运行日志（`--detach` 模式启动后的输出）。

```bash
compilot qt logs
compilot qt logs --json
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--json` | 输出 JSON（含 PID、运行状态、日志尾部） |

### `compilot qt clean`

清理构建产物。

```bash
compilot qt clean --execute
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--execute` | 执行清理 |
| `--json` | 输出 JSON |

### `compilot qt stop`

停止运行中的程序。

```bash
compilot qt stop --execute
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件（用于推断进程名） |
| `--execute` | 执行停止 |
| `--json` | 输出 JSON |

### `compilot qt sync`

将 git 变更文件同步到远程服务器。

```bash
compilot qt sync --execute
compilot qt sync --execute --server "开发服务器"
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--server <name>` | 指定服务器名称（对应 servers.json 中的 name） |
| `--execute` | 执行同步 |
| `--json` | 输出 JSON |

### `compilot qt rcc`

编译 `.qrc` 资源文件为 `.rcc` 二进制。

```bash
compilot qt rcc --execute
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--execute` | 执行编译 |
| `--json` | 输出 JSON |

## SDK 命令

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

## 通用说明

- `--execute`：不加时为 dry-run，仅显示将要执行的命令，不实际执行
- `--json`：输出结构化 JSON。执行类命令（build、run）不建议加，因为会等进程结束才一次性输出，看不到实时编译过程
- `--project`：支持相对路径（相对于 workspace）。workspace 下只有一个 `.pro` 时可省略，自动选中
- 所有路径选项都支持绝对路径和相对路径

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
