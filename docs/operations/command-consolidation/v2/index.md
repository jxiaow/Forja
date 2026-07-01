# Forja 命令收敛迁移方案 v2

> 目标：将 ~107 个分散的 Qt/SDK/Remote/Sync 命令收敛为 11 个意图驱动的顶层命令。旧能力必须全部有新命令归宿，不再依赖旧用户命令兼容层作为产品设计的一部分。

**命令规格（各文件）**：
[status](status.md) · [init](init.md) · [list](list.md) · [use](use.md) · [server](server.md) · [build](build.md) · [run](run.md) · [stop](stop.md) · [clean](clean.md) · [doctor](doctor.md) · [sync](sync.md)

## 0. 目录对比与 v2 落盘状态

旧目录资料分工：

| 文件 | 作用 | v2 使用方式 |
|------|------|-------------|
| `command-inventory.md` | 全量盘点现有 CLI/VSCode 命令，约 107 个输入面 | 作为旧命令覆盖基准 |
| `current-command-consolidation.md` | 定义命令收敛目标、旧→新映射、阶段计划 | 拆分为 v2 总览 + 11 个命令规格页 |
| `command-api.zh.md` | API/输出协议补充 | 合并到 v2 的 Result、Diagnostic、Readiness 结构 |
| `command-consolidation*.html` | 展示产物 | 不作为源文档修改 |
| `v2-en/`、`v2-zh/` | 由 v2 Markdown 生成的 HTML 产物 | 修改 Markdown 后再生成 |

v2 下每个公开命令都必须独立落盘，包含：职责边界、语法、旧命令归宿、VSCode 映射、JSON Result、诊断码、正常/异常场景、文本输出、验证点。

| v2 命令页 | 覆盖旧命令范围 | 落盘状态 |
|-----------|----------------|----------|
| [status](status.md) | `qt/sdk/remote/sync status`、`qt ps`、`remote qt ps` | 已落盘 |
| [init](init.md) | `qt init`、`sdk init`、`remote qt/sdk init` | 已落盘 |
| [list](list.md) | `qt/sdk projects`、`qt/sdk env`、server/remote 配置枚举 | 已落盘 |
| [use](use.md) | `qt/sdk use`、`sync use`、remote execution/workspace/bin 选择 | 已落盘 |
| [server](server.md) | 共享 server add/update/remove | 已落盘 |
| [build](build.md) | Qt/SDK/Remote build、rebuild、qmake、rcc | 已落盘 |
| [run](run.md) | Qt local/remote run、detach、debug、custom | 已落盘 |
| [stop](stop.md) | Qt local/remote stop | 已落盘 |
| [clean](clean.md) | Qt/SDK/Remote clean | 已落盘 |
| [doctor](doctor.md) | test/doctor/bootstrap/unlock/cleanup/隐藏恢复动作 | 已落盘 |
| [sync](sync.md) | sync run/plan/reset 与旧 sync 配置入口归并 | 已落盘 |

---

## 1. 最终用户命令集

```
forja status      — 当前状态和下一步建议
forja setup       — 一站式初始化（本地 + 远程）
forja list        — 列举可选项和配置摘要（targets/servers/remote-repos/env/remote/config/lang）
forja use         — 选择目标、构建配置、执行端和高级配置
forja server      — 管理共享 SSH server
forja build       — 构建当前目标
forja run         — 运行当前目标
forja stop        — 停止当前运行目标
forja clean       — 清理构建产物
forja doctor      — 深度诊断和恢复
forja sync        — 同步变更文件到远程
```

不引入 `forja remote`、`forja qt`、`forja sdk` 作为用户命令。它们的能力由下面 11 个顶层命令及其子动作承接。

---

## 2. 核心概念

### 2.1 ActiveTarget

所有执行类命令围绕当前 active target 工作。active target 可以是 Qt，也可以是 SDK；由 `project` 类型写入 `kind`。

```ts
interface ActiveTarget {
    kind: 'qt' | 'sdk';
    project: string;       // workspace 相对路径
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    runAt: 'local' | 'remote';
}
```

规则：
- `activeTarget` 同一时间只有一个，`kind` 是它的类型，不是用户需要单独选择的命名空间。
- `forja use target --project <path>` 根据项目类型写入 `kind`：`.pro` → `qt`，`.sln`/`Makefile` → `sdk`。
- 同一 workspace 同时存在 Qt 和 SDK 候选时也不需要额外类型参数，因为 `project` 已经决定 target 类型。
- 只有当 `project` 无法识别类型时才报错，不引入按类型切换的兜底入口。
- `project` 优先使用 workspace 相对路径。
- `runAt` 独立于 `kind`：Qt 和 SDK 都支持 local/remote。
- `activeTarget` 不是 Qt/SDK 配置正本，只是当前目标指针和当前执行快照。
- `mode`/`arch` 的正本存放在当前 target 所属的 Qt 或 SDK 配置中；`activeTarget` 中的值用于统一输出和执行路由。
- `forja use target --mode ... --arch ...` 更新当前 active target 所属的配置域，并刷新 activeTarget 快照。
- 切换 target 时从目标所属配置域恢复 mode/arch 默认值，不清理另一类配置。
- 缺失 active target 时，`build`/`run`/`stop`/`clean` 返回失败并指向 `forja list` + `forja use target --project <path>`。

