# Forja 命令收敛迁移方案 v2

> 目标：将 ~107 个分散的 Qt/SDK/Remote/Sync 命令收敛为 10 个意图驱动的顶层命令，同时保留所有现有功能通过兼容层继续工作。

**命令规格（各文件）**：
[status](status.md) · [init](init.md) · [list](list.md) · [use](use.md) · [build](build.md) · [run](run.md) · [stop](stop.md) · [clean](clean.md) · [doctor](doctor.md) · [sync](sync.md)

---

## 1. 最终用户命令集

```
forja status      — 当前状态和下一步建议
forja init        — 首次初始化（检测 + 保存无歧义配置）
forja list        — 列举可选项（targets/servers/remote-repos）
forja use         — 选择目标、构建配置、执行端
forja build       — 构建当前目标
forja run         — 运行当前目标
forja stop        — 停止当前运行目标
forja clean       — 清理构建产物
forja doctor      — 深度诊断和恢复
forja sync        — 同步变更文件到远程
```

不引入 `forja remote`、`forja qt`、`forja sdk` 作为用户命令。这些保留为隐藏兼容入口。

---

## 2. 核心概念

### 2.1 ActiveTarget

所有执行类命令围绕当前目标工作。

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
- `kind` 一旦选定必须显式；混合 workspace 不猜测。
- `project` 优先使用相对路径。
- `runAt` 独立于 `kind`：Qt 和 SDK 都支持 local/remote。
- 缺失 active target 时，`build`/`run`/`stop`/`clean` 返回失败并指向 `forja list` + `forja use`。

### 2.2 Candidate

```ts
interface TargetCandidate {
    kind: 'qt' | 'sdk';
    project: string;
    label: string;
    current: boolean;
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
    nextActions?: string[];
}
```

规则：
- `ok` 和 `action` 必须始终存在。
- `nextActions` 只输出新命令，不输出旧兼容命令。
- 文本输出可提示兼容命令迁移；JSON 不输出噪音文案。
- 退出码：成功 `0`，失败 `1`，用户取消 `0`。

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

`status --process` 查看，`run --detach` 启动，`stop` 终止。三者共享结构但职责不同。

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

### 2.9 RemoteSummary

```ts
interface RemoteSummary {
    runAt: 'local' | 'remote';
    server?: ServerSummary;
    remotePath?: string;
    remoteWorkspace?: string;
    remoteForjaBin?: string;
    buildOrder?: string[];
    transferConfigured?: boolean;
}
```

### 2.10 List vs Doctor 边界

`list` 回答"有什么"，`doctor` 回答"能不能用"。工具链检测（Qt/VS/jom/make 扫描）属于诊断性质，全部归 `doctor`。

| 问题 | 命令 | 理由 |
|------|------|------|
| "有哪些项目？" | `forja list` | 文件扫描，纯枚举 |
| "有哪些服务器？" | `forja list servers` | 读配置，纯枚举 |
| "有哪些远程 repo？" | `forja list remote-repos` | 读配置，纯枚举 |
| "Qt/VS/jom 路径在哪？" | `forja list env` | 路径枚举，纯发现 |
| "Qt/VS/jom 能用吗？" | `forja doctor` | 健康验证，属诊断 |
| "SSH 能连上吗？" | `forja doctor` | 连接验证，属诊断 |
| "sync 配置完整吗？" | `forja doctor` | 配置校验，属诊断 |

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
- `nextActions` 命令字符串 — 永远英文命令

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
| `forja qt init` | `forja init` | 吸收进统一 init |
| `forja qt use` | `forja use` | 吸收进统一 use |
| `forja qt status` | `forja status` | 吸收进统一 status |
| `forja qt env` | `forja list env` | 工具链路径枚举归 list |
| `forja qt projects` | `forja list` / `forja list targets` | 吸收进 list targets |
| `forja qt qmake` | `forja build qmake` | build 子动作 |
| `forja qt build` | `forja build` | 统一 build |
| `forja qt clean` | `forja clean` | 统一 clean |
| `forja qt run` | `forja run` | 统一 run |
| `forja qt stop` | `forja stop` | 统一 stop |
| `forja qt ps` | `forja status --process` | runtime 归 status |
| `forja qt rcc` | `forja build rcc` | build 子动作 |

