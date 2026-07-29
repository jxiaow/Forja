# Forja Greenfield Workspace Convergence Plan

> Status: approved for implementation planning; no code changes are included in this document update.
>
> Scope decision: treat the new configuration model as a fresh product. Do not migrate, read, merge, or compatibly fall back to any legacy configuration or command syntax.

## Goal

建立一个以 `workroot` 为唯一配置边界的产品闭环，使 CLI、VSCode、Qt、SDK、CMake 和 Remote 使用同一份新状态，并让首次使用、multi-root、远程安全和发布验证可重复。

## Non-goals

- 不读取或迁移 `~/.forja/projects/`。
- 不读取或写入旧 `activeTarget`、`pinnedProject`、`targetToolchains` 字段。
- 不兼容 `setup`、旧的嵌套 remote set/clear 语法（如 `remote repo set`）或旧输出协议；顶层 `remote set` 保持为当前契约。
- 不自动删除旧配置文件。
- 不改变 `extension.ts` 的 `activate` 签名或已发布 activationEvents 的语义；新增 CMake activation 需单独评审 package manifest 影响。

## Canonical product contract

### Initialization

```text
forja init [--workroot <path>] [--json] [--answers <path>]
```

`init` 注册 workroot、扫描候选项目、配置首个 target，并写入新 workspace store。未注册 workroot 的命令必须返回诊断和 `nextAction: forja init`。

### Canonical storage

```text
~/.forja/workspaces.json
~/.forja/workspaces/<sha256(normalizedWorkroot)[0:12]>.json
~/.forja/servers.json
```

旧目录可存在，但新版本完全忽略。新 workspace 文件必须带 `schemaVersion`，损坏时明确失败，不回退旧格式。

### Canonical workspace schema

`WorkspaceConfig` 必须显式包含以下字段，不能只在文档示例中出现：

```ts
interface WorkspaceConfig {
  schemaVersion: 1;
  workroot: string;
  activeTarget: string | null;
  targets: Record<string, TargetProfile>;
  qtModulePrefs: QtModulePrefs;
  cppModulePrefs: CppModulePrefs;
  remote: RemoteWorkspaceConfig;
  sync: SyncConfig;
}
```

`TargetProfile.kind` 的协议值固定为 `qt | cpp`；SDK/C++ 只作为产品展示文案。

### Runtime boundary

```text
VSCode/CLI adapters
  -> WorkspaceContextResolver
  -> pure application services
  -> workspace/server/sync stores
```

建议统一使用：

```ts
interface WorkspaceContext {
  workroot: string;
  workspaceFolder: string;
  activeFile?: string;
  activeTarget?: string;
  repoRoots: string[];
}
```

## Execution stages

### WS-00 — Contract freeze

Files: `docs/cli-interface-spec.md`, `docs/README-cli.md`, `src/test/commandApiSpec.test.ts`, `src/cli/commands/types.ts`.

1. 固定公开命令包含 `init`，不包含 `setup`。
2. 固定 `InitResult`、`StatusResult`、`ListResult` 等 JSON envelope。
3. 固定 `nextAction` 使用可执行命令字符串，展示名称只出现在人类输出。
4. 为未知旧命令编写“明确失败，不兼容”的测试。

验收：当前文档、help、命令契约测试没有未标记的 `setup` 或旧 projects 路径描述；明确标注为 historical/superseded 的档案可以保留历史引用。

### WS-01 — Canonical workspace store

Files: `src/core/workspaceStore.ts`, `src/core/settingsIO.ts`, `src/vscode/workspaceResolver.ts`, `src/test/cliFoundation.test.ts`.

1. 定义 `WorkspaceConfig`、`TargetProfile`、module prefs、remote/sync 类型和 schema version。
2. 实现原子写入、sanitize、路径归一化和最深 workroot 匹配。
3. 所有读写只指向 `workspaces.json` 和 `workspaces/<hash>.json`；旧 `projects/` 永不读取。
4. 用 fixture 验证 legacy `projects/` 存在时不会被读取。
5. 对并发写入强制采用临时文件 + rename，并使用 revision/锁避免 CLI 与 VSCode 互相覆盖。
6. 文件不存在表示 `not-initialized`；文件损坏表示 `config-corrupt`，不得静默返回空配置。

验收：新 store 的 load/save/resolve/sanitize/concurrency/corruption 单测全部通过；无旧格式 fallback。

### WS-02 — Workroot resolver

Files: `src/core/workspaceStore.ts`, `src/vscode/workspaceResolver.ts`, `src/test/cliFoundation.test.ts`.

1. 纯 Node 层负责 cwd 到 registered workroot 的最深匹配。
2. VSCode adapter 负责 workspace folder、active editor 和 multi-root 上下文。
3. 未注册 workroot 返回 `not-initialized` 诊断，不读取旧目录。

验收：嵌套 workroot、路径边界、未注册目录和多根 folder 映射测试通过。

### WS-03 — Fresh `forja init`

Files: `src/cli/commands/init.ts`, `src/cli/commands/index.ts`, `src/cli/commands/useTarget/*`, `src/test/initCandidates.test.ts`, `src/test/cliCommands.test.ts`.