#### 配置存储

配置根目录：`FORJA_CONFIG_DIR` 或 `~/.forja`。

全局配置：
- `~/.forja/servers.json`：共享 server 列表；server 不归 remote 或 sync 专属，二者只保存自己的 server 引用和 remote path。

workspace 配置：
- `~/.forja/projects/<hash(workspace:qt)>.json`，`type: "qt"`：Qt 工具链和 Qt 专属配置，例如 `qtPath`、`jomPath`、`vsInstall`、QMake TARGET 覆盖、`qmakeArgs`、Qt 自定义命令、Qt 默认 `mode/arch`。
- `~/.forja/projects/<hash(workspace:sdk)>.json`，`type: "sdk"`：SDK 工具链和 SDK 专属配置，例如 `vsInstall`、SDK 项目选择、扫描深度、SDK 默认 `mode/arch`。
- `~/.forja/projects/<hash(workspace:sync)>.json`，`type: "sync"`：sync 开关、server 选择、remote path、ignore。
- `~/.forja/projects/<hash(workspace:remote)>.json`，`type: "remote"`：remote workspace、remote repo、remote Forja bin、build-order、transfer。
- `~/.forja/projects/<hash(workspace:activeTarget)>.json`，`type: "activeTarget"`：当前 active target 指针和执行快照。

规则：
- 每个配置域独立文件，互不覆盖。
- `forja use target --project <path>` 只更新 activeTarget，并更新该项目所属配置域的最近选择；不会删除另一类配置。
- `forja use qt ...` 只写 Qt 配置文件；`forja use sdk ...` 只写 SDK 配置文件。
- 不在 workspace 内创建 `.forja` 配置目录。

### 2.2 Candidate

```ts
interface TargetCandidate {
    kind: 'qt' | 'sdk';
    project: string;
    label: string;
    current: boolean;      // 是否为 active target
    configured: boolean;
    diagnostics: Diagnostic[];
}
```

### 2.3 Diagnostic

```ts
interface Diagnostic {
    code: string;                        // 稳定机器码，格式: <domain>.<condition>
    level: 'info' | 'warning' | 'error';
    message: string;                     // 人读文本，跟随 locale
    hint?: string;                       // 人读提示，跟随 locale
    params?: Record<string, string>;     // 模板变量，供 message/hint 插值
}
```

`code` 不随语言变化，AI/脚本用 `code` 判断，不依赖 `message` 文本。

诊断码命名规则：`<domain>.<condition>`，domain 包括 `workspace`、`target`、`toolchain`、`remote`、`sync`、`build`、`run`、`stop`、`clean`、`doctor`。

### 2.4 JSON Envelope

```ts
interface ForjaJsonResult {
    ok: boolean;
    action: string;
    workspace?: string;
    activeTarget?: ActiveTarget;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}
```

规则：
- `ok` 和 `action` 必须始终存在。
- `nextAction` 只输出新命令。
- 文本输出和 JSON 都不推荐旧用户命令。
- 退出码：成功 `0`，失败 `1`，用户取消 `0`。
- `activeTarget` 只表示当前执行目标；已保存配置不放进通用 envelope。
- 查看 Qt/SDK/Sync/Remote 的已保存配置摘要使用 `forja list config --json`。

```ts
interface ConfigSummary {
    qt?: { configured: boolean; project?: string; mode?: string; arch?: string; qtPath?: string; vsInstall?: string; qmakeTarget?: string };
    sdk?: { configured: boolean; project?: string; mode?: string; arch?: string; vsInstall?: string };
    sync?: { configured: boolean; enabled?: boolean; selectedServer?: string; remotePath?: string };
    remote?: RemoteConfigSummary;
}
```

### 2.5 Readiness

```ts
type ReadinessState = 'ready' | 'configured' | 'blocked' | 'missing' | 'unknown' | 'not-selected';

interface Readiness {
    target?: ReadinessState;
    toolchain?: ReadinessState;
    sync?: ReadinessState;
    remote?: ReadinessState;
    runtime?: ReadinessState;
    transfer?: ReadinessState;
}
```

语义：`ready` = 已验证可用；`configured` = 配置存在但未深度验证；`not-selected` = 未选择；`missing` = 缺少必要配置；`blocked` = 配置存在但有阻塞；`unknown` = 无法判断。

### 2.6 RuntimeState

```ts
interface RuntimeState {
    running: boolean;
    pid?: number;
    executablePath?: string;
    logFile?: string;
    runAt: 'local' | 'remote';
}
```

`status` 查看，`run --detach` 启动，`stop` 终止。三者共享结构但职责不同。

### 2.7 CommandPlan

```ts
interface CommandPlan {
    mode: 'dryRun';
    commands?: string[];
    shellCommand?: string;
    willWrite?: string[];
    willRun?: string[];
}
```

### 2.8 ServerSummary / ServerDetail

```ts
interface ServerSummary {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: 'key' | 'password';
    selected?: boolean;
}

interface ServerDetail extends ServerSummary {
    privateKeyPath?: string;
    strictHostKeyChecking?: boolean;
}
```

`ServerDetail` 用于 `forja list servers --detail <id>`。不输出密码。

### 2.9 RemoteConfigSummary

