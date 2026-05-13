# Qt Pilot CLI

命令行工具，用于 qmake 项目的构建、运行和环境管理。

专为 AI 编程工具设计，也可独立使用。

## 安装

```bash
npm install -g qt-pilot-cli
```

## CLI 使用

```bash
# 查看帮助
qt-pilot --help

# 初始化（检测环境、保存本地配置）
qt-pilot init --execute

# 查看状态（结构化输出，适合脚本/AI 解析）
qt-pilot status --json

# 构建（dry-run，查看命令计划）
qt-pilot build --json

# 构建（执行，终端实时输出）
qt-pilot build --execute

# 运行（先编译再启动程序）
qt-pilot run --execute

# 清理
qt-pilot clean --execute

# 同步变更文件到远程
qt-pilot sync --execute

# 同步到指定服务器
qt-pilot sync --execute --server "开发服务器"
```

### 选项说明

| 选项 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--project <path>` | 指定 `.pro` 文件路径（支持相对路径，相对于 workspace） |
| `--mode debug\|release` | 构建模式，默认 debug |
| `--arch x86\|x64` | 目标架构，默认 x86 |
| `--qt-path <path>` | Qt 安装路径（覆盖自动检测） |
| `--vs-dev-shell <path>` | Launch-VsDevShell.ps1 路径（覆盖自动检测） |
| `--target <name>` | QMake TARGET 覆盖（生成的 exe 名） |
| `--server <name>` | 同步时指定服务器名称 |
| `--execute` | 实际执行命令（不加则为 dry-run，仅显示命令计划） |
| `--json` | 输出结构化 JSON |

### 常用组合示例

```bash
# 指定项目编译（workspace 下有多个 .pro 时）
qt-pilot build --execute --project "qt_linux_pc_client/qt_linux_pc_client.pro"

# 指定模式和架构
qt-pilot build --execute --mode release --arch x86

# 指定 workspace（在其他目录下操作）
qt-pilot build --execute --workspace "c:\Code\workspace\dev\qt_client"

# 组合使用
qt-pilot run --execute --project "qt_linux_pc_client/qt_linux_pc_client.pro" --mode release
```

### `--json` 说明

- `--json` 输出结构化 JSON，适合脚本或 AI 工具解析返回值
- 执行类命令（build、run、qmake、clean）**不建议加 `--json`**，因为会等进程结束才一次性输出，看不到实时编译过程
- 查询类命令（status、projects、detect）建议加 `--json` 方便解析

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
└── servers.json      # 服务器配置（含远程根路径、密码明文）
```

## 配置优先级

```
CLI 参数 > .qtpilot/settings.json > .qtpilot/cache.json > 环境变量 > 自动检测 > 默认值
```

## 远程同步

CLI 支持将 git 变更文件同步到远程服务器。服务器配置存储在 `~/.qt-pilot/servers.json`，项目同步开关存储在 `.qtpilot/sync-config.json`。

### 使用

```bash
# 同步变更文件（使用配置中的默认服务器）
qt-pilot sync --execute --json

# 指定服务器
qt-pilot sync --execute --server "测试服务器" --json
```

### 同步逻辑

1. 通过 `git diff` 获取变更文件
2. 过滤忽略列表
3. 对比 `sync-state.json` 跳过已同步且未再修改的文件
4. 通过 SCP 上传需要同步的文件
5. 成功后更新同步状态记录

## 支持平台

- Windows (MSVC + jom)
- Linux (GCC + make)

## License

MIT
