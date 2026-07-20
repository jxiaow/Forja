# Forja CLI

命令行工具用于 C++ 项目的构建、运行和环境管理。支持 Qt (qmake) 和 C++ (.sln/Makefile) 两种项目类型，支持本地和远程执行。

## 安装

### Stable（正式版本）

```bash
# VSCode 扩展
code --install-extension dist/forja-<version>/vs/forja-<version>.vsix

# CLI
npm install -g dist/forja-<version>/cli/forja-cli-<version>.tgz
```

### Dev（开发版本）

```bash
# 先打包
npm run package:all:dev

# 安装
code --install-extension dist/forja-<version>/vs/forja-<version>-dev.vsix
npm install -g dist/forja-<version>/cli/forja-cli-<version>-dev.tgz
```

### 从源码安装（开发调试）

```bash
npm install
npm run compile
npm link          # 全局注册 forja 命令
```

## 快速上手

**三步开始：**

```bash
# 1. 查看状态（第一条命令永远是 status）
forja status

# 2. 按提示初始化或选择项目
forja init                    # 首次：自动检测环境
forja list targets            # 查看可用项目
forja use target --project app.pro   # 选择项目

# 3. 构建运行
forja build
forja run
```

**每条命令都支持 `--json` 输出结构化结果，适合脚本和 AI 调用：**

```bash
forja status --json
forja build --json
```

## 常见场景

### 场景 1：本地 Qt 项目

```bash
forja init                                    # 检测 Qt/VS/jom
forja use target --project app/app.pro        # 选择 .pro 文件
forja use target --mode release --arch x64    # 设置构建配置
forja build                                   # 编译
forja run                                     # 运行
```

### 场景 2：本地 C++ 项目（Windows .sln）

```bash
forja init                                    # 检测 VS/MSBuild
forja use target --project MyProject.sln      # 选择 .sln 文件
forja build
forja run --detach                            # 后台运行
```

### 场景 3：远程构建

```bash
# 先配置服务器
forja server add --name dev --host 192.168.1.10 --username dev

# 配置远程执行
forja remote set --server dev --remote-path /home/dev/workspace

# 远程初始化（通过 SSH 在远端执行 init）
forja use target --run-at remote

# 远程构建
forja build

# 远程诊断
forja doctor --remote
```

### 场景 4：文件同步

```bash
forja use sync --server dev --remote-path /home/dev/workspace --enable
forja sync --dry-run                      # 预览待同步文件
forja sync                                # 同步变更文件
```

### 场景 5：多项目切换

```bash
forja list targets                            # 列出所有项目
forja use target --project moduleA/app.pro    # 切换到 moduleA
forja build
forja use target --project moduleB/app.pro    # 切换到 moduleB
forja build
```

## VSCode 扩展与 CLI 的关系

VSCode 扩展和 CLI 共享同一套新配置存储（`~/.forja/workspaces/<hash>.json`）。旧 `~/.forja/projects/` 不读取、不迁移、不兼容。

| 操作 | VSCode | CLI |
|------|--------|-----|
| 查看状态 | 状态栏 + 配置面板 | `forja status` |
| 选项目 | 配置面板 → 项目 | `forja use target --project` |
| 切 mode/arch | 状态栏下拉 / 配置面板 | `forja use target --mode` |
| 构建 | `forja.build` 命令 | `forja build` |
| 运行 | `forja.run` 命令 | `forja run` |
| 远程诊断 | — | `forja doctor --remote` |

## 命令速查

| 命令 | 用途 | 常用示例 |
|------|------|----------|
| `status` | 查看就绪状态 | `forja status` |
| `init` | 首次初始化 | `forja init` |
| `list` | 列出候选项 | `forja list targets`、`forja list env` |
| `use` | 写入配置 | `forja use target --project`、`forja use target --run-at remote` |
| `server` | 管理服务器 | `forja server add`、`forja server remove` |
| `build` | 编译 | `forja build`、`forja build fresh`、`forja build qmake` |
| `run` | 运行 | `forja run`、`forja run --detach` |
| `stop` | 停止进程 | `forja stop` |
| `clean` | 清理产物 | `forja clean` |
| `doctor` | 诊断修复 | `forja doctor`、`forja doctor fix --remote` |
| `sync` | 文件同步 | `forja sync`、`forja sync --dry-run` |

## 通用选项

| 选项 | 说明 |
| --- | --- |
| `--help` | 显示帮助（支持 `forja --help` 和 `forja <command> --help`） |
| `--json` | JSON 输出，适合 AI/脚本解析 |
| `--workspace <dir>` | 操作根目录，默认当前目录 |
| `--plan` | 仅显示计划，不执行（适用于 build/clean/doctor） |

> **注意**：选项必须跟在命令后面。`forja status --json` ✓，`forja --json status` ✗。

## 命令参考

### `forja status`

查看当前项目状态、配置是否就绪和下一步动作。`status` 是推荐的第一条命令。

```bash
forja status
forja status --json
```

`status` 会按缺失项返回更具体的下一步：没有本地配置时提示 `init`；已有配置但缺项目时提示 `list targets` / `use target --project`；缺工具链时提示 `list env` / `use target --qt/--vs/--jom`；配置齐全后再提示 `build` 或 `run`。

### `forja init`

检测环境（Qt/VS/make），并保存当前工作区中能自动确定的配置。