### 4.2 SDK CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja sdk init` | `forja init` | 吸收进统一 init |
| `forja sdk use` | `forja use` | 吸收进统一 use |
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
| `forja remote test` | `forja doctor --remote` | 吸收进 doctor |
| `forja remote bootstrap` | `forja doctor fix --remote` | 部署 Forja bin 属远端环境修复 |
| `forja remote unlock` | `forja doctor unlock <lock-id>` | doctor 子动作 |
| `forja remote workspace status` | `forja status` / `forja list remote-repos` | 状态→status，列表→list |
| `forja remote workspace use` | `forja use --remote-workspace` | 隐藏 flag |
| `forja remote workspace clear` | 兼容保留 | 低频操作 |
| `forja remote repo list` | `forja list remote-repos` | list 子分类 |
| `forja remote repo set/remove/clear` | 兼容保留 | 低频高级配置 |
| `forja remote forja-bin status` | `forja status` | remote readiness |
| `forja remote forja-bin use/clear` | `forja use --remote-forja-bin` | 隐藏 flag |
| `forja remote build-order status/set/clear` | 兼容保留 | 低频高级配置 |
| `forja remote transfer status` | `forja status` | transfer readiness |
| `forja remote transfer set/clear/run` | 兼容保留 | 低频高级配置 |
| `forja remote qt status` | `forja status` | 统一 status |
| `forja remote qt init` | `forja init --remote` | 通过 bridge 执行远端初始化 |
| `forja remote qt use` | `forja use` | 统一 use（runAt=remote） |
| `forja remote qt build` | `forja build` | 统一 build（runAt=remote） |
| `forja remote qt clean` | `forja clean` | 统一 clean（runAt=remote） |
| `forja remote qt qmake` | `forja build qmake` | 统一 build qmake |
| `forja remote qt run` | `forja run` | 统一 run |
| `forja remote qt stop` | `forja stop` | 统一 stop |
| `forja remote qt ps` | `forja status --process` | runtime 归 status |
| `forja remote qt restore` | `forja doctor restore` | 隐藏破坏性操作 |
| `forja remote qt reset` | `forja doctor reset` | 隐藏破坏性操作 |
| `forja remote qt clean-untracked` | `forja doctor clean-untracked` | 隐藏破坏性操作 |
| `forja remote sdk status` | `forja status` | 统一 status |
| `forja remote sdk init` | `forja init --remote` | 通过 bridge 执行远端初始化 |
| `forja remote sdk use` | `forja use` | 统一 use |
| `forja remote sdk build` | `forja build` | 统一 build |
| `forja remote sdk rebuild` | `forja build fresh` | 统一 build fresh |
| `forja remote sdk clean` | `forja clean` | 统一 clean |
| `forja remote sdk restore/reset/clean-untracked` | `forja doctor restore/reset/clean-untracked` | 隐藏破坏性操作 |

### 4.4 Sync CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja sync`（执行） | `forja sync` | 保留 |
| `forja sync --plan` | `forja sync plan` | 位置动作 |
| `forja sync status` | `forja status` | sync readiness 部分 |
| `forja sync use` | `forja use --server ... --remote-path ...` | 吸收进 use |
| `forja sync test-connection` | `forja doctor` | 连接检测→doctor |
| `forja sync reset` | `forja sync reset` | 保留 |
| `forja sync servers` | `forja list servers` | list 子分类 |
| `forja sync server` | `forja list servers --detail <id>` | list 子分类 |
| `forja sync add-server` | 兼容保留 | 低频 server CRUD |
| `forja sync update-server` | 兼容保留 | 低频 server CRUD |
| `forja sync remove-server` | 兼容保留 | 低频 server CRUD |

### 4.5 Cleanup CLI 映射

| 旧命令 | 新命令 | 说明 |
|--------|--------|------|
| `forja cleanup` | `forja doctor fix` | 非破坏性修复，吸收进 doctor fix |

### 4.6 VSCode Qt 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.qt.selectProject` | `forja.use`（统一 use 交互） | 隐藏旧 ID |
| `forja.qt.loadManualProject` | 隐藏兼容保留 | 内部命令 |
| `forja.qt.showActions` | `forja.build` / QuickPick 统一 | 隐藏旧 ID |
| `forja.qt.qmake` | `forja.build`（QuickPick 选 qmake） | 隐藏旧 ID |
| `forja.qt.build` | `forja.build` | 隐藏旧 ID |
| `forja.qt.clean` | `forja.clean` | 隐藏旧 ID |
| `forja.qt.run` | `forja.run` | 隐藏旧 ID |
| `forja.qt.stop` | `forja.stop` | 隐藏旧 ID |
| `forja.qt.debug` | `forja.run --debug` | 隐藏旧 ID |
| `forja.qt.openWithQtDesigner` | 保留（Explorer .ui 上下文） | 上下文命令，不进入 CLI |
| `forja.qt.rcc` | `forja.build`（QuickPick 选 rcc） | 隐藏旧 ID |
| `forja.qt.runCustomCommand` | `forja.run --custom <name>` | 隐藏旧 ID |

