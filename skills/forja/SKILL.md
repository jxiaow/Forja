---
name: forja
description: Operate C++ workspaces through the Forja CLI, including initialization, target and toolchain selection, build, run, clean, remote server management, and file synchronization. Use whenever the user mentions Forja or forja, or asks Codex to perform these actions for Qt qmake (.pro), Visual Studio (.sln), Makefile, or CMake projects, including uninitialized workspaces.
---

# Forja CLI

使用已安装的 `forja` 可执行文件，命令形式为 `forja <command>`。

## 按需读取

- 执行 `init`、选择或切换目标，或 JSON 返回 `questions`、`choices`、`savedTargets`、
  `targetGroups` 时，先完整读取 [交互与目标选择](references/interactive-selection.md)。
- 执行 `server`、`remote` 或 `sync` 前，先完整读取
  [远程与同步](references/remote-operations.md)。

## 核心契约

- agent 调用 Forja 时追加 `--json`。继续前读取 `ok`、`diagnostics`、`nextAction`、
  `nextActions`、`activeTarget` 及命令专属结果字段。
- `ok: false` 始终表示失败，即使响应包含计划或部分诊断。优先遵循可执行的
  `nextAction(s)`；信息不足时重新执行 `forja status --json`。
- 构建、运行、清理、选择目标或同步前先执行 `forja status --json`，不要猜测项目路径、
  mode、arch 或工具链。
- `forja build` 不传 `--jobs` 时自动使用全局配置中的并行数（通过 `forja use --jobs <N>`
  设置）。如果用户经常需要指定 `--jobs`，建议其执行一次 `forja use --jobs <N> --json`
  持久化。
- 多个项目、工具链或服务器存在歧义时让用户选择，不要静默选择第一个结果。
- 不要主动加 `--workspace`，项目已初始化时直接操作当前目录；仅用户明确要求时传
  `--workspace <path>`。仅需稳定诊断语言时传 `--lang zh|en`。
- Forja 已覆盖的操作不要自行拼接 qmake、make、MSBuild、SSH 或 SCP 命令。

## 执行规则

- 用户要求预览或目标工作区尚不熟悉时，对 build、普通 Qt run、clean 使用
  `--plan --json`。
- `build` 默认前台执行，并且 Forja build 没有 `--detach` 参数。用户明确要求后台构建时，
  只能使用当前执行器明确支持的后台能力；不得拼出 `forja build --detach`，也不得在前台
  超时后重新发起第二次构建。只有执行器能接管同一仍在运行的进程时才接管并回显任务 ID。
- 启动当前 Qt 目标（普通 `forja run`）时，默认执行 `forja run --detach --json`；仅用户
  明确要求前台运行时使用 `forja run --json`。`run custom` 和 `run designer` 不追加
  `--detach`。
- `run --detach` 成功后执行 `forja status --json`，从 `runtime` 读取运行状态和
  `logFile`。
- `.pro` 是 Qt/qmake 目标；`build qmake`、`build rcc` 和普通 `run` 仅用于此类目标。
  `.sln`、Makefile 和 CMake 是 C++ 目标，只使用 `build` 或 `build fresh`。
- Qt 目标的 `build` 和 `run` 都会自动检查 RCC 资源是否过期，若过期则在构建后自动编译
  rcc（无需手动 `build rcc`）。RCC 项目路径在 `init` 或 `use target` 时配置。
- 构建失败并报告编译错误时，**禁止**自行修改代码修复。必须先分析错误原因并提出
  修复方案，等用户确认后才能执行修改。

## 标准流程

```text
status → init（缺少工作根目录时）→ list（选择有歧义时）
       → use target → status → 预览或执行 → 检查 JSON 结果
```

```bash
forja status --json
forja init --json
forja list targets --json
forja use target --project path/to/app.pro --json
forja status --json
forja build --plan --json
forja build --json
forja run --detach --json
forja stop --json
```

## 命令速查

| 需求 | 命令 |
| --- | --- |
| 查看目标、就绪状态和下一步 | `forja status --json` |
| 初始化工作根目录 | `forja init [--workroot <path>] [--answers <file>] --json` |
| 列出目标或环境 | `forja list targets [--all] --json` / `forja list env --json` |
| 保存目标和工具链 | `forja use target --project <path-or-id> [--answers <file>] [--rcc-project-path <path>] --json` |
| 单独设置 RCC 路径 | `forja use target --rcc-project-path <path> --json` |
| 设置全局并行编译数 | `forja use --jobs <n> --json` |
| 构建当前目标 | `forja build [fresh\|qmake\|rcc] [--plan] [--jobs <n>] [--build-args <args>] --json` |
| 后台运行当前 Qt 目标 | `forja run --detach [--plan] --json` |
| 调试运行当前 Qt 目标 | `forja run --debug --json` |
| 运行自定义命令 | `forja run custom <name> --json` |
| 打开 Qt Designer | `forja run designer <ui-file> --json` |
| 停止当前运行目标 | `forja stop --json` |
| 清理当前目标 | `forja clean [--plan] --json` |
| 配置远程环境 | `forja remote setup --server <name> --remote-path <path> --json` |
| 部署远端 CLI | `forja remote bootstrap [--force] --json` |
| 管理服务器 | `forja server ...` |
| 同步文件 | `forja sync [--dry-run] [--yes] [--file <path>] --json` |
| 管理同步忽略规则 | `forja sync ignore [add\|rm] <pattern> [--add\|--rm] --json` |