```ts
interface RemoteConfigSummary {
    server?: ServerSummary;
    remotePath?: string;
    remoteWorkspace?: string;
    remoteForjaBin?: string;
    buildOrder?: string[];
    transferConfigured?: boolean;
}
```

### 2.10 List vs Doctor vs Status 边界

`list` 回答"有什么/配了什么"，`doctor` 回答"能不能用"，`status` 回答"当前状态和下一步"。

| 问题 | 命令 | 理由 |
|------|------|------|
| "有哪些项目？" | `forja list` | 文件扫描，纯枚举 |
| "有哪些服务器？" | `forja list servers` | 读配置，纯枚举 |
| "添加/修改/删除服务器？" | `forja server add/update/remove` | 修改共享 server 池 |
| "有哪些远程 repo？" | `forja list remote-repos` | 读配置，纯枚举 |
| "Qt/VS/jom 路径在哪？" | `forja list env` | 路径枚举，纯发现 |
| "远程配了什么？" | `forja list remote` | 配置列举（workspace/bin/build-order/transfer/repos） |
| "当前 Qt/SDK/Sync/Remote 配置摘要是什么？" | `forja list config` | 只读列举已保存配置摘要 |
| "Qt/VS/jom 能用吗？" | `forja doctor` | 健康验证，属诊断 |
| "SSH 能连上吗？" | `forja doctor` | 连接验证，属诊断 |
| "sync 配置完整吗？" | `forja doctor` | 配置校验，属诊断 |
| "当前状态如何？" | `forja status` | readiness 摘要 + nextAction |
| "远程能用吗？" | `forja status` | remote readiness 判断（最小摘要） |

### 2.11 Locale

诊断消息和文本输出支持多语言，JSON 中的 `code` 永远不变。

**优先级**：`--lang` flag > `FORJA_LANG` 环境变量 > 系统 locale > 默认 `en`

```
forja status --json                  # 默认 en
forja status --json --lang zh        # 中文
FORJA_LANG=zh forja status --json    # 中文
```

**影响范围**：
- `Diagnostic.message`、`Diagnostic.hint` — 跟随 locale
- Readiness 文本输出 — 跟随 locale
- CLI help、文本模式输出 — 跟随 locale

**不影响**：
- `Diagnostic.code` — 永远英文机器码
- `ReadinessState` 值 — 永远 `ready`/`configured`/`blocked`/`missing`/`unknown`/`not-selected`
- `nextAction` 命令字符串 — 永远英文命令

**Readiness 状态文本映射**：

| State | EN | ZH |
|-------|----|----|
| `ready` | Ready | 就绪 |
| `configured` | Configured | 已配置 |
| `blocked` | Blocked | 阻塞 |
| `missing` | Missing | 缺失 |
| `unknown` | Unknown | 未知 |
| `not-selected` | Not selected | 未选择 |

---

## 4. 完整旧→新映射表

基于 `command-inventory.md` 盘点，确保每个现有命令都有明确归宿。

### 4.1 Qt CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja qt init` | `forja setup` | 吸收进统一 setup |
| `forja qt use` | `forja use target ...` / `forja use qt ...` | 项目选择用 `target --project`；mode/arch 用 `target --mode/--arch`；工具链用 `use qt --qt-path/--vs-dev-shell`；Qt TARGET 覆盖用 `--qmake-target`；qmake 参数用 `--qmake-args` |
| `forja qt status` | `forja status` | 吸收进统一 status |
| `forja qt env` | `forja list env` | 工具链路径枚举归 list |
| `forja qt projects` | `forja list` / `forja list targets` | 吸收进 list targets |
| `forja qt qmake` | `forja build qmake` | build 子动作 |
| `forja qt build` | `forja build` | 统一 build |
| `forja qt clean` | `forja clean` | 统一 clean |
| `forja qt run` | `forja run` | 统一 run；`--plan` 保留为 `forja run --plan` |
| `forja qt stop` | `forja stop` | 统一 stop |
| `forja qt ps` | `forja status` | runtime 归 status |
| `forja qt rcc` | `forja build rcc` | build 子动作 |

### 4.2 SDK CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja sdk init` | `forja setup` | 吸收进统一 setup |
| `forja sdk use` | `forja use target ...` / `forja use sdk ...` | 项目选择用 `target --project`；mode/arch 用 `target --mode/--arch`；VS dev cmd 用 `use sdk --vs-dev-cmd` |
| `forja sdk status` | `forja status` | 吸收进统一 status |
| `forja sdk env` | `forja list env` | 工具链路径枚举归 list |
| `forja sdk projects` | `forja list` / `forja list targets` | 吸收进 list targets |
| `forja sdk build` | `forja build` | 统一 build |
| `forja sdk rebuild` | `forja build fresh` | fresh = rebuild 语义 |
| `forja sdk clean` | `forja clean` | 统一 clean |

