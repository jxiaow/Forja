---
name: forja
description: Build, run, clean, diagnose, configure, or remotely sync C++ projects through the Forja CLI. Use when a workspace contains Qt qmake (.pro), C++ (.sln, Makefile, or CMake) targets and the user asks to compile, run, select a target or toolchain, inspect build readiness, manage remote servers, or synchronize changed files.
---

# Forja CLI

使用已安装的 `forja` 可执行文件，命令形式为 `forja <command>`。

## 操作规则

- 由 agent 调用时追加 `--json`。继续执行前读取 `ok`、`diagnostics`、
  `nextAction`、`nextActions`、`activeTarget` 及该命令的结果字段。
- `questions` 或 `choices` 是阻塞式输入，不是推荐项：一旦返回它们，立即停止
  命令链并向用户展示需要选择的字段。未得到用户明确答案前，不得继续执行、创建
  `answers.json`、传入 `--answers`，也不得从候选列表、机器检测结果、历史会话或
  示例命令中推断任何值。
- `nextAction` 中的 `<answers.json>` 只是占位符，绝不得创建或复用字面量 `answers.json`。
  - 项目已确定时，使用系统临时目录下 `forja-answers/<SHA-256(规范化项目绝对路径)>.json` 作为该目标唯一的 answers 文件；仅累积当前目标流程中用户已确认的字段，绝不读取、合并或复用其他目标的文件。
  - 项目尚未确定时，才使用 `forja-answers/init-<SHA-256(规范化工作根目录或当前目录)>.json` 作为初始化暂存文件；项目确定后，将本轮已确认答案迁移至该目标文件。
  - 命令成功完成或流程取消后删除相应临时文件。
- 展示 `questions` 前，先判断每个问题的类型并选择展示方式：
  - **输入型**（无 `choices` 数组）：有 `default` 时，`default` 只是候选值而非用户确认值；必须使用提问工具展示该候选值和“自定义”占位选项。无 `default` 时用普通文本索取实际值。
  - **选择型**（有 `choices` 数组）：按 `choices` 数量决定展示方式：1 个 choice 时注入仅用于提问工具适配的“自定义”占位选项；2–4 个 choices 时直接使用提问工具；超过 4 个 choices 时降级为普通文本完整展示。
  - **混合阶段**（同时有输入型和选择型）：有 `default` 的输入型与选择型在同一次提问工具调用中展示；无 `default` 的输入型作为同一阶段的文本附注。不得把有 `default` 的输入型降级为文本附注。
  - 用户选择或输入实际值后，才将实际值写入原问题 `id`。用户选择注入的“自定义”占位项时，不得将占位值写入 `answers.json`；仅针对该原问题用普通文本补录实际值，补录后不得再次调用提问工具。
- 展示 `questions` 时，必须原样映射 CLI 返回的每一个问题：
  - 不得拆分、分页或截断 `choices` 数组；选项过多时仍在一个问题中展示全部。
  - 不得新增 CLI 未返回的问题字段或实质性选项（如“更多分组”“其他项目”等）。例外仅有两种：有 `default` 的输入型问题可增加“自定义”占位选项；选择型问题只有 1 个 choice 时可增加“自定义”占位选项，以适配提问工具的最低选项数要求。用户选择任一占位项时按文本输入处理。
  - 不得将展示用的分页问题当作答案字段收集。
  - 允许按语义阶段展示问题，但不得按选项数量分页或截断。固定阶段为：
    0. `workroot`（若 CLI 返回）；① `choicesBy` 的父问题（如 `projectGroup`）；
    ② 父问题确定后对应的子问题（如 `project`）；③ 项目确定后的构建字段
    （`mode`、Windows 下的 `arch`）；④ CLI 返回的工具链字段。Qt、VS、jom 不是
    固定必问项，不得自定义
    “分组2”“更多选项”等问题。
  - 每个阶段都必须先输出可见标题，再展示问题或调用提问工具；不得只给第一阶段标题，
    后续阶段孤零零展示选项。标题固定使用以下语义：
    `Forja 初始化 — ⓪ 工作根目录`、`Forja 初始化 — ① 选择项目分组`、
    `Forja 初始化 — ② 选择项目`、`Forja 初始化 — ③ 选择构建参数`、
    `Forja 初始化 — ④ 选择工具链`。目标切换的项目选择使用
    `Forja 目标选择 — ⓪ 选择目标`；其返回的构建参数和工具链问题分别使用
    `Forja 目标配置 — ① 选择构建参数`、`Forja 目标配置 — ② 选择工具链`。标题是展示文本，
    不是 CLI 问题或答案字段。
  - 每次收到一批问题答案后，先完成该批中“自定义”的实际值补录，再按原问题 `label` 回显每个实际已选值，随后才展示下一阶段或继续执行 CLI。提问工具与普通文本降级流程同样适用。回显仅用于展示，不得新增字段或改变 `answers.json`。
  - 每个阶段必须完整展示该阶段已有的 CLI 问题；不得因提问工具限制拆成多个调用。
    混合阶段按前述输入型/选择型策略分别收集；工具无法无损承载选择型问题时，
    用一条普通文本展示该阶段的全部问题，保留原始 `id`、`label` 和完整 `choices`。
  - 每进入一个新阶段都必须重新评估展示方式；上一阶段的文本锁定只作用于上一阶段，
    不得传递到后续阶段。若当前阶段的每个选择型问题都有 2–4 个 CLI 选项，且一次调用能
    保留全部原始问题和选项，必须优先使用提问工具，不得无理由改用普通文本。
  - 一旦某阶段因 choices 超过 4 个、工具报错或无法保留原始结构而降级为普通文本，该阶段即锁定为文本模式，
    直到该阶段答案收齐；不得重试工具、拆分选项、只展示部分选项或混合
    使用工具收集剩余答案。
  - 普通文本展示完整 `choices` 后，不得新增任何 CLI 未返回的占位项或编号；用户可以
    直接回复原始选项值或实际输入值，但这不是新增 choice。
  - `choicesBy` 表示依赖关系：必须先解决父问题，再根据用户选择完整展示对应子问题；
    不得跳过、提前展示或凭空改写子问题。
  - 若 `choicesBy` 针对已选父值解析为空数组，该字段对当前项目不适用：不要展示、
    不要索取答案，也不要写入 `answers.json`；这不是遗漏 CLI 问题。
  - 工具链字段严格按 CLI 返回的 `questions` 展示：C++/`.sln`/CMake 目标通常只处理
    `vsInstall`；只有 CLI 返回 `qtPath` 时才询问 Qt，只有 CLI 返回 `jomPath` 时才询问
    jom。不得因检测到机器上存在 Qt、VS 或 jom 就新增问题，也不得把未返回的字段写入
    `answers.json`。
  - 阶段之间保留已获答案；已获答案的问题不得再次询问。阶段只是展示顺序，不得
    作为额外字段；CLI 返回的 `workroot` 答案应原样放入 `answers.json`，由 Forja
    用它解析后续扫描根目录。
  - 若展示数量，必须等于 CLI `choices` 的实际长度；不确定时不要声明数量，也不得
    使用“主要项目”“前 N 项”代替完整列表。
  - 只有当所有 CLI 返回的问题都获得用户明确答案后，才允许生成
    `answers.json` 或继续执行命令。
