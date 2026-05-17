---
name: compilot
description: Use when a C++ Qt qmake, .sln, or Makefile project needs build, run, clean, environment status, remote sync, or remote deploy work through the compilot CLI.
---

# compilot

当需要处理本地 C++ 项目，且机器上已经可用 `compilot` 命令时使用。

## 适用场景

- 基于 qmake 的 Qt/C++ 项目的构建、运行、清理
- .sln 或 Makefile 的 SDK/库项目的构建
- 需要检测 Qt/VS 环境或项目状态
- 需要同步变更文件到远程服务器
- 需要远程编译部署（在编译机上编译、传输产物、启动程序）

## 不适用

- 项目不是 C++ 项目（不是 .pro/.sln/Makefile）
- 机器上没有 `compilot` 命令
- 只是读代码或改代码，不涉及构建/运行

## 核心原则

1. 先用 `status --json --brief` 看环境、项目候选和已保存配置
2. 多个候选项目时，必须从 `candidates` 选择并显式加 `--project`
3. 命令默认执行，加 `--plan` 仅查看计划不执行
4. 加 `--json --brief` 获取精简结构化输出，省 token
5. `run` 执行时必须加 `--detach`（程序启动后不会自行退出，不加会阻塞）
6. `build`、`clean`、`qmake` 不需要 `--detach`，前台执行完直接返回结果
7. 远程模式加 `--remote`，会执行完整的远程编译部署流程
8. 混合仓库（同时有 .pro 和 .sln/Makefile）：先分别 `compilot qt status` 和 `compilot sdk status` 查看；"运行"默认指 Qt（SDK 通常是库项目无 run）；"编译 SDK"或明确提到库/SDK 时用 `compilot sdk`

## Qt 命令参考

```bash
# 查看状态（含环境检测、项目列表）
compilot qt status --json --brief

# 初始化并保存本地配置
compilot qt init --json --brief

# 生成 Makefile
compilot qt qmake --json --brief

# 查看编译计划（不执行）
compilot qt build --plan --json --brief

# 执行编译
compilot qt build --json --brief

# 编译并运行（后台启动）
compilot qt run --detach --json --brief

# 查看运行日志
compilot qt logs --json

# 停止程序
compilot qt stop --json --brief

# 清理构建产物
compilot qt clean --json --brief

# 同步变更文件到远程
compilot qt sync --json --brief

# 编译 .qrc 资源文件
compilot qt rcc --json --brief

# 远程编译部署（完整流程）
compilot qt build --remote --json --brief

# 远程快速模式（跳过 preCheck、branchSync 和 baselineCheck）
compilot qt build --remote --fast --json --brief

# 远程从指定阶段开始
compilot qt build --remote --from build --json --brief

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
| `--target <name>` | QMake TARGET 覆盖 | qmake/build/run |
| `--plan` | 仅显示命令计划，不执行 | qmake/build/run/clean/sync |
| `--detach` | 后台执行，日志落文件 | build/run/clean |
| `--brief` | 精简 JSON 输出 | 所有 |
| `--json` | 结构化 JSON 输出 | 所有 |
| `--remote` | 远程模式（在编译机上执行） | build/run |
| `--fast` | 远程快速模式 | build/run（需 --remote） |
| `--from <stage>` | 从指定阶段开始 | build/run（需 --remote） |
| `--force` | 忽略基线不一致等警告 | build/run（需 --remote） |
| `--server <name>` | 指定服务器名称 | sync |
| `--save-local` | 将检测结果写入本地缓存 | status |

## SDK 命令参考

```bash
# 查看状态
compilot sdk status --json

# 执行编译
compilot sdk build --json --brief

# 查看编译计划（不执行）
compilot sdk build --plan --json

# 重新编译（clean + build）
compilot sdk rebuild --json --brief

# 清理
compilot sdk clean --json --brief

# 远程编译部署
compilot sdk build --remote --json --brief

# 远程快速模式
compilot sdk build --remote --fast --json --brief
```

### SDK 可选参数

| 参数 | 说明 | 适用命令 |
|------|------|----------|
| `--workspace <path>` | 工作区路径，默认当前目录 | 所有 |
| `--project <path>` | 项目入口文件（.sln 或 Makefile） | build/rebuild/clean |
| `--mode debug\|release` | 编译模式（默认 debug） | build/rebuild/clean |
| `--arch x86\|x64` | 目标架构（默认 x86） | build/rebuild/clean |
| `--plan` | 仅输出命令计划，不执行 | build/rebuild/clean |
| `--brief` | 精简输出 | 所有 |
| `--json` | JSON 格式输出 | 所有 |
| `--remote` | 远程模式 | build/rebuild/clean |
| `--fast` | 远程快速模式 | build（需 --remote） |
| `--from <stage>` | 从指定阶段开始 | build（需 --remote） |
| `--force` | 忽略基线不一致等警告 | build（需 --remote） |

## Remote 命令参考

```bash
# 测试远程连接（SSH + 路径 + compilot 版本）
compilot remote test --json

# 交互式配置远程编译环境
compilot remote setup
```

## 执行规则

- **不要拆解命令**：`compilot qt run` 会先杀旧进程、编译、再启动，不要自己拆步骤
- **不要猜路径**：不要自己拼 qmake/jom/msbuild 命令，统一用 compilot
- **只有 run 加 --detach**：程序启动后不会自行退出，不加会阻塞
- **build/clean/qmake 不加 --detach**：前台执行完直接返回 `errors`、`exitCode`、`logFile`
- **detach 后看 logs**：`run --detach` 返回 `ok: true` 只表示程序已启动；看 `compilot qt logs --json` 确认运行状态
- **非 detach 直接看结果**：`ok` 字段直接反映成功/失败，`errors` 字段包含错误行
- **执行前确认目标**：看 `target`、`project`、`candidates`、`diagnostics`
- **需要完整日志时**：读 `logFile` 路径指向的文件
- **远程模式**：`--remote` 触发完整流程（sync → build → transfer → launch），不需要手动拆步骤

## JSON 输出关键字段

```jsonc
{
  "ok": true,            // 是否成功
  "action": "build",     // 当前动作
  "target": "MyApp",    // 项目名
  "project": "app.pro", // 项目文件（相对路径）
  "exitCode": 0,        // 进程退出码
  "errors": [...],      // 编译错误行
  "diagnostics": [...], // 诊断信息
  "logFile": "..."      // 日志文件路径
}
```

## 错误处理

- `ok: false` 时看 `errors` 和 `diagnostics` 字段
- 环境未配置时先看 `status` 的 `diagnostics` / `nextActions`，需要保存配置时再 `compilot qt init`
- 多个项目文件时用 `status --json` 看 `candidates`，再加 `--project` 指定
- 远程连接失败时用 `compilot remote test --json` 诊断