### 4.3 Remote CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja remote status` | `forja status` | remote readiness 部分 |
| `forja remote doctor` | `forja doctor --remote` | 统一 doctor |
| `forja remote doctor --bootstrap` | `forja doctor fix --remote [--server <id>]` | 检查并部署/更新远端 Forja bin |
| `forja remote test` | `forja doctor --remote` | 吸收进 doctor |
| `forja remote test --bootstrap` | `forja doctor fix --remote [--server <id>]` | 检查并部署/更新远端 Forja bin |
| `forja remote bootstrap` | `forja doctor fix --remote [--server <id>]` | 部署 Forja bin 属远端环境修复 |
| `forja remote unlock` | `forja doctor unlock <lock-id>` | doctor 子动作 |
| `forja remote workspace status` | `forja list remote` | 纯配置列举，归入 list remote |
| `forja remote workspace use` | `forja use remote workspace set` | 高级配置 |
| `forja remote workspace clear` | `forja use remote workspace clear` | 高级配置 |
| `forja remote repo list` | `forja list remote-repos` | list 子分类 |
| `forja remote repo set/remove/clear` | `forja use remote repo set/remove/clear` | 高级配置 |
| `forja remote forja-bin status` | `forja list remote` | 纯配置列举，归入 list remote |
| `forja remote forja-bin use/clear` | `forja use remote forja-bin set/clear` | 高级配置 |
| `forja remote build-order status` | `forja list remote` | 纯配置列举，归入 list remote |
| `forja remote build-order set/clear` | `forja use remote build-order set/clear` | 高级配置 |
| `forja remote transfer status` | `forja list remote` | 纯配置列举，归入 list remote |
| `forja remote transfer set/clear` | `forja use remote transfer set/clear` | artifact transfer 配置 |
| `forja remote transfer run` | `forja sync transfer` | artifact transfer 执行 |
| `forja remote qt status` | `forja status` | 统一 status |
| `forja remote qt init` | `forja setup --server <id>` | 通过 bridge 执行远端初始化 |
| `forja remote qt use` | `forja use target ...` / `forja use execution --remote` / `forja use remote --server ...` | 目标、执行端、remote 绑定分别配置 |
| `forja remote qt build` | `forja build` | 统一 build（runAt=remote） |
| `forja remote qt clean` | `forja clean` | 统一 clean（runAt=remote） |
| `forja remote qt qmake` | `forja build qmake` | 统一 build qmake |
| `forja remote qt run` | `forja run` | 统一 run |
| `forja remote qt stop` | `forja stop` | 统一 stop |
| `forja remote qt ps` | `forja status` | runtime 归 status |
| `forja remote qt restore` | `forja doctor restore [--force]` | 隐藏破坏性操作 |
| `forja remote qt reset` | `forja doctor reset [--force]` | 隐藏破坏性操作 |
| `forja remote qt clean-untracked` | `forja doctor clean-untracked [--recursive] [--force]` | 隐藏破坏性操作 |
| `forja remote sdk status` | `forja status` | 统一 status |
| `forja remote sdk init` | `forja setup --server <id>` | 通过 bridge 执行远端初始化 |
| `forja remote sdk use` | `forja use target ...` / `forja use execution --remote` / `forja use remote --server ...` | 目标、执行端、remote 绑定分别配置 |
| `forja remote sdk build` | `forja build` | 统一 build |
| `forja remote sdk rebuild` | `forja build fresh` | 统一 build fresh |
| `forja remote sdk clean` | `forja clean` | 统一 clean |
| `forja remote sdk restore/reset/clean-untracked` | `forja doctor restore/reset/clean-untracked [--force]` | 隐藏破坏性操作 |

### 4.4 Sync CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja sync`（执行） | `forja sync [--server <id>]` | 同名新命令，`--server` 仅临时覆盖本次同步 |
| `forja sync --plan` | `forja sync plan` | 位置动作 |
| `forja sync status` | `forja status` / `forja doctor --remote --server <id>` | 当前 sync readiness 归 status；指定 server 检查归 doctor |
| `forja sync use` | `forja use sync --server ... --remote-path ...` / `forja use sync --enable|--disable` | sync server/path 与启停都吸收进 use |
| `forja sync test-connection` | `forja doctor --remote [--server <id>]` | 连接检测归 remote doctor |
| `forja sync reset` | `forja sync reset` | 同名新子动作 |
| `forja sync servers` | `forja list servers` | list 子分类 |
| `forja sync server` | `forja list servers --detail <id>` | list 子分类 |
| `forja sync add-server` | `forja server add` | 共享 server CRUD |
| `forja sync update-server --server <id>` | `forja server update <id>` | 共享 server CRUD |
| `forja sync remove-server --server <id>` | `forja server remove <id>` | 共享 server CRUD |

### 4.5 Cleanup CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja cleanup` | `forja doctor fix` | 非破坏性修复，`--plan` 保留为 `forja doctor fix --plan` |

### 4.6 VSCode Qt 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.qt.selectProject` | `forja.use` | 统一目标选择；CLI/API 等价 `forja use target --project <path>` |
| `forja.qt.loadManualProject` | `forja.use` | 手动项目加载；CLI/API 等价 `forja use target --project <path>` |
| `forja.qt.showActions` | `forja.status` / QuickPick | 统一操作菜单从 status nextAction 派生 |
| `forja.qt.qmake` | `forja.build` | build 子动作；CLI/API 等价 `forja build qmake` |
| `forja.qt.build` | `forja.build` | 构建 |
| `forja.qt.clean` | `forja.clean` | 清理 |
| `forja.qt.run` | `forja.run` | 运行 |
| `forja.qt.stop` | `forja.stop` | 停止 |
| `forja.qt.debug` | `forja.debug` | 调试；仅 VSCode，CLI 不支持 |
| `forja.qt.openWithQtDesigner` | `forja.run` | Qt Designer；CLI/API 等价 `forja run designer <ui-file>` |
| `forja.qt.rcc` | `forja.build` | build 子动作；CLI/API 等价 `forja build rcc` |
| `forja.qt.runCustomCommand` | `forja.run` | 自定义运行；CLI/API 等价 `forja run --custom <name>` |