1. 新 workroot 注册和重复 init 行为幂等。
2. 交互、`--json`、`--answers` 三种入口共用同一应用服务。
3. 初始化失败不留下半成品 active target。
4. 所有 success/error 输出符合 WS-00 契约。

验收：从空 `FORJA_CONFIG_DIR` 开始，init 后可执行 status/list/use/build plan。

### WS-04 — CLI target application services

Files: `src/cli/commands/{activeTarget,candidates,list,status,use}.ts`, `src/cli/commands/useTarget/*`, `src/sdk/*`.

1. list/use/status 只依赖 canonical store。
2. target kind 协议统一为 `qt | cpp`，展示层才使用 SDK/C++ 文案。
3. Qt/SDK module prefs 与 target profile 分离。
4. 删除未路由的旧 CLI 入口或明确隔离，避免双事实源。

验收：CLI target hermetic integration test 使用当前构建产物，不调用全局安装的 forja。

### WS-05 — Build/run/clean application services

Files: `src/cli/commands/{build,run,clean}.ts`, `src/qt/shared/qtCore.ts`, `src/cpp/shared/plan.ts`.

1. `createActionPlan` 完全参数化，不在内部加载旧 settings。
2. build/run/clean 的所有工具链和 module prefs 来自 active target + workspace store。
3. 计划输出和执行输出共享同一 JSON envelope。

验收：plan 模式不执行外部命令；build/run/clean 使用 hermetic CLI fixture。

### WS-06 — VSCode first-run and lifecycle

Files: `src/extension.ts`, `src/vscode/settingsStore.ts`, `src/vscode/workspaceResolver.ts`, `src/vscode/commands.ts`, `src/ui/statusBar.ts`, `src/ui/configPanel/messageHandler.ts`.

1. 首次打开未注册 workspace 时先确认并注册 workroot，再初始化 settings store。
2. 删除静默 `return` 的内存回退；未注册状态必须显示可执行诊断。
3. 监听 workspace folder、配置文件和 active editor 变化。
4. VSCode 与 CLI 共享同一 active target 和 module prefs。

验收：Extension Host smoke 覆盖“首次打开 → 修改 → 重启 → 状态仍存在”。

### WS-07 — Multi-root and CMake

Files: `src/vscode/workspaceResolver.ts`, `src/core/cppProjectScanner.ts`, `src/cpp/shared/plan.ts`, `src/cpp/modules/projectScanner.ts`, `package.json` (only if activation policy is approved).

1. active editor 文件优先决定 active folder；无文件时提供显式选择。
2. 每个 folder 映射到独立 workroot，禁止默认永久使用第一个 folder。
3. CMake candidate、configure/build/clean/run 链路完整；activation 采用现有入口或经批准的 manifest 方案。
4. CMake 与 `.pro`/`.sln` 的 target 语义统一到 TargetProfile。

验收：multi-root 和 CMake smoke 均可重复，workspace folder 切换不会串配置；不得违反已发布 activationEvents 约束。

### WS-08 — Remote safety

Files: `src/core/ssh.ts`, `src/core/serverStore.ts`, `src/sync/syncWatcher.ts`, `src/cli/commands/remote.ts`, `src/remote/core/*`.

1. 默认启用 host key 校验，首次连接显式确认。
2. 密码不以普通明文配置作为默认路径。
3. reset/clean/delete 必须先 plan；非交互执行必须显式 `--force`。
4. managed workspace marker 是 destructive action 的前置条件。
5. status/doctor check 保持只读。

验收：纯策略测试覆盖安全默认值、拒绝未托管路径和 destructive confirmation。

### WS-09 — Verification, package and docs

Files: `src/test/*`, `.github/workflows/*`, `scripts/build-cli.js`, `docs/*`, `skills/*`.

执行顺序：

1. `npm run lint`
2. `npm test`
3. `npm run package:all`
4. CLI standalone smoke
5. Extension Host smoke
6. 受控 WSL/remote smoke

验收矩阵必须记录命令、结果、时间和未覆盖项。任何“已完成”状态没有证据时都不能写入 README/board。

### WS-10 — Legacy isolation and cleanup

Files: `src/core/settingsIO.ts`, `src/cpp/cli/*`, `src/qt/cli/*`, `scripts/build-cli.js`, historical docs.

1. 移除旧配置读取路径和 dead routes。
2. 保留旧文件但不主动删除。
3. 将旧 migration/config/target-store initiative 标记为 superseded，并指向 workroot-redesign。
4. 全文检索旧命令、旧路径和“已完成”声明，确保没有当前契约冲突。

## Definition of Done

- 空配置目录可完成 `forja init` 并持久化。
- CLI、VSCode、Qt、SDK、CMake、Remote 使用同一 canonical workspace store。
- 旧配置存在与否不影响新版本行为。
- multi-root active folder 正确，CMake workspace 可激活和构建。
- SSH、凭据和 destructive actions 具备安全默认值和测试。
- lint、test、package、CLI hermetic、Extension Host smoke 全部通过。
- README、CLI spec、help、Skill、operation board 内容一致；历史文档均有 superseded 标记。
