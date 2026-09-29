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
- **不要每次都跑 `forja status`。** 仅在以下情况调用：会话中首次操作且无目标信息、
  用户切换了 target、或命令返回意外错误需要重新确认状态。`stop`、`use target`、`build`、`run`
  的 JSON 结果已包含 `activeTarget` 和本次命令的结果字段，可直接用于后续调用，不要再补一次
  `status`。
- `forja build` 不传 `--jobs` 时使用全局配置的并行数。`globalJobs` 只在会话内**首次** build 前
  顺带确认一次：未设置时提醒用户默认占满全部核心，建议 `forja use --jobs <N> --json` 设置持久值；
  不要为这一项单独反复调用 `status`。
- 多个项目、工具链或服务器存在歧义时让用户选择，不要静默选择第一个结果。
  只有一个候选时直接选定，不要求用户确认（`workroot` 除外）。
- 不要主动加 `--workspace`，项目已初始化时直接操作当前目录；仅用户明确要求时传
  `--workspace <path>`。仅需稳定诊断语言时传 `--lang zh|en`。
- Forja 已覆盖的操作不要自行拼接 qmake、make、MSBuild、SSH 或 SCP 命令。
- Qt 项目的可执行文件名由 `.pro` 文件的 TARGET 决定。如需自定义，使用
  `forja use target --executable-name <name>` 在构建后重命名，不要修改 `.pro` 文件。

## 执行规则

- 用户要求预览或目标工作区尚不熟悉时，对 build、普通 Qt run、clean 使用
  `--plan --json`。
- **`build` 必须用后台执行**：`forja build` 可能耗时数分钟，前台调用会超时。使用 `is_background: true`
  启动，等待完成通知，**构建期间不要轮询状态文件或输出文件**。完成通知只带退出码和输出文件路径，
  构建的 `ok`、`exitCode`、`diagnostics` 只存在于该输出文件中：收到通知后**读一次**输出文件，
  一次读够，不要拆成多次 tail/grep。`forja status --json` 不返回构建结果，不能用它替代这次读取。
  **禁止**前台等待。**禁止** `forja build --detach`。不得在超时后重新发起第二次构建。
- 目标正在运行时不要直接重新 `build`：Windows 下 exe 被占用会导致链接失败。先 `forja stop --json`
  （其 JSON 已含 `state` 和 `nextAction`，不必再查 `status`），再 build。
- 启动当前 Qt 目标（普通 `forja run`）时，默认执行 `forja run --detach --json`；仅用户
  明确要求前台运行时使用 `forja run --json`。`run custom` 和 `run designer` 不追加
  `--detach`。
- `run --detach` 的 JSON 已含 `runtime.running`、`pid`、`executablePath`、`logFile`，**不要再补
  `forja status`**。`running: true` 只表示刚 spawn 成功，不证明进程持续存活；确需判活时只观测一次
  （`forja status --json` 或按 pid 查进程），禁止 sleep 轮询。`logFile` 只是路径，默认不读；
  仅在用户报崩溃、卡死或异常时读取。
- `.pro` 是 Qt/qmake 目标；`build qmake`、`build rcc` 和普通 `run` 仅用于此类目标。
  `.sln`、Makefile 和 CMake 是 C++ 目标，只使用 `build` 或 `build fresh`。
- Qt 目标的 `build` 和 `run` 都会自动检查 RCC 资源是否过期，若过期则在构建后自动编译
  rcc（无需手动 `build rcc`）。RCC 项目路径在 `init` 或 `use target` 时配置。
- 构建失败并报告编译错误时，默认**禁止**自行修改代码修复：必须先分析错误原因并提出
  修复方案，等用户确认后才能执行修改。例外：用户已就某类错误给出长期授权（如"缺 include 类
  可批量自修、逐轮重编"）时，在授权覆盖的类别内直接修并重编；逻辑、接口或行为类错误
  仍须先给根因方案等确认。

## 改 forja 自身时（源码仓库内）

改的是 forja 源码本身时，本 Skill 文档属于交付物，不能只改 `src/`：

1. 先跑 `npm test`（会先 `npm run compile` 再 `node --test out/test`），用失败项定位是哪个契约
   没接上——缺参数、默认值、互斥关系、规划文案、帮助文本都算。要按命令面手工走一遍时看
   `docs/self-testing-guide.md`。
