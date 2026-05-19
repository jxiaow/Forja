---
name: compilot
description: Use when a C++ Qt qmake, .sln, or Makefile project needs build, run, clean, environment status, remote sync, or remote deploy work through the compilot CLI.
---

# compilot

当需要处理本�?C++ 项目，且机器上已经可�?`compilot` 命令时使用�?

## 适用场景

- 基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- .sln 或 Makefile（含 makefile、GNUmakefile）的 SDK/库项目的构建
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到远程服务器
- 需要远程编译部署（在编译机上编译、传输产物、启动程序）

## 不适用

- 项目不是 C++ 项目（不�?.pro/.sln/Makefile�?
- 机器上没�?`compilot` 命令
- 只是读代码或改代码，不涉及构�?运行

## 核心原则

1. 先用 `status --json` 看环境、项目候选和已保存配置
2. 多个候选项目时，必须从 `candidates` 选择并显式加 `--project`
3. 命令默认执行，加 `--plan` 仅查看计划不执行
4. 加 `--json` 获取精简结构化输出，省 token
5. `run` 执行时必须加 `--detach`（程序启动后不会自行退出，不加会阻塞）
6. `build`、`clean`、`qmake` 不需要 `--detach`，前台执行完直接返回结果
7. 远程模式加 `--remote`，会执行完整的远程编译部署流程
8. 混合仓库（同时有 .pro 和 .sln/Makefile）：先分别 `compilot qt status` 和 `compilot sdk status` 查看；"运行"默认指 Qt（SDK 通常是库项目无 run）；"编译 SDK"或明确提到库/SDK 时用 `compilot sdk`

## Qt 命令参�?

```bash
# 查看状态（含环境检测、项目列表、就绪状态）
compilot qt status --json

# 查看工具链环境（Qt/VS 版本、可选项）
compilot qt env --json

# 查看候选 .pro 文件列表
compilot qt projects --json

# 初始化并保存本地配置
compilot qt init --json

# 生成 Makefile
compilot qt qmake --json

# 查看编译计划（不执行）
compilot qt build --plan --json

# 执行编译
compilot qt build --json

# 编译并运行（后台启动）
compilot qt run --detach --json

# 查看运行日志
compilot qt logs --json

# 停止程序
compilot qt stop --json

# 清理构建产物
compilot qt clean --json

# 同步变更文件到远程
compilot qt sync --json

# 编译 .qrc 资源文件为 .rcc 二进制并复制到输出目录
compilot qt rcc --json

# 远程编译部署（完整流程：sync → build → transfer → stop → launch）
compilot qt build --remote --json

# 远程仅编译（不部署，执行到 build 阶段后停止）
compilot qt build --remote --to build --json

# 远程快速模式（跳过 preCheck、branchSync 和 baselineCheck）
compilot qt build --remote --fast --json

# 远程从指定阶段开始（可选: sync/build/transfer/stop/launch）
compilot qt build --remote --from build --json

# 远程从 build 到 transfer（跳过启动）
compilot qt build --remote --from build --to transfer --json

# 远程停止程序
compilot qt stop --remote --json

# 远程状态查看
compilot qt status --remote --json

# 远程日志
compilot qt logs --remote --json
```

### Qt 可选参数

| 参数 | 说明 | 适用命令 |
|------|------|----------|
| `--workspace <path>` | 工作区路径，默认当前目录 | 所有 |
| `--project <path>` | 指定 .pro 文件（支持相对路径） | init/qmake/build/run/clean/stop |
| `--mode debug\|release` | 构建模式 | init/qmake/build/run/clean |
| `--arch x86\|x64` | 目标架构 | init/qmake/build/run/clean |
| `--qt-path <path>` | Qt 安装路径 | init |
| `--vs-dev-shell <path>` | VsDevShell 路径 | init |
| `--target <name>` | QMake TARGET 覆盖 | qmake/build/run |
| `--plan` | 仅显示命令计划，不执行 | qmake/build/run/clean/sync |
| `--detach` | 后台执行，日志落文件 | build/run/clean |
| `--json` | 结构化 JSON 输出 | 所有 |
| `--remote` | 远程模式（在编译机上执行） | build/run/stop/status/logs |
| `--fast` | 远程快速模式 | build/run（需 --remote） |
| `--from <stage>` | 从指定阶段开始 | build/run（需 --remote） |
| `--to <stage>` | 执行到指定阶段后停止 | build/run（需 --remote） |
| `--force` | 忽略基线不一致等警告 | build/run（需 --remote） |
| `--server <name>` | 指定服务器名称 | sync |
| `--save-local` | 将检测结果写入本地缓存 | status |

## SDK 命令参考

```bash
# 查看状态（含 VS 环境、项目列表、就绪状态）
compilot sdk status --json

# 初始化本地配置（检测 VS 环境、保存到 .compilot/）
compilot sdk init --json

# 查看构建环境（VS 版本、make 路径、可选项）
compilot sdk env --json

# 查看候选项目文件（.sln 或 Makefile）
compilot sdk projects --json

# 执行编译
compilot sdk build --json

# 查看编译计划（不执行）
compilot sdk build --plan --json

# 重新编译（clean + build）
compilot sdk rebuild --json

# 清理
compilot sdk clean --json

# 远程编译部署（完整流程）
compilot sdk build --remote --json

# 远程快速模式
compilot sdk build --remote --fast --json
```

