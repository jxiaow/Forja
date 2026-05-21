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

## 通用选项

所有 Qt/SDK 命令都支持以下选项：

| 选项 | 说明 |
| --- | --- |
| `--workspace <dir>` | 工作区目录，默认当前目录 |
| `--json` | 输出 JSON，适合 AI 工具解析 |
| `--no-color` | 禁用彩色输出 |
| `--verbose` | 输出详细日志 |

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

查看当前 Qt 项目状态、环境检测结果、候选 `.pro` 文件列表。

```bash
compilot qt status --json
```

| 选项 | 说明 |
| --- | --- |
| `--detect` | 重新检测环境 |
| `--save-local` | 将检测结果写入本地配置 |

### `compilot qt init`

检测 Qt 和 Visual Studio 环境，并保存当前工作区的 Qt 配置。

```bash
compilot qt init --json
```

`init` 会保存检测到的 Qt 路径、VS 环境、项目选择等，后续命令会自动读取，不需要每次指定 `--project`、`--mode`、`--arch`。

初始化时可以显式指定配置：

```bash
compilot qt init --project app.pro --mode debug --arch x64 --json
```

### `compilot qt qmake`

生成 Makefile。

```bash
compilot qt qmake --json
```

### `compilot qt build`

编译 Qt 项目。

```bash
compilot qt build --json
```

### `compilot qt run`

先杀掉已运行的程序，再编译并启动程序。

```bash
compilot qt run --json
compilot qt run --detach --json
```

`--detach` 时，编译在前台执行；编译成功后后台启动程序，编译失败直接返回错误。

### `compilot qt logs`

查看后台执行日志。

```bash
compilot qt logs --tail 100
```

### `compilot qt stop`

停止运行中的程序。

```bash
compilot qt stop
```

### `compilot qt clean`

清理构建产物。

```bash
compilot qt clean --json
```

### `compilot qt sync`

按 git 变更文件同步到已配置的远程服务器。

```bash
compilot qt sync --json
```

| 选项 | 说明 |
| --- | --- |
| `--dry-run` | 只预览待同步文件 |
| `--server <name>` | 指定服务器名称，对应 `~/.compilot/servers.json` 中的 `name` |

### `compilot qt rcc`

编译 `.qrc` 资源文件为 `.rcc` 二进制，并复制到可执行文件输出目录。

```bash
compilot qt rcc --json
```

RCC 项目路径解析顺序：

1. 命令行 `--rcc-project`
2. 已保存的 `rccProjectPath`
3. 自动扫描 workspace 父目录下的 `XYRcc/` 目录

`run` 命令会自动检测 RCC 资源是否有变更，有变更时自动插入 rcc 编译步骤。

## SDK 命令

### `compilot sdk status`

查看 SDK 项目状态和候选项目列表。

```bash
compilot sdk status --json
```

### `compilot sdk build`

编译 SDK 项目。

```bash
compilot sdk build --json
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