### 4.7 VSCode Sync 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.syncTestConnection` | `forja.doctor` | 隐藏旧 ID |
| `forja.syncChangedFiles` | `forja.sync` | 保留 Explorer 上下文 |

### 4.8 VSCode SDK 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.sdk.build` | `forja.build` | 隐藏旧 ID |
| `forja.sdk.rebuild` | `forja.build`（fresh） | 隐藏旧 ID |
| `forja.sdk.clean` | `forja.clean` | 隐藏旧 ID |
| `forja.sdk.selectProject` | `forja.use` | 隐藏旧 ID |
| `forja.sdk.showActions` | `forja.use` | 隐藏旧 ID |

### 4.9 VSCode Remote 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.remote.execution.pick` | `forja.use`（runAt 选择） | 隐藏旧 ID |
| `forja.remote.execution.local` | `forja.use --local` | 隐藏旧 ID |
| `forja.remote.execution.remote` | `forja.use --remote` | 隐藏旧 ID |
| `forja.remote.workbench` | `forja.status` / QuickPick | 隐藏旧 ID |
| `forja.remote.status` | `forja.status` | 隐藏旧 ID |
| `forja.remote.doctor` | `forja.doctor` | 隐藏旧 ID |
| `forja.remote.test` | `forja.doctor --remote` | 隐藏旧 ID |
| `forja.remote.bootstrap` | `forja.doctor fix --remote` | 隐藏旧 ID |
| `forja.remote.transfer.status` | `forja.status` | 隐藏旧 ID |
| `forja.remote.qt.build` | `forja.build` | 隐藏旧 ID |
| `forja.remote.qt.clean` | `forja.clean` | 隐藏旧 ID |
| `forja.remote.qt.qmake` | `forja.build qmake` | 隐藏旧 ID |
| `forja.remote.qt.run` | `forja.run` | 隐藏旧 ID |
| `forja.remote.qt.runDetached` | `forja.run --detach` | 隐藏旧 ID |
| `forja.remote.qt.stop` | `forja.stop` | 隐藏旧 ID |
| `forja.remote.qt.ps` | `forja.status --process` | 隐藏旧 ID |
| `forja.remote.sdk.build` | `forja.build` | 隐藏旧 ID |
| `forja.remote.sdk.rebuild` | `forja.build fresh` | 隐藏旧 ID |
| `forja.remote.sdk.clean` | `forja.clean` | 隐藏旧 ID |

### 4.10 VSCode 全局/UI 命令映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.config.openPage` | 保留 | 配置面板内部命令 |
| `forja.showSyncTab` | 保留（隐藏） | 远程标签页切换 |
| `forja.showActions` | 保留 | 统一操作菜单 |

---

## 5. VSCode 最终 Command Palette

### 5.1 可见命令

| Command ID | 标题 | 对应 CLI |
|------------|------|----------|
| `forja.status` | Forja: Status | `forja status` |
| `forja.init` | Forja: Init | `forja init` |
| `forja.list` | Forja: List Targets | `forja list` |
| `forja.use` | Forja: Use Target | `forja use` |
| `forja.build` | Forja: Build | `forja build` |
| `forja.run` | Forja: Run | `forja run` |
| `forja.stop` | Forja: Stop | `forja stop` |
| `forja.clean` | Forja: Clean | `forja clean` |
| `forja.doctor` | Forja: Doctor | `forja doctor` |
| `forja.sync` | Forja: Sync Changes | `forja sync` |

### 5.2 上下文可见命令

| Command ID | 可见条件 | 说明 |
|------------|----------|------|
| `forja.qt.openWithQtDesigner` | Explorer .ui 文件右键 | 上下文命令 |
| `forja.syncChangedFiles` | Explorer 文件右键 | 上下文命令 |
| `forja.config.openPage` | Command Palette | 配置面板入口 |

### 5.3 隐藏兼容命令

所有现有 `forja.qt.*`、`forja.sdk.*`、`forja.remote.*` command ID 继续注册，通过 `menus.commandPalette` `when: false` 隐藏。

---

## 6. 通用参数