### 4.7 VSCode Sync 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.syncTestConnection` | `forja.doctor` | 连接诊断；CLI/API 等价 `forja doctor --remote [--server <id>]` |
| `forja.syncChangedFiles` | `forja.sync` | 保留 Explorer 上下文 |

### 4.8 VSCode SDK 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.sdk.build` | `forja.build` | SDK build |
| `forja.sdk.rebuild` | `forja.build` | SDK rebuild；CLI/API 等价 `forja build fresh` |
| `forja.sdk.clean` | `forja.clean` | SDK clean |
| `forja.sdk.selectProject` | `forja.use` | SDK 项目选择；CLI/API 等价 `forja use target --project <path>` |
| `forja.sdk.showActions` | `forja.status` / QuickPick | 统一操作菜单 |

### 4.9 VSCode Remote 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.remote.execution.pick` | `forja.use`（runAt 选择） | 执行端选择 |
| `forja.remote.execution.local` | `forja.use` | 切本地；CLI/API 等价 `forja use execution --local` |
| `forja.remote.execution.remote` | `forja.use` | 切远程；CLI/API 等价 `forja use execution --remote` |
| `forja.remote.workbench` | `forja.status` / QuickPick | 远程工作台由 status + nextAction 承接 |
| `forja.remote.status` | `forja.status` | 远程 readiness |
| `forja.remote.doctor` | `forja.doctor` | 远程诊断；CLI/API 等价 `forja doctor --remote` |
| `forja.remote.test` | `forja.doctor` | 连接测试；CLI/API 等价 `forja doctor --remote` |
| `forja.remote.bootstrap` | `forja.doctor` | 部署远端 Forja；CLI/API 等价 `forja doctor fix --remote [--server <id>]` |
| `forja.remote.transfer.status` | `forja.list` | transfer 配置状态；CLI/API 等价 `forja list remote` |
| `forja.remote.qt.build` | `forja.build` | runAt=remote |
| `forja.remote.qt.clean` | `forja.clean` | runAt=remote |
| `forja.remote.qt.qmake` | `forja.build` | runAt=remote；CLI/API 等价 `forja build qmake` |
| `forja.remote.qt.run` | `forja.run` | runAt=remote |
| `forja.remote.qt.runDetached` | `forja.run` | runAt=remote；CLI/API 等价 `forja run --detach` |
| `forja.remote.qt.stop` | `forja.stop` | runAt=remote |
| `forja.remote.qt.ps` | `forja.status` | remote runtime；CLI/API 等价 `forja status` |
| `forja.remote.sdk.build` | `forja.build` | runAt=remote |
| `forja.remote.sdk.rebuild` | `forja.build` | runAt=remote；CLI/API 等价 `forja build fresh` |
| `forja.remote.sdk.clean` | `forja.clean` | runAt=remote |

### 4.10 VSCode 全局/UI 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.config.openPage` | `forja.use` | 配置 UI 入口 |
| `forja.showSyncTab` | `forja.use` / `forja.sync` | 远程配置或同步页由新命令 UI 承接 |
| `forja.showActions` | `forja.status` / QuickPick | 统一操作菜单由 status nextAction 承接 |

---

## 5. VSCode 最终 Command Palette

### 5.1 可见命令

| Command ID | 标题 | 对应 CLI |
|------------|------|----------|
| `forja.status` | Forja: Status | `forja status` |
| `forja.setup` | Forja: Setup | `forja setup` |
| `forja.list` | Forja: List | `forja list` |
| `forja.use` | Forja: Use | `forja use` |
| `forja.server` | Forja: Server | `forja server` |
| `forja.build` | Forja: Build | `forja build` |
| `forja.run` | Forja: Run | `forja run` |
| `forja.stop` | Forja: Stop | `forja stop` |
| `forja.clean` | Forja: Clean | `forja clean` |
| `forja.doctor` | Forja: Doctor | `forja doctor` |
| `forja.sync` | Forja: Sync Changes | `forja sync` |

### 5.2 上下文可见命令

| Command ID | 可见条件 | 说明 |
|------------|----------|------|
| `forja.run` | Explorer .ui 文件右键 | 执行 `forja run designer <ui-file>` |
| `forja.sync` | Explorer 文件右键 | 同步当前文件 |
| `forja.use` | Command Palette | 配置面板入口 |

### 5.3 实现约束

产品命令面不保留旧命令。VSCode Command ID 也按新命令面直接替换：旧 `forja.qt.*`、`forja.sdk.*`、`forja.remote.*`、旧 sync/config UI 命令不作为 alias 兼容保留。实现阶段应删除或停止注册旧 ID，并同步 `package.json` contributes、menus 和 `extension.ts`/模块注册点。

---

## 6. 通用参数

