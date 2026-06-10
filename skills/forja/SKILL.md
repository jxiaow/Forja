---
name: forja
description: Use when a C++ Qt qmake, .sln, or Makefile project needs build, run, clean, environment status, or sync work through the forja CLI.
---

# forja

当需要处理本地 C++ 项目，且机器上已经可用 `forja` 命令时使用。

## 适用场景

- 基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- .sln 或 Makefile（含 makefile、GNUmakefile）的 SDK/库项目的构建
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到服务器

## 不适用

- 项目不是 C++ 项目（不含 .pro/.sln/Makefile）
- 机器上没有 `forja` 命令
- 只是读代码或改代码，不涉及构建/运行

## 核心原则

1. **先 status 再动手**：用 `status --json` 看环境就绪状态和 diagnostics
2. **init 只做自动初始化**：不要给 `init` 传 `--project`、`--mode`、`--arch`、工具链路径或 target
3. **use 负责显式选择**：项目、mode、arch、Qt/VS 路径只通过 `use` 写入保存配置
4. **执行命令只读配置**：`build`、`run`、`clean`、`qmake`、`rebuild` 不传项目或构建配置参数
5. **默认执行**：命令默认执行，加 `--plan` 仅查看计划
6. **加 --json**：获取结构化输出，省 token
7. **run 必须 --detach**：程序启动后不会自行退出，不加会阻塞终端
8. **build/clean/qmake 不加 --detach**：前台执行完直接返回结果
9. **混合仓库**：同时有 .pro 和 .sln 时，分别用 `forja qt` 和 `forja sdk`

## 决策流程

```
用户要求构建/运行 →
  1. forja qt status --json（或 sdk status）
  2. 看 diagnostics / nextActions：
     - 没有本地配置 → 运行 init --json，让 CLI 保存可自动确定的配置
     - 缺项目或 target → 运行 projects --json，展示候选，让用户选择后运行 use --project <path> [--target <name>] --json
     - 缺 mode/arch 确认 → 按 status 建议运行 use --mode ... --arch ... --json
     - 缺 Qt/VS 工具链 → 运行 env --json，展示候选，让用户选择后运行 use 写入路径
     - 缺 Makefile → 先 qmake --json
  3. 配置齐全后执行 build/run/clean/qmake/rebuild：
     - 不追加 --project、--mode、--arch、--qt-path、--vs-dev-shell、--vs-dev-cmd、--target
     - 需要切换配置时，先运行 use，再重新 status
  4. 执行命令，检查 ok 字段：
     - ok: true → 完成
     - ok: false → 看 errors 和 diagnostics 定位问题
```

**关键：当存在多个候选（多个 Qt 版本、多个 .pro 文件、多个 VS 版本、
debug/release、x86/x64）且用户未设置过时，必须展示选项让用户选择，
禁止自动选择后静默执行。**

## Qt 命令

| 命令 | 用途 | 关键参数 |
|------|------|----------|
| `status` | 当前配置和就绪状态 | |
| `init` | 自动检测并保存能确定的配置 | |
| `use` | 切换/确认项目和构建配置 | `--project`, `--mode`, `--arch`, `--qt-path`, `--vs-dev-shell`, `--target` |
| `env` | 查看工具链环境和可选项 | |
| `projects` | 列出 workspace 下的 .pro 文件 | |
| `qmake` | 生成 Makefile | `--plan` |
| `build` | 编译 | `--plan` |
| `run` | 编译并运行 | `--detach`（必须） |
| `stop` | 停止运行中的程序 | |
| `ps` | 查看 detach 模式的运行状态 | |
| `clean` | 清理构建产物 | `--plan` |
| `rcc` | 编译 .qrc 资源文件 | `--plan` |

### Qt 通用参数

| 参数 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--plan` | 仅显示命令计划，不执行 |
| `--detach` | 仅 `run` 可用，后台启动程序并写日志 |
| `--json` | 结构化 JSON 输出 |

Qt 配置参数只允许用于 `forja qt use`：

| 参数 | 说明 |
|------|------|
| `--project <path>` | 指定 .pro 文件（相对 workspace） |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--qt-path <path>` | Qt 安装路径 |
| `--vs-dev-shell <path>` | Launch-VsDevShell.ps1 路径 |
| `--target <name>` | QMake TARGET 覆盖 |

当 `projects --json` 返回多个 `.pro` 或同名 target 时，向用户展示 `path` 和 `target`，再用 `forja qt use --project <path> --target <name> --json` 写入选择。

## SDK 命令

| 命令 | 用途 | 关键参数 |
|------|------|----------|
| `status` | 当前配置和就绪状态 | |
| `init` | 自动检测并保存能确定的配置 | |
| `use` | 切换/确认 SDK 项目和构建配置 | `--project`, `--mode`, `--arch`, `--vs-dev-cmd` |
| `env` | 查看构建环境和可选项 | |
| `projects` | 列出 .sln/Makefile 文件 | |
| `build` | 编译 | `--plan` |
| `rebuild` | clean + build | `--plan` |
| `clean` | 清理 | `--plan` |

### SDK 通用参数

