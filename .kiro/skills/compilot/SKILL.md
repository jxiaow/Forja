---
name: compilot
description: Use when a C++ Qt qmake, .sln, or Makefile project needs build, run, clean, environment status, or remote sync work through the compilot CLI.
---

# compilot

当需要处理本地 C++ 项目，且机器上已经可用 `compilot` 命令时使用。

## 适用场景

- 基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- .sln 或 Makefile（含 makefile、GNUmakefile）的 SDK/库项目的构建
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到远程服务器

## 不适用

- 项目不是 C++ 项目（不含 .pro/.sln/Makefile）
- 机器上没有 `compilot` 命令
- 只是读代码或改代码，不涉及构建/运行

## 核心原则

1. **先 status 再动手**：用 `status --json` 看环境就绪状态和 diagnostics
2. **多候选必须选择**：`candidates` 有多项时，必须加 `--project` 指定
3. **默认执行**：命令默认执行，加 `--plan` 仅查看计划
4. **加 --json**：获取结构化输出，省 token
5. **run 必须 --detach**：程序启动后不会自行退出，不加会阻塞终端
6. **build/clean/qmake 不加 --detach**：前台执行完直接返回结果
7. **混合仓库**：同时有 .pro 和 .sln 时，分别用 `compilot qt` 和 `compilot sdk`

## 决策流程

```
用户要求构建/运行 →
  1. compilot qt status --json（或 sdk status）
  2. 检查 ready 字段：
     - ready: true → 检查 resolved 中 mode/arch/qtPath/vsDevShell/project：
       - 对应 settings 字段有值（用户设置过）→ 直接执行
       - 对应 settings 字段为空（用户没设置过）→ 调 env --json 看 available：
         - 只有一个候选 → 自动使用，不问
         - 有多个候选 → 展示候选让用户选择，用 init 写入后再执行
     - ready: false → 看 missing 和 diagnostics：
       - missing 含 "project" → 用 projects --json 看列表，向用户展示
         候选并让用户选择，然后 init --project <选择的路径>
       - missing 含 "qtPath" → 用 env --json 看可选项，向用户展示
         候选并让用户选择，然后 init --qt-path <选择的路径>
       - missing 含 "vsDevShellPath" → 同上，init --vs-dev-shell <路径>
       - missing 含 "makefile" → 先 qmake 生成 Makefile
  3. 执行命令，检查 ok 字段：
     - ok: true → 完成
     - ok: false → 看 errors 和 diagnostics 定位问题
```

**如何判断"用户没设置过"：**
- status 输出的 resolved 中，mode/arch 显示的是实际生效值（含兜底）
- 但如果 settings 文件里对应字段为空字符串，说明用户从未通过
  `init --mode`/`--arch` 或 UI 主动设置过
- agent 可通过 status 的 resolved 与 env 的 available 对比判断：
  resolved 里有值但 env.available 里有多个选项 → 需要确认

**关键：当存在多个候选（多个 Qt 版本、多个 .pro 文件、多个 VS 版本、
debug/release、x86/x64）且用户未设置过时，必须展示选项让用户选择，
禁止自动选择后静默执行。**

## Qt 命令

| 命令 | 用途 | 关键参数 |
|------|------|----------|
| `init` | 检测环境并保存配置到 .compilot/ | `--qt-path`, `--vs-dev-shell`, `--project` |
| `env` | 查看工具链环境和可选项 | |
| `projects` | 列出 workspace 下的 .pro 文件 | |
| `status` | 当前配置和就绪状态 | `--save-local` |
| `qmake` | 生成 Makefile | `--project`, `--mode`, `--arch` |
| `build` | 编译 | `--plan`, `--detach` |
| `run` | 编译并运行 | `--detach`（必须） |
| `stop` | 停止运行中的程序 | |
| `logs` | 查看 detach 模式的运行日志 | |
| `clean` | 清理构建产物 | |
| `sync` | 同步变更文件到远程服务器 | `--server` |
| `rcc` | 编译 .qrc 资源文件 | |

### Qt 通用参数

| 参数 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--project <path>` | 指定 .pro 文件（相对路径） |
| `--mode debug\|release` | 构建模式 |
| `--arch x86\|x64` | 目标架构 |
| `--target <name>` | QMake TARGET 覆盖 |
| `--plan` | 仅显示命令计划，不执行 |
| `--detach` | 后台执行，日志落文件 |
| `--json` | 结构化 JSON 输出 |

## SDK 命令

| 命令 | 用途 | 关键参数 |
|------|------|----------|
| `init` | 检测 VS 环境并保存配置 | `--vs-dev-cmd`, `--project` |
| `env` | 查看构建环境和可选项 | |
| `projects` | 列出 .sln/Makefile 文件 | |
| `status` | 项目就绪状态 | |
| `build` | 编译 | `--plan` |
| `rebuild` | clean + build | |
| `clean` | 清理 | |

### SDK 通用参数

| 参数 | 说明 |
|------|------|
| `--workspace <path>` | 工作区路径，默认当前目录 |
| `--project <path>` | 项目入口文件（.sln 或 Makefile） |
| `--mode debug\|release` | 编译模式（默认 debug） |
| `--arch x86\|x64` | 目标架构（默认 x86，仅 Windows） |
| `--vs-dev-cmd <path>` | VsDevCmd.bat 路径 |
| `--plan` | 仅输出命令计划，不执行 |
| `--json` | JSON 格式输出 |

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

- **不要拆解命令**：`compilot qt run` 会先杀旧进程、编译、再启动，不要自己拆步骤
- **不要猜路径**：不要自己拼 qmake/jom/msbuild 命令，统一用 compilot
- **多候选必须让用户选**：env/projects 返回多个候选时，列出选项让用户决定，不要自动取第一个
- **首次配置必须确认**：status 中 resolved 的 qtPath、vsDevShell、project 如果是自动检测的，先展示给用户确认再执行
- **只有 run 加 --detach**：程序启动后不会自行退出，不加会阻塞
- **detach 后看 logs**：`run --detach` 返回 `ok: true` 只表示程序已启动；用 `logs --json` 确认运行状态
- **非 detach 直接看结果**：`ok` 字段直接反映成功/失败
- **执行前确认目标**：看 `target`、`project`、`candidates`、`diagnostics`
- **需要完整日志时**：读 `logFile` 路径指向的文件

## 常见场景示例

```bash
# 首次使用：检测环境并初始化
compilot qt init --json

# 日常编译
compilot qt build --json

# 编译并后台运行
compilot qt run --detach --json

# 看运行输出
compilot qt logs --json

# 停止程序
compilot qt stop --json

# 只看编译计划不执行
compilot qt build --plan --json

# 指定特定项目文件
compilot qt build --project src/app.pro --json

# SDK 编译
compilot sdk build --mode release --arch x64 --json
```
