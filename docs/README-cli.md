# Compilot CLI

命令行工具用于 C++ 项目的构建、运行和环境管理。

当前 CLI 已实现子命令：`qt`、`sdk`、`cleanup`。`remote` 相关流程仍是设计稿，尚未接入 CLI dispatcher。

## 安装

```bash
npm install
npm run compile
npm link
```

安装后可直接执行：

```bash
compilot --help
compilot qt --help
compilot sdk --help
```

## AI 工具集成

Skill 文件位于 CLI 包的 `skills/compilot/` 目录下，安装后 AI 助手可直接调用 `compilot` 命令。

## 使用流程

手动使用时先查看状态，再按状态提示执行下一步。`init` 只用于首次自动初始化；如果 `status` 提示缺项目、缺构建配置或缺工具链，先用 `projects` / `env` 查看候选，再用 `use` 写入显式选择：

```bash
compilot qt status
compilot qt init
compilot qt env
compilot qt projects
compilot qt use --mode release
compilot qt build
compilot qt run
```

AI 或脚本需要结构化输出时追加 `--json`：

```bash
compilot qt status --json
compilot qt build --json
```

## 通用选项

Qt/SDK 命令通用选项：

| 选项 | 说明 |
| --- | --- |
| `--workspace <dir>` | 操作根目录，默认当前目录；日常手动使用通常先 `cd` 到项目根目录，不需要传 |
| `--json` | 输出 JSON，适合 AI/脚本解析 |

`--workspace` 用来确定本次命令读写哪个项目的本地配置、从哪里扫描 `.pro`、以及同步/日志等状态归属。它不是 `.pro` 文件路径；多项目仓库中用 `compilot qt use --project <relative.pro>` 在该 workspace 内选择具体项目。

## JSON 输出

`--json` 输出共享以下关键字段：

```json
{
  "ok": true,
  "command": "qt build",
  "workspace": "/path/to/project",
  "project": "app.pro",
  "candidates": [],
  "diagnostics": [],
  "nextActions": [],
  "resolved": {
    "mode": "debug",
    "arch": "x64"
  }
}
```

## Qt 命令

### `compilot qt status`

查看当前 Qt 项目状态、当前 workspace、配置是否就绪和下一步动作。`status` 是推荐的第一条命令。

```bash
compilot qt status
```

`status` 会按缺失项返回更具体的下一步：没有本地配置时提示 `init`；已有配置但缺项目时提示 `projects` / `use --project`；`mode` / `arch` 未写入时提示 `use --mode ... --arch ...`；缺 Qt/VS 工具链时提示 `env` / `use --qt-path` 或 `use --vs-dev-shell`；配置齐全后再提示 `qmake`、`build` 或 `run`。

`build` / `run` / `clean` / `qmake` / `stop` 只读取已保存项目配置；如果没有先通过 `init` 自动保存单项目，或没有通过 `use` 确认项目、mode、arch，这些命令会返回 `status` 作为统一入口。

### `compilot qt init`

检测 Qt 和 Visual Studio 环境，并保存当前工作区中能自动确定的 Qt 配置。

```bash
compilot qt init --json
```

`init` 不接收 `--project`、`--mode`、`--arch`、`--qt-path`、`--vs-dev-shell`、`--target`。这些显式配置统一通过 `compilot qt use` 写入；其中 `mode` 的默认值只会在 `status` 中作为建议展示。`arch` 如果在当前平台只有一种可选值，`init` 会直接写入；否则由 `status` 提示后再用 `use` 确认。

### `compilot qt use`

切换当前 workspace 正在使用的项目或构建配置，只更新显式传入的字段。

```bash
compilot qt use --mode release
compilot qt use --project app.pro
compilot qt use --qt-path /path/to/Qt
```

### `compilot qt qmake`

生成 Makefile。

```bash
compilot qt qmake
```

### `compilot qt build`

编译 Qt 项目。

```bash
compilot qt build
```

### `compilot qt run`

先杀掉已运行的程序，再编译并启动程序。

```bash
compilot qt run
compilot qt run --detach
```

`--detach` 时，编译在前台执行；编译成功后后台启动程序，编译失败直接返回错误。

### `compilot qt logs`

查看后台执行日志。

```bash
compilot qt logs
```

### `compilot qt stop`

停止运行中的程序。