| 参数 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--plan` | 仅输出命令计划，不执行 |
| `--json` | JSON 格式输出 |

SDK 配置参数只允许用于 `forja sdk use`：

| 参数 | 说明 |
|------|------|
| `--project <path>` | 项目入口文件（.sln 或 Makefile，相对 workspace） |
| `--mode debug\|release` | 编译模式 |
| `--arch x86\|x64` | 目标架构（非 Windows 只支持 x64） |
| `--vs-dev-cmd <path>` | VsDevCmd.bat 路径 |

## Sync 命令

`sync` 是顶层命令：使用 `forja sync ...`，不属于 `forja qt` 或 `forja sdk`。

| 命令 | 用途 | 关键参数 |
|------|------|----------|
| `status` | 查看同步配置是否就绪 | `--server` |
| `servers` | 列举全局同步服务器 | |
| `add-server` | 增加同步服务器 | `--name`, `--host`, `--username`, `--port`, `--auth-mode`, `--private-key-path` |
| `update-server` | 修改同步服务器 | `--server`, `--name`, `--host`, `--username`, `--port`, `--auth-mode`, `--private-key-path` |
| `remove-server` | 删除同步服务器 | `--server` |
| `sync` | 同步 git 变更文件到服务器 | `--server`, `--repo`, `--file <path>`, `--plan` |

### Sync 参数

| 参数 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--server <id>` | 指定同步目标服务器 ID，默认读取项目同步配置 |
| `--repo <name>` | 多仓库工作区中只同步指定子仓库；仅同步/预览可用 |
| `--file <path>` | 单文件同步；可重复，路径可相对 workspace、相对仓库根目录或使用绝对路径 |
| `--plan` | 仅预览待同步文件，不执行 SSH/SCP |
| `--name <name>` | 服务器名称；仅服务器管理命令可用 |
| `--host <host>` | SSH 主机；仅服务器管理命令可用 |
| `--port <port>` | SSH 端口；仅服务器管理命令可用 |
| `--username <name>` | SSH 用户名；仅服务器管理命令可用 |
| `--auth-mode key\|password` | SSH 认证方式；仅服务器管理命令可用 |
| `--private-key-path <path>` | SSH 私钥路径；仅服务器管理命令可用 |
| `--json` | 结构化 JSON 输出 |

## JSON 输出关键字段

```jsonc
{
  "ok": true,              // 操作是否成功
  "action": "status",      // 当前动作
  "ready": true,           // 是否就绪可执行（status 专有）
  "checks": {              // 各项检查结果（status 专有）
    "settings": true,
    "project": true,
    "qtPath": true,
    "jom": true,
    "makefile": true
  },
  "missing": ["project"],  // 缺失项列表
  "target": "MyApp",       // 项目名
  "project": "app.pro",    // 项目文件
  "exitCode": 0,           // 进程退出码（build/run）
  "errors": [],            // 编译错误行（最多 20 条）
  "diagnostics": [],       // 诊断信息（warning/error 级别）
  "nextAction": "init",    // 建议的下一步命令
  "nextActions": [],       // 建议的下一步命令列表
  "logFile": "...",        // 日志文件路径（detach 模式）
  "resolved": {            // 实际使用的配置
    "mode": "debug",
    "arch": "x86",
    "qtPath": "...",
    "vsDevShell": "...",
    "jomPath": "..."
  }
}
```

## 执行规则

- **不要拆解命令**：`forja qt run` 会先杀旧进程、编译、再启动，不要自己拆步骤
- **不要猜路径**：不要自己拼 qmake/jom/msbuild 命令，统一用 forja
- **多候选必须让用户选**：env/projects 返回多个候选时，列出选项让用户决定，不要自动取第一个
- **首次配置必须确认**：status 中 resolved 的 qtPath、vsDevShell、project 如果是自动检测的，先展示给用户确认再执行
- **只有 run 加 --detach**：程序启动后不会自行退出，不加会阻塞
- **detach 后看 ps**：`run --detach` 返回 `ok: true` 表示程序已启动且已解析到目标进程 PID；用 `ps --json` 随时确认运行状态和日志路径
- **非 detach 直接看结果**：`ok` 字段直接反映成功/失败
- **命令耗时与超时**：`build`、`run --detach`、`clean`、`qmake` 都是前台阻塞命令，会等执行完成后返回 JSON 结果；其中 `build` 和 `run --detach`（内含编译步骤）耗时取决于增量编译量，通常几十秒到几分钟。执行时应设置足够的超时（建议 15 分钟），不要因默认超时中断后反复重试。这些命令最终都会自行退出，**不是长驻进程，禁止用后台进程方式启动**
- **执行前确认目标**：看 `target`、`project`、`candidates`、`diagnostics`
- **需要完整日志时**：读 `logFile` 路径指向的文件

## 常见场景示例

```bash
# 首次使用：先看状态，再自动初始化
forja qt status --json
forja qt init --json

# 显式选择配置
forja qt use --project src/app.pro --mode release --json

# 日常编译
forja qt build --json

# 编译并后台运行
forja qt run --detach --json

# 查运行状态和日志路径
forja qt ps --json

# 停止程序
forja qt stop --json

# 只看编译计划不执行
forja qt build --plan --json

# 同步：先看状态，再预览或单文件同步
forja sync status --json
forja sync servers --json
forja sync add-server --name dev --host 127.0.0.1 --username dev --json
forja sync update-server --server server-1 --host 10.0.0.2 --json
forja sync remove-server --server server-1 --json
forja sync --plan --json
forja sync --file src/main.cpp --json

# SDK 编译：配置先用 use，build 只读保存配置
forja sdk status --json
forja sdk use --project Makefile --mode release --json
forja sdk build --json
```