| 参数 | 适用命令 | 含义 |
|------|----------|------|
| `--workspace <path>` | 所有命令 | 指定工作区。默认当前目录 |
| `--json` | 所有命令 | 输出结构化 JSON |
| `--plan` | `setup`、`build`、`run`、`clean`、`doctor fix` | 只预览，不执行外部影响动作 |

### 动作与参数规则

```
forja <主命令> <动作> [对象] [--修饰参数]
```

- 动作用位置参数：`forja build qmake`、`forja doctor unlock <lock-id>`、`forja sync plan`。
- `--flag` 只表达修饰：`--json`、`--workspace`、`--force`、`--file`。
- 不引入 `--restore`、`--reset`、`--unlock`、`--clean-untracked` 这类"看起来是开关、实际是动作"的新公开语法。
- 新帮助、`nextAction`、VSCode commands、AI 工具推荐路径只使用新命令。

---

## 7. 文本输出规范

### 7.1 语言策略

CLI 文本输出使用英文。当前旧命令的中文输出（"成功"/"失败"/"下一步"）在迁移到新命令时统一改为英文；旧 CLI 用户入口不作为新文本输出设计的一部分。

### 7.2 统一模板

```
Forja <command> <result>
Target: <kind> <project> <mode> <arch> <runAt>
<command-specific details>
Next:
  <nextAction1>
  <nextAction2>
```

示例：
```
Forja status
Workspace: C:\repo
Target: qt apps/client/client.pro debug x64 local
Readiness: target=ready sync=configured remote=not-selected
Next: forja build
```

```
Forja build succeeded
Target: qt apps/client/client.pro debug x64 local
Duration: 1200ms
```

```
Forja build failed (exit 2)
Target: sdk sdk/NemoSDK.sln release x64 local
Error: src/main.cpp(42): error C2065: 'foo': undeclared identifier
Next: forja doctor
```

---

## 8. 并发与竞态

- **Remote 执行**：已有 lock 机制（`remote/core/lock.ts`），prepare/release 自动管理。
- **Local 执行**：依赖用户自行管理，不做额外保护。
- **`forja status`**：`runtime` 字段可标记是否有进行中的任务（local 读取 runState，remote 读取 bridge ps）。
- **`runAt` 切换**：如果有进行中的构建，`use` 应警告但不阻止。

---

## 9. 实施文件结构

### 新建

```
src/cli/unified/
├── index.ts           — 顶层统一命令分发
├── types.ts           — ActiveTarget, Candidate, Result types
├── activeTarget.ts    — 读写 active target 元数据
├── candidates.ts      — Qt/SDK target + server + remote-repo 候选聚合
├── status.ts          — status 规划器
├── init.ts            — init 逻辑（toolchain 检测 + 保存）
├── list.ts            — list 路由
├── use.ts             — use 路由 + 持久化
├── server.ts          — 共享 server CRUD
├── build.ts           — build 路由（local/remote × qt/sdk）
├── run.ts             — run 路由（含 debug/custom）
├── stop.ts            — stop 路由
├── clean.ts           — clean 路由
├── doctor.ts          — doctor 路由（check/fix/unlock + 隐藏恢复）
└── sync.ts            — sync 路由
```

### 修改

| 文件 | 变更 |
|------|------|
| `src/cli/index.ts` | 路由到 11 个新命令；旧用户命令不进入产品帮助 |
| `src/qt/shared/qtCore.ts` | nextAction 改用新命令 |
| `src/sdk/cli/index.ts` | 暴露可复用的 build/status 函数 |
| `src/sync/cli.ts` | nextAction 改用新命令 |
| `src/remote/cli/index.ts` | 暴露可复用 hooks 供新命令调用 |
| `src/remote/vscode/commands.ts` | 删除旧 remote command ID 注册，改为新统一命令 adapter |
| `src/qt/commands.ts` | 删除旧 Qt command ID 注册，改为新统一命令 adapter |
| `src/sdk/sdkExtension.ts` | 删除旧 SDK command ID 注册，改为新统一命令 adapter |
| `src/ui/unifiedStatusBar.ts` | 状态栏动作改用统一命令 |
| `package.json` | 添加新 command contributions，隐藏旧 palette entries |
| `scripts/build-cli.js` | 包含新 unified CLI 模块 |

### 测试

```
src/test/unifiedCliStatus.test.ts
src/test/unifiedCliInit.test.ts
src/test/unifiedCliList.test.ts
src/test/unifiedCliUse.test.ts
src/test/unifiedCliServer.test.ts
src/test/unifiedCliBuild.test.ts
src/test/unifiedCliRun.test.ts
src/test/unifiedCliStop.test.ts
src/test/unifiedCliClean.test.ts
src/test/unifiedCliDoctor.test.ts
src/test/unifiedCliSync.test.ts
```

---

## 10. 实施阶段

### Stage 1: Foundation（无用户可见变化）

- [ ] 创建 `src/cli/unified/types.ts`：ActiveTarget、Candidate、Result 类型定义。
- [ ] 创建 `src/cli/unified/activeTarget.ts`：读写 active target 元数据（存储在 `~/.forja/projects/<hash(workspace:activeTarget)>.json`，`type: "activeTarget"`）。
- [ ] 创建 `src/cli/unified/candidates.ts`：Qt/SDK target + server + remote-repo 候选聚合。
- [ ] 添加混合 workspace 和单目标自动选择的测试。
- [ ] 不改变现有后端能力；用户命令面由后续阶段切到新命令。

