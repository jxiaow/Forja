# Qt Pilot CLI

命令行工具，用于 qmake 项目的构建、运行和环境管理。

专为 AI 编程工具设计，也可独立使用。

## 安装

```bash
npm install -g qt-pilot-cli
```

## 快速开始

```bash
# 1. 在 Qt 项目目录下初始化（检测环境、保存配置，只需一次）
cd your-qt-project
qt-pilot init --execute

# 2. 之后直接用，无需额外参数
qt-pilot build --execute
qt-pilot run --execute
```

`init` 会将检测到的 Qt 路径、VS 环境、项目选择等保存到 `.qtpilot/settings.json`，后续命令自动读取，不需要每次指定 `--project`、`--mode`、`--arch`。

## 命令

### `qt-pilot init`

检测 Qt 和 Visual Studio 环境，保存到 `.qtpilot/`。

```bash
qt-pilot init --execute
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

### `qt-pilot status`

查看当前项目状态、环境检测结果、候选 `.pro` 文件列表。

```bash
qt-pilot status --json
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--json` | 输出 JSON（推荐） |

### `qt-pilot qmake`

生成 Makefile。

```bash
qt-pilot qmake --execute
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

### `qt-pilot build`

编译项目。

```bash
qt-pilot build --execute
qt-pilot build --execute --project "qt_linux_pc_client/qt_linux_pc_client.pro"
qt-pilot build --execute --mode release --arch x86
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

### `qt-pilot run`

先杀掉已运行的程序，再编译，编译成功后启动程序。

- 在终端中直接运行时：实时输出编译过程和程序日志，程序退出后命令才结束
- 被脚本/AI 工具调用时（非 TTY）：自动后台启动程序，日志落文件，CLI 立即返回
- 显式 `--detach`：无论什么环境都后台启动

```bash
qt-pilot run --execute
qt-pilot run --execute --detach
qt-pilot run --execute --project "qt_linux_pc_client/qt_linux_pc_client.pro" --mode release
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |
| `--execute` | 执行（不加则仅显示命令计划） |
| `--detach` | 强制后台启动，日志落文件，CLI 立即返回 |
| `--json` | 输出 JSON |
| `--brief` | 精简 JSON（仅 ok、diagnostics、logFile） |

### `qt-pilot logs`

查看后台启动的程序运行日志（`--detach` 或非 TTY 模式启动后的输出）。

```bash
qt-pilot logs
qt-pilot logs --json
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--json` | 输出 JSON（含 PID、运行状态、日志尾部） |

### `qt-pilot clean`

清理构建产物。

```bash
qt-pilot clean --execute
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件 |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--execute` | 执行清理 |
| `--json` | 输出 JSON |

### `qt-pilot stop`

停止运行中的程序。

```bash
qt-pilot stop --execute
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--project <path>` | 指定 `.pro` 文件（用于推断进程名） |
| `--execute` | 执行停止 |
| `--json` | 输出 JSON |

### `qt-pilot sync`

将 git 变更文件同步到远程服务器。

```bash
qt-pilot sync --execute
qt-pilot sync --execute --server "开发服务器"
```

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径 |
| `--server <name>` | 指定服务器名称（对应 servers.json 中的 name） |
| `--execute` | 执行同步 |
| `--json` | 输出 JSON |

## 通用说明

- `--execute`：不加时为 dry-run，仅显示将要执行的命令，不实际执行
- `--json`：输出结构化 JSON。执行类命令（build、run、qmake、clean）不建议加，因为会等进程结束才一次性输出，看不到实时编译过程
- `--project`：支持相对路径（相对于 workspace）。workspace 下只有一个 `.pro` 时可省略，自动选中
- 所有路径选项都支持绝对路径和相对路径

## AI 工具集成（Skill）

Qt Pilot 提供 Skill 文件，让 AI 编程工具知道如何使用 CLI 进行构建操作。

安装后将 `skills/qt-pilot-cli/` 目录复制到对应 AI 工具的 skills 目录：

- **Kiro**: `~/.kiro/skills/qt-pilot-cli/`
- **Codex**: `~/.codex/skills/qt-pilot-cli/`
- **Claude Code**: `~/.claude/skills/qt-pilot-cli/` 或项目级 `.claude/skills/qt-pilot-cli/`
- **OpenCode**: `~/.opencode/skills/qt-pilot-cli/` 或项目级 `.opencode/skills/qt-pilot-cli/`

Skill 文件位于 npm 包安装目录下：

```bash
# 查看安装位置
npm root -g
# 然后复制 qt-pilot-cli/skills/qt-pilot-cli/ 到目标目录
```

## 本地状态

配置保存在项目目录下：

```
.qtpilot/
├── settings.json     # 唯一配置源（mode、arch、路径、项目选择等）
├── cache.json        # 环境检测缓存（自动生成）
└── sync-config.json  # 同步开关 + 忽略列表（项目级）
```

执行日志保存在系统临时目录：`%TEMP%/qt-pilot-logs/<workspace>/`（Linux: `/tmp/qt-pilot-logs/<workspace>/`）

全局服务器列表：

```
~/.qt-pilot/
└── servers.json      # 服务器配置（含远程根路径）
```

## 配置优先级

```
CLI 参数 > .qtpilot/settings.json > .qtpilot/cache.json > 环境变量 > 自动检测 > 默认值
```

## 远程同步

CLI 支持将 git 变更文件同步到远程服务器。

### 同步逻辑

1. 通过 `git diff` 获取变更文件
2. 过滤忽略列表
3. 对比同步状态跳过已同步且未再修改的文件
4. 通过 SCP 上传需要同步的文件
5. 成功后更新同步状态记录

### 前提条件

- OpenSSH 可用（Windows 10+ 自带）
- 密码认证需要 `sshpass`

## 支持平台

- Windows (MSVC + jom)
- Linux (GCC + make)

## License

MIT