| 参数 | 适用命令 | 含义 |
|------|----------|------|
| `--workspace <path>` | 所有命令 | 指定工作区。默认当前目录 |
| `--json` | 所有命令 | 输出结构化 JSON |
| `--plan` | `init`、`build`、`clean` | 只预览，不执行外部影响动作 |

### 动作与参数规则

```
forja <主命令> <动作> [对象] [--修饰参数]
```

- 动作用位置参数：`forja build qmake`、`forja doctor unlock <lock-id>`、`forja sync plan`。
- `--flag` 只表达修饰：`--json`、`--workspace`、`--force`、`--file`。
- 不引入 `--restore`、`--reset`、`--unlock`、`--clean-untracked` 这类"看起来是开关、实际是动作"的新公开语法。
- 迁移期兼容旧 flag 形态；新帮助、`nextActions`、AI 工具推荐路径只使用位置动作。

---

## 7. 文本输出规范

### 7.1 语言策略

CLI 文本输出使用英文。当前旧命令的中文输出（"成功"/"失败"/"下一步"）在迁移到新命令时统一改为英文。旧命令文本输出保持不变。

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
| `src/cli/index.ts` | 新命令优先路由，旧命令作为兼容 |
| `src/qt/shared/qtCore.ts` | nextActions 改用新命令 |
| `src/sdk/cli/index.ts` | 暴露可复用的 build/status 函数 |
| `src/sync/cli.ts` | nextActions 改用新命令 |
| `src/remote/cli/index.ts` | 保留兼容，暴露可复用的 adapter hooks |
| `src/remote/vscode/commands.ts` | 添加统一命令 adapter，隐藏旧命令 |
| `src/qt/commands.ts` | 保留旧 ID，可见命令路由到统一 adapter |
| `src/sdk/sdkExtension.ts` | 保留旧 ID，可见命令路由到统一 adapter |
| `src/ui/unifiedStatusBar.ts` | 状态栏动作改用统一命令 |
| `package.json` | 添加新 command contributions，隐藏旧 palette entries |
| `scripts/build-cli.js` | 包含新 unified CLI 模块 |

### 测试

```
src/test/unifiedCliStatus.test.ts
src/test/unifiedCliInit.test.ts
src/test/unifiedCliList.test.ts
src/test/unifiedCliUse.test.ts
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
- [ ] 创建 `src/cli/unified/activeTarget.ts`：读写 active target 元数据（存储在 `~/.forja/projects/<hash>.json` type=activeTarget）。
- [ ] 创建 `src/cli/unified/candidates.ts`：Qt/SDK target + server + remote-repo 候选聚合。
- [ ] 添加混合 workspace 和单目标自动选择的测试。
- [ ] 不改动任何现有命令。

**依赖**：无。
**验证**：新模块编译通过；测试通过。

### Stage 2: Config Commands

- [ ] 创建 `src/cli/unified/status.ts`、`init.ts`、`list.ts`、`use.ts`。
- [ ] 创建 `src/cli/unified/index.ts`：顶层路由新命令。
- [ ] 修改 `src/cli/index.ts`：新命令优先匹配，未匹配时走旧路由。
- [ ] 更新旧 Qt/SDK 的 nextActions 中指向 status/use/projects 的部分。
- [ ] 添加 VSCode 命令 `forja.status`/`forja.init`/`forja.list`/`forja.use`，注册 + `package.json`。

**依赖**：Stage 1。
**可并行**：Stage 3（一旦 activeTarget 读写稳定）。
**验证**：
- `forja status --json` 在无 active target 时不猜测。
- `forja list --json` 列出 Qt + SDK 候选。
- `forja use --target <path> --json` 保存 active target。
- `forja init --json` 在混合 workspace 不选择。

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
- `forja run --detach --json` 对 Qt 有效，对 SDK 报错。
- Remote selected target 路由到已有 remote prepared/bridge actions。

### Stage 4: Diagnostics & Sync

- [ ] 创建 `doctor.ts`、`sync.ts`。
- [ ] 实现 doctor 聚合：toolchain 健康验证（Qt/VS/jom/make 可用性）+ target + sync + remote 检查。
- [ ] 将 `qt env`/`sdk env` 的路径发现迁入 `list env`，健康验证保留在 doctor。
- [ ] 将 `sync test-connection`、`remote test`、`remote doctor` 能力吸收到 doctor。
- [ ] 保留 sync 执行行为，更新 nextActions 指向 list/use。
- [ ] 将 `cleanup` 能力吸收到 `doctor fix`。

**依赖**：Stage 2（status 模式已稳定）。
**验证**：
- `forja doctor --json` 报告 local target 检查（local 模式不 SSH）。
- `forja doctor --remote --json` 报告 remote 检查。
- `forja sync plan --json` 保留现有行为。
- sync 缺配置时指向 `forja list servers` + `forja use --server`。

### Stage 5: Hide Compatibility Surface

- [ ] 在 `package.json` menus.commandPalette 中隐藏所有旧 VSCode 命令。
- [ ] 保留所有旧 command ID 注册。
- [ ] 更新 CLI help：旧 `qt`/`sdk`/`remote`/sync 配置子命令标记为兼容。
- [ ] 更新 AI skill 文档使用新命令。
- [ ] 更新 `docs/README-cli.md` 和 `docs/cli-interface-spec.md`。

**依赖**：Stage 2-4 全部完成。
**验证**：
- Command Palette 搜索 "Forja" 只显示新命令集 + 上下文命令。
- `forja --help` 显示新命令集。
- 旧命令仍可执行。

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
    │               └── Stage 5 (Hide Compat)
    └── Stage 3 (Execution: build/run/stop/clean)  ← 可与 Stage 2 并行
                    └── Stage 5 (Hide Compat)
                            └── Stage 6 (Verification)
```