**依赖**：无。
**验证**：新模块编译通过；测试通过。

### Stage 2: Config Commands

- [ ] 创建 `src/cli/unified/status.ts`、`init.ts`、`list.ts`、`use.ts`、`server.ts`。
- [ ] 创建 `src/cli/unified/index.ts`：顶层路由新命令。
- [ ] 修改 `src/cli/index.ts`：只将 11 个新顶层用户命令作为公开路由；旧 CLI 用户入口不进入 help/nextAction。
- [ ] 更新旧 Qt/SDK 的 nextAction 中指向 status/use/projects 的部分。
- [ ] 添加 VSCode 命令 `forja.status`/`forja.init`/`forja.list`/`forja.use`/`forja.server`，注册 + `package.json`。

**依赖**：Stage 1。
**可并行**：Stage 3（一旦 activeTarget 读写稳定）。
**验证**：
- `forja status --json` 在无 active target 时不猜测。
- `forja list --json` 列出 Qt + SDK 候选。
- `forja list config --json` 返回 Qt/SDK/Sync/Remote 配置摘要。
- `forja use target --project <path> --json` 保存 active target。
- `forja setup --json` 在混合 workspace 不选择。

### Stage 3: Execution Commands

- [ ] 创建 `build.ts`、`run.ts`、`stop.ts`、`clean.ts`。
- [ ] 实现 build 路由：default/fresh/qmake/rcc × qt/sdk × local/remote。
- [ ] 实现 run 路由：default/detach/debug/custom。
- [ ] 实现 stop/clean 路由。
- [ ] 更新状态栏 build/run/stop/clean 调用。

**依赖**：Stage 1 + Stage 2 的 activeTarget 稳定。
**可并行**：Stage 2（除 activeTarget 外无共享逻辑）。
**验证**：
- `forja build --json` 按 active target 路由。
- `forja build qmake --json` 对 Qt 有效，对 SDK 报错。
- `forja run --plan --json` 预览运行计划，不启动进程。
- `forja run --detach --json` 对 Qt 有效，对 SDK 报错。
- Remote active target 路由到已有 remote prepared/bridge actions。

### Stage 4: Diagnostics & Sync

- [ ] 创建 `doctor.ts`、`sync.ts`。
- [ ] 实现 doctor 聚合：toolchain 健康验证（Qt/VS/jom/make 可用性）+ target + sync + remote 检查。
- [ ] 将 `qt env`/`sdk env` 的路径发现迁入 `list env`，健康验证保留在 doctor。
- [ ] 将 `sync test-connection`、`remote test`、`remote doctor` 能力吸收到 doctor。
- [ ] 在 `src/sync/cli.ts` parser 中新增位置动作 `plan`，等价于 `--plan`。
- [ ] 将 `remote transfer run` 能力吸收到 `forja sync transfer`。
- [ ] 保留 sync 执行行为，更新 nextAction 指向 list/use。
- [ ] 将 `cleanup` 能力吸收到 `doctor fix`。

**依赖**：Stage 2（status 模式已稳定）。
**验证**：
- `forja doctor --json` 报告 local target 检查（local 模式不 SSH）。
- `forja doctor --remote --json` 报告 remote 检查，`--server <id>` 可临时指定共享 server。
- `forja doctor fix --remote --server <id> --json` 临时向指定共享 server 部署/更新 Forja bin。
- `forja doctor fix --plan --json` 预览 cleanup/remote fix，不写配置、不上传文件。
- `forja sync plan --json` 保留现有行为。
- `forja sync --server <id> --json` 临时覆盖本次同步 server，不修改配置。
- sync 缺配置时指向 `forja list servers` + `forja use sync --server`。

### Stage 5: Replace Old User Surface

- [ ] 在 `package.json` Command Palette 中只暴露新命令和新上下文动作。
- [ ] 删除旧 VSCode command ID 注册和 contributes，只保留新命令 ID 与新上下文动作。
- [ ] 更新 CLI help：只显示 11 个新命令及其子动作。
- [ ] 更新 AI skill 文档使用新命令。
- [ ] 更新 `docs/README-cli.md` 和 `docs/cli-interface-spec.md`。

**依赖**：Stage 2-4 全部完成。
**验证**：
- Command Palette 搜索 "Forja" 只显示新命令集 + 新上下文命令。
- `forja --help` 显示新命令集。
- 旧 CLI 用户命令不出现在公开 help、nextAction 或用户文档。

### Stage 6: Verification

- [ ] `npm run compile`
- [ ] `npm test`
- [ ] `npm run build:cli`（CLI 包包含新模块）
- [ ] 不执行 `npm run package:all`（除非显式打包发布）

**依赖**：Stage 5。

---

## 11. Stage 依赖图

```
Stage 1 (Foundation)
    ├── Stage 2 (Config: status/init/list/use)
    │       └── Stage 4 (Diagnostics: doctor/sync)
    │               └── Stage 5 (Replace Old Surface)
    └── Stage 3 (Execution: build/run/stop/clean)  ← 可与 Stage 2 并行
                    └── Stage 5 (Replace Old Surface)
                            └── Stage 6 (Verification)
```