2. `src/test/cliEntrySource.test.ts` 直接对本文件断言（命令是否存在、`## 命令速查` 等章节、
   禁止出现的旧命令）。`src/` 改了这个命令，就必须同步改这里，否则测试会红。
3. 同步三处文档，口径一致：本文件的「命令速查」、`docs/README-cli.md`、
   `docs/cli-interface-spec.md`；命令、参数、默认值、输出字段变了就必须改，不按"大致一致"处理。
4. 用 `forja <cmd> --help` 与速查表逐行对账：每个宣传的参数都真实存在，每个不存在的参数
   不被宣传（例如 RCC 路径是 `--rcc`，不存在 `--rcc-project-path`；抑制警告是
   `forja use target suppress-warnings --add|--rm`，不是 `--suppress-warnings`）。互斥项要写清两侧。
5. 权威副本是本仓库的 `skills/forja/`，打包时由 `scripts/build-cli.js` 复制到
   `dist/forja-<version>/cli/skills/forja/`；各客户端安装目录（如
   `~/.qoder-cn/skills/forja/`）只是下游副本。让副本与本文件逐字一致，记录同步日期；
   不做双向同步，不用旧副本反向覆盖权威副本。
6. `src/` 已改而文档未同步，视为未完成。

## 标准流程

```text
status（会话首次，确认 target）→ init（缺少工作根目录时）→ list（选择有歧义时）
       → use target → 预览或执行 → 检查该命令自己的 JSON 结果
```

```bash
forja status --json          # 仅会话首次、切 target 或意外错误后
forja init --json
forja list targets --json
forja use target --project path/to/app.pro --json
forja build --plan --json
forja stop --json            # 目标在运行时，重新 build 前先停
forja build --json           # 后台执行；完成通知后读一次输出文件
forja run --detach --json    # JSON 已含 pid/logFile，不再查 status
```

## 命令速查

| 需求 | 命令 |
| --- | --- |
| 查看目标、就绪状态和下一步 | `forja status --json` |
| 初始化工作根目录 | `forja init [--workroot <path>] [--answers <file>] --json` |
| 列出目标或环境 | `forja list targets [--all] --json` / `forja list env --json` |
| 保存目标和工具链 | `forja use target --project <path-or-id> [--answers <file>] [--rcc <path>] [--executable-name <name>] [--build-script <path>] --json` |
| 单独设置 RCC 路径 | `forja use --rcc <path> --json` |
| 设置可执行文件名 | `forja use target --executable-name <name> --json`（构建后重命名，不修改 .pro） |
| 设置自定义构建脚本 | `forja use target --build-script <path> --json`（.sh/.bat，仅 C++ 目标） |
| 删除已保存目标 | `forja use target remove [<id>] [--force] --json`（交互模式选择目标并确认） |
| 管理 qmake 参数 | `forja use target qmake-args [--add <args> \| --rm <args>] --json`（持久化，自动去重） |
| 管理抑制警告 | `forja use target suppress-warnings [--add <codes> \| --rm <codes>] --json` |
| 设置全局并行编译数 | `forja use --jobs <n> --json` |
| 构建当前目标 | `forja build [fresh\|qmake\|rcc] [--plan] [--jobs <n>] --json` |
| 后台运行当前 Qt 目标 | `forja run --detach [--plan] --json` |
| 调试运行当前 Qt 目标 | `forja run --debug --json` |
| 运行自定义命令 | `forja run custom <name> --json` |
| 打开 Qt Designer | `forja run designer <ui-file> --json` |
| 停止当前运行目标 | `forja stop --json` |
| 清理当前目标 | `forja clean [--plan] --json` |
| 配置远程环境 | `forja remote setup --server <name> --remote-path <path> --json` |
| 部署远端 CLI | `forja remote bootstrap [--force] --json` |
| 管理服务器 | `forja server ...` |
| 同步文件 | `forja sync [--yes] [--file <path>] --json` |
| 预览同步（不执行） | `forja sync --dry-run --json` |
| 管理同步忽略规则 | `forja sync ignore [add\|rm] <pattern> [--add\|--rm] --json` |