- 构建、运行、清理、选择目标或同步前，先执行 `forja status --json`。
  优先遵循输出中的下一步命令，不猜测项目路径或工具链。
- 新工作根目录或未注册目录使用 `forja init --json`。若 JSON 返回需要输入的
  问题，不要擅自选择有歧义的项目或工具链。
- 选择或切换目标时，先执行 `forja list targets --json`。若默认结果只有一个目标，
  再执行 `forja list targets --all --json` 展开全部候选；若默认结果有多个目标，先
  展示这些目标并询问用户；只有用户明确表示没有满意项时，才执行 `--all`。环境候选
  另行使用 `forja list env --json`，不得用 `init` 代替目标列表。默认列表的目标选项
  固定追加一个展示控制项 `未找到，查看全部`：总数为 2–4 时可用提问工具，超过 4 项时
  必须用一条普通文本完整展示，禁止拆分、分页或截断。选择该控制项只触发
  `forja list targets --all --json`，不得把它写入 `answers.json` 或作为 `--project`
  参数；已执行 `--all` 时绝不追加该控制项。
- `list targets` 返回 `savedTargets` 时，用户选择已保存目标后，优先使用其 `id` 执行
  `forja use target --project <target-id> --json`，只切换 `activeTarget`，不得重新询问
  mode、arch 或工具链；其精确项目路径也只切换 `activeTarget`，新增或未保存的项目路径
  才进入配置流程。
- `list targets --all --json` 返回 `targetGroups` 时，必须按 init 的方式两级展示：先以
  `Forja 目标选择 — ① 选择项目分组` 展示全部分组，用户选定分组后，再以
  `Forja 目标选择 — ② 选择项目` 完整展示该组的目标；不得将不同分组的目标平铺为
  编号或单一列表。这里的分组选择只是展示流程，不是 CLI `questions`，也不得写入
  `answers.json`。
- 通过 `forja use target` 保存目标与工具链选择；执行类命令使用已保存的当前
  目标。仅 `forja build --project <path>` 可以直接指定项目。
- `mode` 只能来自用户明确选择或已有目标配置。不得根据项目类型、构建任务或惯例
  擅自选择 `debug` 或 `release`。
- Windows 的 `arch` 只能来自用户明确选择或已有目标配置；缺失时不要传
  `--arch`，应消费 Forja 返回的 `x86` / `x64` 问题。Linux 当前只有 `x64`，
  不询问用户，也不要传 `--arch`，由 Forja 使用平台唯一值。
- 项目已选但其他字段仍有歧义时，只传已确认字段并消费返回的 `questions`；
  用 `--answers <answers.json>` 继续，不要为了减少交互而补齐 mode、arch 或工具链。