Stage 2 和 Stage 3 可在 Stage 1 完成后并行推进。Stage 4 依赖 Stage 2。Stage 5 依赖 Stage 2-4 全部完成。

---

## 12. 测试矩阵

| 场景 | 命令 | 预期 |
|------|------|------|
| 空 workspace | `forja status --json` | 无 target，next action `forja setup` |
| 一个 Qt target | `forja setup --json` | 保存 Qt active target + toolchain |
| 一个 SDK target | `forja setup --json` | 保存 SDK active target + toolchain |
| 1 Qt + 1 SDK | `forja setup --json` | 不选择，ambiguous=true，next actions `forja list`、`forja use target --project <path>` |
| 零个目标 | `forja setup --json` | 仅保存工具链默认值，next action `forja list` |
| 重复执行 setup | `forja setup --json` × 2 | 第二次不覆盖已有用户选择 |
| setup --plan | `forja setup --plan --json` | 输出计划，不写入配置 |
| setup --local-only | `forja setup --local-only --json` | 只做本地初始化，跳过远程配置 |
| setup 指定 server | `forja setup --server dev --json` | 使用指定共享 server 进行远程配置 |
| 多个 Qt targets | `forja list --json` | 列出所有 .pro，标记 current |
| 查看配置摘要 | `forja list config --json` | 返回 Qt/SDK/Sync/Remote 已保存配置摘要，不做健康验证 |
| 选择 Qt | `forja use target --project app.pro --json` | kind=qt |
| 选择 SDK | `forja use target --project sdk.sln --json` | kind=sdk |
| Qt TARGET 覆盖 | `forja use qt --qmake-target MyApp --json` | 保存 QMake TARGET override |
| Sync enable/disable | `forja use sync --enable --json` / `forja use sync --disable --json` | 只更新 sync.enabled |
| Server add | `forja server add --name dev --host 192.168.1.10 --username xw --json` | 写入共享 server store |
| Server remove | `forja server remove dev --json` | 只删除共享 server，不清 sync/remote 引用 |
| Sync temporary server | `forja sync --server dev --json` | 临时覆盖 server，不修改 sync 配置 |
| Qt qmake only | `forja build qmake --json` | 路由到 qmake |
| Qt rcc only | `forja build rcc --json` | 路由到 rcc |
| SDK qmake rejected | `forja build qmake --json` | 报错：SDK 没有 qmake 步骤 |
| SDK fresh build | `forja build fresh --json` | rebuild 或 clean+build |
| Qt run | `forja run --detach --json` | 返回 pid/logFile |
| Qt run plan | `forja run --plan --json` | 预览，不启动进程 |
| Qt run debug | `forja.debug` (VSCode only) | 启动调试；CLI 返回 `run.debugRequiresVSCode` |
| Qt run custom | `forja run --custom myCmd --json` | 运行已保存命令 |
| SDK run rejected | `forja run --json` | 失败，next action `forja build` |
| Remote Qt build | `forja use remote --server dev --remote-path /work/app` + `forja use execution --remote` + `forja build --json` | 远程 prepared Qt build |
| Remote SDK build | `forja use remote --server dev --remote-path /work/app` + `forja use execution --remote` + `forja build --json` | 远程 prepared SDK build |
| 缺少 remote server | `forja build --json` | SSH 前失败，指向 list/use |
| Sync 缺配置 | `forja sync --json` | 指向 list servers + use sync --server |
| Transfer 执行 | `forja sync transfer --json` | 执行 artifact transfer |
| Doctor local | `forja doctor --json` | local 检查（含 toolchain-qt/vs/jom/make），不 SSH |
| Doctor remote | `forja doctor --remote --json` | remote 检查 |
| Doctor specific server | `forja doctor --remote --server dev --json` | 临时检查共享 server，不修改配置 |
| Doctor fix specific server | `forja doctor fix --remote --server dev --json` | 临时修复共享 server，不修改配置 |
| Doctor toolchain missing | `forja doctor --json`（无 Qt 环境） | `toolchain-qt` check = missing/blocked |
| Doctor fix cleanup | `forja doctor fix --json` | 清理残留配置 |
| Doctor fix plan | `forja doctor fix --plan --json` | 预览 cleanup/remote fix |
| Status runtime | `forja status --json` | 返回 runtime 信息 |

---

## 13. 旧命令替换策略

### 第一版发布后

- 用户文档、CLI help、Command Palette、nextAction 只展示新命令。
- 旧 CLI 用户命令不作为产品设计入口。
- 旧 VSCode command ID 不兼容保留；扩展命令面直接替换为新 ID。

### 第二版发布后

- 移除旧 CLI 用户命令入口。
- 旧 VSCode Command ID 已在第一版替换，不再注册。

### 不变项

- 不修改 `extension.ts` 的 activate 函数签名。
- VSCode Command ID 可按新命令面删除、重命名或替换。
- 不修改 `package.json` 已发布的 `activationEvents`。

---

## 14. 文档更新

| 文档 | 变更 |
|------|------|
| `docs/README-cli.md` | 替换为新命令集 |
| `docs/cli-interface-spec.md` | 更新为新公开 CLI 契约 |
| `skills/forja/SKILL.md` | AI 工具推荐路径改用新命令 |
| `docs/operations/command-consolidation/command-inventory.md` | 保留作为迁移基准 |

---

_更新时间: 2026-06-15_