### SDK 可选参数

| 参数 | 说明 | 适用命令 |
|------|------|----------|
| `--workspace <path>` | 工作区路径，默认当前目录 | 所有 |
| `--project <path>` | 项目入口文件（.sln 或 Makefile） | build/rebuild/clean |
| `--mode debug\|release` | 编译模式（默认 debug） | init/build/rebuild/clean |
| `--arch x86\|x64` | 目标架构（默认 x86，仅 Windows） | init/build/rebuild/clean |
| `--vs-dev-cmd <path>` | VsDevCmd.bat 路径（Windows） | init |
| `--plan` | 仅输出命令计划，不执行 | build/rebuild/clean |
| `--json` | JSON 格式输出 | 所有 |
| `--remote` | 远程模式 | build |
| `--fast` | 远程快速模式 | build（需 --remote） |
| `--from <stage>` | 从指定阶段开始 | build（需 --remote） |
| `--to <stage>` | 执行到指定阶段后停止 | build（需 --remote） |
| `--force` | 忽略基线不一致等警告 | build（需 --remote） |

## Remote 命令参考

```bash
# 测试远程连接（SSH 连通 + remotePath + compilot 版本）
compilot remote test --json
```

注意：`compilot remote setup` 是交互式命令，需要 TTY 终端，AI 不应调用。

## 执行规则

- **不要拆解命令**：`compilot qt run` 会先杀旧进程、编译、再启动，不要自己拆步骤
- **不要猜路�?*：不要自己拼 qmake/jom/msbuild 命令，统一�?compilot
- **只有 run �?--detach**：程序启动后不会自行退出，不加会阻�?
- **build/clean/qmake 不加 --detach**：前台执行完直接返回 `errors`、`exitCode`、`logFile`
- **detach 后看 logs**：`run --detach` 返回 `ok: true` 只表示程序已启动；看 `compilot qt logs --json` 确认运行状态
- **非 detach 直接看结果**：`ok` 字段直接反映成功/失败，`errors` 字段包含错误行
- **执行前确认目标**：看 `target`、`project`、`candidates`、`diagnostics`
- **需要完整日志时**：读 `logFile` 路径指向的文件
- **远程模式**：`--remote` 触发完整流程（sync → build → transfer → launch），不需要手动拆步骤
- **远程仅编译**：`--to build` 只执行到编译阶段，不做 transfer/stop/launch。常用于只想验证编译是否通过
- **远程 --from**：从中间阶段恢复执行。常用场景：编译已成功但部署失败，用 `--from transfer` 跳过重新编译
- **远程 --from + --to 组合**：精确控制执行范围，如 `--from build --to transfer`
- **远程 stop/status/logs**：加 `--remote` 直接操作远程，不走流水线
- **executionLocation 自动检测**：settings.json 中 `executionLocation` 设为 `remote` 时，`build`/`run` 命令自动启用远程模式，无需每次加 `--remote`

## JSON 输出关键字段

```jsonc
{
  "ok": true,            // 是否成功
  "action": "build",     // 当前动作
  "target": "MyApp",    // 项目名（Qt）
  "project": "app.pro", // 项目文件（相对路径）
  "exitCode": 0,        // 进程退出码
  "errors": [...],      // 编译错误行（最多 20 条）
  "diagnostics": [...], // 诊断信息（warning/error 级别）
  "nextActions": [...], // 建议的下一步命令
  "logFile": "...",     // 日志文件路径（detach 模式）
  "resolved": {         // 实际使用的配置
    "mode": "debug",
    "arch": "x86",
    "qtPath": "...",
    "project": "..."
  }
}
```

## 错误处理

- `ok: false` 时看 `errors` 和 `diagnostics` 字段
- 环境未配置时先看 `status` 的 `diagnostics` / `nextActions`，需要保存配置时再 `compilot qt init` 或 `compilot sdk init`
- 多个项目文件时用 `projects --json` 看列表，再加 `--project` 指定
- 远程连接失败时用 `compilot remote test --json` 诊断
- 远程编译失败时看 `errors` 字段，也可 `--from build` 重试

## 远程环境配置（remoteEnv）

当远程没有安装 compilot（使用 shell fallback 模式）时，需要在 `.compilot/sync-config.json` 中配置 `remoteEnv` 字段：

```jsonc
{
  "enabled": true,
  "selectedServer": "build-server-id",
  "ignore": [".git", "node_modules", "out", ".compilot"],
  "remoteEnv": {
    "qtPath": "/opt/Qt/5.15.2/gcc_64",  // 远程 Qt 安装路径（POSIX）
    "target": "MyApp",                    // 远程可执行文件名
    "project": "src/app.pro"              // 远程 .pro 文件相对路径
  }
}
```

- `remoteEnv.qtPath`：远程机器上 Qt 的安装路径，用于定位 qmake 和设置 PATH
- `remoteEnv.target`：远程编译输出的可执行文件名（用于 run/stop）
- `remoteEnv.project`：.pro 文件相对于远程工作目录的路径
- 如果远程已安装 compilot ≥ 0.7.0，则不需要配置 remoteEnv（远程 compilot 读自己的配置）
- 未配置 remoteEnv 时，fallback 模式从本地 settings 提取平台无关信息（target 名、项目相对路径），不会使用本地 Windows 路径