- `use target` 的续接必须保留原始 `--project <path>`（或完整复制 Forja 返回的
  `nextAction`）；`answers.json` 只填写返回问题的字段，不要用 `target` 字段代替
  `--project`，也不要单独执行 `forja use target --answers ...`。
- 同一个字段只提供一次：已放入 `answers.json` 的 mode、arch、Qt 或 VS 不要再
  同时重复传命令行参数，避免答案来源冲突。
- 选择新项目时，不能把其他项目的 Qt、VS、mode 或 arch 配置当作新项目的用户确认；
  只有用户明确要求复用，或 Forja 返回的活动目标就是同一项目，才可沿用已有配置。
- 已初始化工作区切换目标时，禁止使用 `forja init`。`forja use target --json` 不带
  `--project` 只查看当前目标，不会启动选择流程；已保存目标使用其 `id`，新增目标才使用
  完整项目路径执行 `forja use target --project <值> --json`，并消费其返回的后续问题。
- 用户要求预览，或目标工作区尚不熟悉时，对 build、run、clean
  使用 `--plan --json`。
- `build` 默认前台执行。前台达到执行器时限时，只有执行器确认能将**同一仍在运行的
  进程**接管到后台，才自动接管并回显任务 ID；不能接管时只报告超时和进程状态，绝不
  重新发起后台构建。用户明确要求后台时可直接后台执行。
- `run` 默认前台执行；仅用户明确要求后台时传 `--detach`。不得因项目规模或运行时长
  推断后台模式。
- Forja 已覆盖的操作，不要自行拼接 qmake、make、MSBuild、SSH 或 SCP 命令。

## 标准流程

```text
status → init（缺少工作根目录时）→ list（选择有歧义时）
       → use target → status → 预览或执行 → 检查 JSON 结果
```

```bash
# 查看并配置工作区
forja status --json
forja init --json
forja list targets --json
forja list env --json
forja use target --project path/to/app.pro --json
forja status --json

# 构建并运行已选择的目标
forja build --plan --json
forja build --json
forja run --detach --json
forja stop --json
```

多个项目、工具链或远程服务器同时可用，且既有配置不能消除歧义时，列出候选项并让
用户选择；不得静默选择第一个结果。

## 命令速查

| 需求 | 命令 |
| --- | --- |
| 查看当前目标、就绪状态和建议下一步 | `forja status --json` |
| 注册并初始化工作根目录 | `forja init [--workroot <path>] --json` |
| 列出 Qt/C++ 目标或检测到的环境 | `forja list targets\|env --json` |
| 保存目标、模式、架构或工具链 | `forja use target [--project <path>] [--answers <file>] [--mode debug\|release] [--arch x86\|x64] [--qt <path>] [--vs <path>] [--jom <path>] --json` |
| 构建当前目标 | `forja build [fresh\|qmake\|rcc] [--plan] --json` |
| 运行 Qt 目标 | `forja run [--detach] [--plan] --json` |
| 运行保存的自定义命令 | `forja run custom <name> --json` |
| 打开 Qt Designer 文件 | `forja run designer <ui-file> --json` |
| 停止当前运行目标 | `forja stop --json` |
| 清理当前目标的构建产物 | `forja clean [--plan] --json` |
| 管理远程服务器记录 | `forja server [add\|update\|remove] ... --json` |
| 初始化当前 workroot 的远程同步 | `forja remote setup [--server <id> --remote-path <path>] --json` |
| 预览待同步文件 | `forja sync --dry-run --json` |

需要在当前目录以外操作时传入 `--workspace <path>`。仅在需要稳定的诊断语言时传入
`--lang zh` 或 `--lang en`。

## 目标行为

- `.pro` 是 Qt/qmake 目标；`build qmake`、`build rcc` 和 `run` 仅适用于此类目标。
- `.sln`、`Makefile` 与 CMake 是 C++ SDK 目标。对此类目标使用 `build` 或
  `build fresh`；不要改用 Qt 专属动作。
- `run --detach` 会启动后台进程。成功后执行 `forja status --json`，从 `runtime`
  中读取运行状态和 `logFile`。
- 即使输出包含计划或部分诊断，`ok: false` 仍表示操作失败。优先使用返回的
  `nextAction(s)`；没有足够修复提示时重新执行 `forja status --json` 查看就绪状态。

## 远程与破坏性操作

- 同步前执行 `forja sync status --json`；未配置时使用 `forja remote setup`，它会绑定当前
  workroot 的服务器和远端路径、启用同步并部署远端 Forja。
- 同步前使用 `forja sync --dry-run --json` 展示上传、删除和跳过的文件。
  `forja sync --json` 会跳过交互确认并直接执行；仅在用户已授权目标服务器与文件范围后
  执行。
- `sync reset`、`server remove` 都会改变状态或具有破坏性。支持 `--plan`
  时先预览；其余情况先说明精确目标并取得用户明确授权。JSON 模式下的 `sync reset` 和
  `server remove` 还需要显式传入 `--force`。
- 不要输出服务器密码、私钥内容或其他凭据；仅把用户提供的凭据引用传给 Forja。