Stage 2 和 Stage 3 可在 Stage 1 完成后并行推进。Stage 4 依赖 Stage 2。Stage 5 依赖 Stage 2-4 全部完成。

---

## 12. 测试矩阵

| 场景 | 命令 | 预期 |
|------|------|------|
| 空 workspace | `forja status --json` | 无 target，next action `forja init` |
| 一个 Qt target | `forja init --json` | 保存 Qt active target + toolchain |
| 一个 SDK target | `forja init --json` | 保存 SDK active target + toolchain |
| 1 Qt + 1 SDK | `forja init --json` | 不选择，ambiguous=true，next actions `forja list`、`forja use` |
| 零个目标 | `forja init --json` | 仅保存工具链默认值，next action `forja list` |
| 重复执行 init | `forja init --json` × 2 | 第二次不覆盖已有用户选择 |
| init --plan | `forja init --plan --json` | 输出计划，不写入配置 |
| init --remote 缺 bin | `forja init --remote --json` | 失败，next action `forja doctor fix --remote` |
| 多个 Qt targets | `forja list --json` | 列出所有 .pro，标记 current |
| 选择 Qt | `forja use --target app.pro --json` | kind=qt |
| 选择 SDK | `forja use --target sdk.sln --json` | kind=sdk |
| Qt qmake only | `forja build qmake --json` | 路由到 qmake |
| Qt rcc only | `forja build rcc --json` | 路由到 rcc |
| SDK qmake rejected | `forja build qmake --json` | 报错：SDK 没有 qmake 步骤 |
| SDK fresh build | `forja build fresh --json` | rebuild 或 clean+build |
| Qt run | `forja run --detach --json` | 返回 pid/logFile |
| Qt run debug | `forja run --debug --json` | 启动调试 |
| Qt run custom | `forja run --custom myCmd --json` | 运行已保存命令 |
| SDK run rejected | `forja run --json` | 失败，next action `forja build` |
| Remote Qt build | `forja use --remote` + `forja build --json` | 远程 prepared Qt build |
| Remote SDK build | `forja use --remote` + `forja build --json` | 远程 prepared SDK build |
| 缺少 remote server | `forja build --json` | SSH 前失败，指向 list/use |
| Sync 缺配置 | `forja sync --json` | 指向 list servers + use server |
| Doctor local | `forja doctor --json` | local 检查（含 toolchain-qt/vs/jom/make），不 SSH |
| Doctor remote | `forja doctor --remote --json` | remote 检查 |
| Doctor toolchain missing | `forja doctor --json`（无 Qt 环境） | `toolchain-qt` check = missing/blocked |
| Doctor fix cleanup | `forja doctor fix --json` | 清理残留配置 |
| Status process | `forja status --process --json` | 返回 runtime 信息 |

---

## 13. 兼容策略

### 第一版发布后

- 旧 CLI 子命令继续工作。
- 旧 VSCode command ID 继续工作。
- 旧命令从主帮助和 Command Palette 隐藏。
- 旧命令文本输出可包含一行简短迁移提示；JSON 不默认加弃用噪音。

### 第二版发布后

- 保留旧命令执行（不删除已发布的 VSCode command ID）。
- 继续隐藏旧命令。

### 不变项

- 不修改 `extension.ts` 的 activate 函数签名。
- 不删除已发布的 VSCode command ID。
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