```bash
forja init --json
```

`init` 不接收 `--project`、`--mode`、`--arch`、工具链路径。这些显式配置统一通过 `forja use` 写入。

### `forja list`

列出各类配置和候选项。

```bash
forja list targets --json     # 列出可用项目（.pro/.sln/Makefile/CMakeLists.txt）
forja list env --json         # 列出检测到的工具链环境
forja list env --qt --json    # 列出 Qt 环境详情
```

### `forja use`

切换当前 workspace 的配置，只更新显式传入的字段。

```bash
# 选择项目和构建配置
forja use target --project app.pro
forja use target --mode release --arch x64

# 切换本地/远程执行
forja use target --run-at remote
forja use target --run-at local

# 当前支持的远程操作
forja remote
forja remote set --server server-1 --remote-path /home/dev/workspace
forja remote restore <repo> <path>...
forja remote reset <repo> <path>... --all

# 配置 Qt/C++ 工具链
forja use target --qt /path/to/Qt --vs "C:/Program Files/Microsoft Visual Studio/2022/Community" --jom /path/to/jom
```

### `forja server`

管理同步服务器。

```bash
forja server                    # 列出所有服务器
forja server --detail <id>      # 查看服务器详情
forja server --json             # JSON 输出
forja server add --name dev --host 127.0.0.1 --username dev --json
forja server update server-1 --host 10.0.0.2 --json
forja server remove server-1 --json
```

### `forja build`

编译当前项目。

```bash
forja build                 # 默认编译
forja build fresh           # 清理后重新编译
forja build qmake           # 仅运行 qmake
forja build rcc             # 编译 .qrc 资源文件
forja build --plan          # 仅显示编译计划
```

### `forja run`

先杀掉已运行的程序，再编译并启动程序。

```bash
forja run                   # 前台运行
forja run --detach          # 后台运行
forja run designer app.ui   # 打开 Qt Designer
```

`--detach` 时，编译在前台执行；编译成功后后台启动程序，编译失败直接返回错误。

`--json` 输出在成功解析 Makefile 目标时会包含 `executablePath`，表示最终启动的可执行文件绝对路径。`run --detach --json` 成功时还会返回 `pid` 和 `logFile`。

### `forja stop`

停止运行中的程序。

```bash
forja stop
```

### `forja clean`

清理构建产物。

```bash
forja clean
forja clean --plan
```

### `forja doctor`

诊断和修复环境问题。

```bash
forja doctor                # 本地诊断
forja doctor --remote       # 远程诊断
forja doctor fix --remote   # 修复远程问题（部署 forja CLI）
```

### `forja sync`

按 git 变更文件同步到已配置的服务器。

```bash
forja sync                              # 同步所有变更
forja sync --yes                        # 跳过确认直接同步
forja sync reset                        # 清除同步状态
forja sync --dry-run                    # 预览待同步文件
```

| 选项 | 说明 |
| --- | --- |
| `--yes` | 跳过确认直接执行同步 |

子命令：

| 子命令 | 说明 |
| --- | --- |
| `reset` | 清除同步状态 |

服务器列表和每台服务器最近使用的远端目录存储在 `~/.forja/servers.json`；当前 workspace 的同步开关、选中服务器、当前路径和忽略列表存储在 `~/.forja/workspaces/<hash>.json`。

## Remote 配置

远程执行复用 sync 配置中的 server，先用 `forja status` 确认远端目标，再执行远程构建流程。

```bash
# 配置远程执行目标
forja remote set --server server-1 --remote-path /home/dev/workspace

# 将当前本地 CLI 打包并安装/更新到远端
forja remote bootstrap

```

bootstrap 复用远端 npm 已配置的全局 prefix，与手动执行 `npm install -g` 的位置一致；安装后通过 `command -v forja` 返回真实入口。

当前版本的 repo/build-order/transfer 高级配置尚未纳入公开 CLI 契约，不能在脚本中使用。

远程 repo/build-order/transfer 的公开参数尚未冻结；在契约冻结前不要依赖这些字段。

如果远端无法安装或执行 forja CLI，staged 模式会对执行类动作尝试 shell fallback：Qt 支持 `qmake/build/clean/run/stop/ps`，C++ 支持 `build/rebuild/clean`。`init/use/status` 等远端持久配置或诊断动作仍依赖远端 forja。

## JSON 输出

`--json` 输出共享以下关键字段：

```json
{
  "ok": true,
  "action": "build",
  "workspace": "/path/to/project",
  "activeTarget": {
    "kind": "qt",
    "project": "app.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "diagnostics": [],
  "nextAction": "forja build",
  "exitCode": 0,
  "errors": [],
  "logFile": "/path/to/log"
}
```

## 本地状态

配置保存在用户数据目录和项目目录下：

```text
~/.forja/
├── workspaces.json       # 已注册 workroot
├── workspaces/<hash>.json # 当前 workspace 的 Qt/C++/sync/remote 配置
└── servers.json          # 服务器列表

.forja/
└── sync-state.json       # 同步运行状态
```

执行日志保存在系统临时目录下的 `forja-logs`。

## 配置优先级

```text
CLI 参数 > 已保存配置 > 环境变量 > 自动检测 > 默认值
```

## 支持平台

- Windows (MSVC + jom / MSBuild)
- Linux (GCC + make)

## License