```bash
compilot qt stop
```

### `compilot qt clean`

清理构建产物。

```bash
compilot qt clean
```

### `compilot qt sync`

按 git 变更文件同步到已配置的远程服务器。

```bash
compilot qt sync
compilot qt sync --plan --json
```

| 选项 | 说明 |
| --- | --- |
| `--plan`, `--dry-run` | 预览待同步文件、目标服务器和远程路径，不执行上传 |
| `--server <name>` | 指定服务器名称，对应 `~/.compilot/servers.json` 中的 `name` |
| `--repo <name>` | 多 git 仓库 workspace 时只同步指定仓库 |

同步配置目前通过 VSCode 配置面板「远程同步」初始化：服务器列表存储在 `~/.compilot/servers.json`，当前 workspace 的同步开关、选中服务器、远程路径和忽略列表存储在 `~/.compilot/projects/<hash>.json`。

### `compilot qt rcc`

编译 `.qrc` 资源文件为 `.rcc` 二进制，并复制到可执行文件输出目录。

```bash
compilot qt rcc --json
```

RCC 项目路径解析顺序：

1. 已保存的 `rccProjectPath`
2. 自动扫描 workspace 父目录下的 `XYRcc/` 目录

`run` 命令会自动检测 RCC 资源是否有变更，有变更时自动插入 rcc 编译步骤。

## SDK 命令

### `compilot sdk status`

查看 SDK 项目状态、当前 workspace、配置是否就绪和下一步动作。`status` 是 SDK 推荐的第一条命令。

```bash
compilot sdk status
compilot sdk status --json
```

`status` 会按缺失项返回更具体的下一步：没有本地配置时提示 `init`；已有配置但缺项目时提示 `projects` / `use --project`；缺 VS/make 工具链时提示 `env` / `use --vs-dev-cmd`；配置齐全后再提示 `build`。

`build` / `rebuild` / `clean` 只读取已保存项目配置；如果没有先通过 `init` 自动保存单项目，或没有通过 `use` 确认项目、mode、arch，这些命令会返回 `status` 作为统一入口。

### `compilot sdk init`

检测 Visual Studio 或 make 环境，并保存当前工作区中能自动确定的 SDK 配置。

```bash
compilot sdk init --json
```

`init` 不接收 `--project`、`--mode`、`--arch`、`--vs-dev-cmd`。这些显式配置统一通过 `compilot sdk use` 写入。非 Windows 平台只有 `x64` 架构，`init` 会直接写入；Windows 下可通过 `use --arch` 切换。

### `compilot sdk use`

切换当前 workspace 正在使用的 SDK 项目或构建配置，只更新显式传入的字段。

```bash
compilot sdk use --project Makefile
compilot sdk use --mode release
compilot sdk use --vs-dev-cmd "C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/Tools/VsDevCmd.bat"
```

### `compilot sdk build`

编译 SDK 项目。

```bash
compilot sdk build
compilot sdk build --plan --json
```

### `compilot sdk rebuild`

重新编译 SDK 项目。

```bash
compilot sdk rebuild --json
```

### `compilot sdk clean`

清理 SDK 构建产物。

```bash
compilot sdk clean
```

## Cleanup 命令

清理 Compilot 本地运行状态和缓存文件。

```bash
compilot cleanup --json
```

## Remote 命令（设计稿，暂未实现）

`compilot remote ...`、`qt build --remote`、`sdk build --remote`、远程部署和分阶段远程流水线目前只存在于设计文档中，当前 CLI 入口不会路由这些命令。

已实现的远程相关能力仅限：

- VSCode 配置面板维护服务器列表
- `compilot qt sync` 按本地配置执行文件同步
- 同步状态写入 `.compilot/sync-state.json`

## 本地状态

配置保存在用户数据目录和项目目录下：

```text
~/.compilot/
├── projects/<hash>.json  # 当前 workspace 的 Qt/SDK/sync 配置
└── servers.json          # 服务器列表

.compilot/
└── sync-state.json       # 同步运行状态
```

执行日志保存在系统临时目录下的 `compilot-logs`。

## 配置优先级

```text
CLI 参数 > 已保存配置 > 环境变量 > 自动检测 > 默认值
```

## 支持平台

- Windows (MSVC + jom)
- Linux (GCC + make)

## License
