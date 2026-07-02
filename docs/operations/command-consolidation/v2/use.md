# `forja use`

[← 返回总览](index.md)

**职责**：选择目标、构建配置、执行端和常用远程/同步配置。它是普通用户唯一的配置入口。

**公开语法**（进入主帮助）：
```
forja use [--workspace <path>] [--json]
forja use target --project <path> [--json]
forja use target --mode debug|release [--arch x86|x64] [--json]
forja use execution --local|--remote [--json]
forja use sync --server <id> --remote-path <path> [--json]
forja use remote --server <id> --remote-path <path> [--json]
```

**高级语法**（进入高级帮助，不进入普通 nextActions）：
```
forja use qt --qt-path <path> [--vs-dev-shell <path>] [--qmake-target <name>] [--qmake-args <args>] [--json]
forja use sdk --vs-dev-cmd <path> [--json]
forja use sync --enable|--disable [--json]
forja use remote workspace set --mode legacy|staged [--path <remoteWorkspace>] [--profile <name>] [--json]
forja use remote workspace clear [--json]
forja use remote repo set --local <name> --remote <name> --role primary|mapped|remote-only|existing-remote|skip [--path <remotePath>] [--baseline auto|status-only] [--overlay true|false] [--mount symlink] [--asset local[=remote]] [--json]
forja use remote repo remove --local <name> [--json]
forja use remote repo clear [--json]
forja use remote forja-bin set --path <remoteForjaBin> [--json]
forja use remote forja-bin clear [--json]
forja use remote build-order set <qt:build|qt:clean|qt:qmake|sdk:build|sdk:rebuild|sdk:clean>... [--json]
forja use remote build-order clear [--json]
forja use remote transfer set --server <id> --path <deployPath> --artifact <path>... [--json]
forja use remote transfer clear [--json]
```

低频高级配置仍归 `use`，但只出现在高级帮助和配置 UI，不进入普通 nextActions。

## 命令边界

| 问题 | 归属 |
|------|------|
| 选择 Qt/SDK 目标 | `forja use target --project <path>` |
| 选择 mode/arch | `forja use target --mode ... --arch ...` |
| 切换本地/远程执行 | `forja use execution --local` / `forja use execution --remote` |
| 配置 sync 使用的 server/path | `forja use sync --server <id> --remote-path <path>` |
| 配置 remote execution 使用的 server/path | `forja use remote --server <id> --remote-path <path>` |
| 启用/禁用 sync | `forja use sync --enable` / `forja use sync --disable` |
| 添加/修改/删除共享 server | `forja server add ...` / `forja server update <id> ...` / `forja server remove <id>` |
| 配置远程 repo/workspace/bin/build-order/transfer | `forja use remote repo/workspace/forja-bin/build-order/transfer ...` |
| 查看配置 | `forja list remote` |

## 行为

1. 无参数 + 交互终端：进入选择流程。
2. 有参数：只更新显式传入字段，保留其他字段。
3. `target --project` 推断 kind：`.pro` → qt，`.sln`/`Makefile` → sdk。
4. 不提供按类型切换入口；切换 active target 必须给出具体 `target --project`。
5. 切换 active target 只更新 `activeTarget` 指针和该类型的最近选择，不删除、不重置 Qt/SDK 各自的工具链或高级配置。
6. `target --mode` 可单独更新；`--arch` 可跟随更新。二者写入当前 active target 所属配置域，并刷新 activeTarget 快照。
7. `execution --local|--remote` 只更新 activeTarget.runAt。
8. `execution --remote` 不自动创建服务器配置。
9. 共享 server 列表由 `forja server add/update/remove` 管理；server 本身不属于 remote 或 sync 任一方专属。
10. `sync --server --remote-path` 只写 sync 配置，引用共享 server。
11. `remote --server --remote-path` 只写 remote execution 默认配置，引用共享 server。
12. `--qmake-target` 是旧 Qt `--target <name>` 的新归宿；`--project` 是项目路径，二者语义不可复用。
13. `use qt ...` 只写 Qt 专属配置；`use sdk ...` 只写 SDK 专属配置，互不清理对方配置。
14. `use sync --enable|--disable` 只更新 sync.enabled，不修改 server/path。
15. `remote repo/workspace/forja-bin/build-order/transfer set/clear` 负责远程高级配置。
16. 成功后返回 `nextActions: ["forja status"]`。

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja qt use --project <path>` | `forja use target --project <path>` |
| `forja qt use --mode <mode> --arch <arch>` | `forja use target --mode <mode> --arch <arch>` |
| `forja qt use --qt-path <path>` | `forja use qt --qt-path <path>` |
| `forja qt use --vs-dev-shell <path>` | `forja use qt --vs-dev-shell <path>` |
| `forja qt use --target <name>` | `forja use qt --qmake-target <name>` |
| `forja qt use --qmake-args <args>` | `forja use qt --qmake-args <args>` |
| `forja sdk use --project <path>` | `forja use target --project <path>` |
| `forja sdk use --mode <mode> --arch <arch>` | `forja use target --mode <mode> --arch <arch>` |
| `forja sdk use --vs-dev-cmd <path>` | `forja use sdk --vs-dev-cmd <path>` |
| `forja sync use --server <id> --remote-path <path>` | `forja use sync --server <id> --remote-path <path>` |
| `forja sync use --enable` | `forja use sync --enable` |
| `forja sync use --disable` | `forja use sync --disable` |
| `forja remote workspace use` | `forja use remote workspace set` |
| `forja remote workspace clear` | `forja use remote workspace clear` |
| `forja remote repo set/remove/clear` | `forja use remote repo set/remove/clear` |
| `forja remote forja-bin use/clear` | `forja use remote forja-bin set/clear` |
| `forja remote build-order set/clear` | `forja use remote build-order set/clear` |
| `forja remote transfer set/clear` | `forja use remote transfer set/clear` |
| `forja.remote.execution.pick` | `forja use` 交互流程 |
| `forja.remote.execution.local` | `forja use execution --local` |
| `forja.remote.execution.remote` | `forja use execution --remote` |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.config.openPage` | `forja.use` | 配置 UI 入口 |
| `forja.qt.selectProject` | `forja.use` | 统一目标选择；CLI/API 等价 `forja use target --project <path>` |
| `forja.sdk.selectProject` | `forja.use` | 统一目标选择；CLI/API 等价 `forja use target --project <path>` |
| `forja.sdk.showActions` | `forja.use` | SDK 选择入口 |
| `forja.remote.execution.pick` | `forja.use` | runAt 选择 |
| `forja.remote.execution.local` | `forja.use` | local 快捷动作；CLI/API 等价 `forja use execution --local` |
| `forja.remote.execution.remote` | `forja.use` | remote 快捷动作；CLI/API 等价 `forja use execution --remote` |

## Result

`use --json` 在修改后回显 `activeTarget` 和受影响的 `config` 摘要。

```ts
interface UseResult extends ForjaJsonResult {
    action: 'use';
    useScope: 'target' | 'execution' | 'qt' | 'sdk' | 'sync' | 'remote' | 'remote.workspace' | 'remote.repo' | 'remote.forjaBin' | 'remote.buildOrder' | 'remote.transfer' | 'lang';
    activeTarget?: ActiveTarget;
    config?: ConfigSummary;
    changed: string[];
    remote?: { workspaceMode?: string; remoteWorkspace?: string; profile?: string; repos?: object[]; remoteForjaBin?: string; buildOrder?: object[]; transfer?: object | null };
}
```

## 诊断码

| code | level | 触发条件 | nextAction |
|------|-------|----------|------------|
| `use.workspaceNotFound` | error | workspace 不存在 | 无 |
| `use.projectNotFound` | error | `--project` 指向不存在项目 | `forja list targets` |
| `use.cannotDetermineKind` | error | 无法由项目后缀推断 kind | `forja list targets` |
| `use.projectOutsideWorkspace` | error | `--project` 路径逃逸工作区 | `forja list targets` |
| `use.invalidMode` | error | mode 非 debug/release | `forja use target --mode debug` |
| `use.invalidArch` | error | arch 非 x86/x64 | `forja use target --arch x64` |
| `use.noActiveTargetSelected` | error | 无 active target 时更新 mode/arch | `forja use target --project <path>` |
| `use.cannotSpecifyBothLocalRemote` | error | execution 同时传 --local --remote | `forja use execution --local` |
| `use.mustSpecifyLocalOrRemote` | error | execution 未传 --local 或 --remote | `forja use execution --local` |
| `use.cannotSpecifyBothEnableDisable` | error | sync 同时传 --enable/--disable | `forja use sync --enable` |
| `use.serverNotFound` | error | server id 不存在 | `forja server` |
| `use.ambiguousServerName` | error | server 名称模糊匹配到多个 | `forja server` |
| `use.remotePathRequired` | error | 传 server 但缺 remote path | `forja use sync --server <id> --remote-path <path>` |
| `use.noServerConfigured` | error | 传 remote-path 但无 server | `forja use sync --server <name> --remote-path <path>` |
| `use.qmakeTargetCannotBeEmpty` | error | `--qmake-target` 为空 | `forja use qt --qmake-target <name>` |
| `use.workspaceSetRequiresMode` | error | workspace set 未传 --mode | `forja use remote workspace set --mode staged` |
| `use.repoSetRequires` | error | repo set 缺必填参数 | `forja use remote repo set --local <n> --remote <n> --role primary` |
| `use.invalidLocalRepoName` | error | repo local 名称非法 | `forja use remote repo set ...` |
| `use.invalidRemoteRepoName` | error | repo remote 名称非法 | `forja use remote repo set ...` |
| `use.repoRemoveRequiresLocal` | error | repo remove 缺 --local | `forja use remote repo remove --local <n>` |
| `use.forjaBinSetRequiresPath` | error | forja-bin set 缺 --path | `forja use remote forja-bin set --path <path>` |
| `use.buildOrderRequiresItem` | error | build-order set 无位置参数 | `forja use remote build-order set qt:build sdk:rebuild` |
| `use.invalidActionFor` | error | build-order action 不合法 | `forja use remote build-order set qt:build sdk:rebuild` |
| `use.transferSetRequiresServerPath` | error | transfer set 缺 server/path | `forja use remote transfer set --server <n> --path <p> --artifact <a>` |
| `use.transferSetRequiresArtifact` | error | transfer set 缺 artifact | `forja use remote transfer set ...` |
| `use.invalidLanguage` | error | lang 非 zh/en | `forja use lang zh` |
| `use.failedToSaveActiveTarget` | error | 写 activeTarget 失败 | `forja doctor` |
| `use.failedToSaveExecMode` | error | 写 execution mode 失败 | `forja use execution --local` |
| `use.failedToSaveLanguage` | error | 写语言配置失败 | `forja use lang zh` |

## 正常场景

```json
{
    "ok": true,
    "action": "use",
    "useScope": "target",
    "changed": ["qt.pinnedProject", "activeTarget"],
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "config": {
        "qt": { "configured": true, "project": "app/app.pro", "mode": "release", "arch": "x64" }
    },
    "nextAction": "forja status"
}
```

```json
{
    "ok": true,
    "action": "use",
    "useScope": "sync",
    "changed": ["sync.selectedServer", "sync.remotePath"],
    "config": {
        "sync": { "configured": true, "enabled": false, "selectedServer": "dev", "remotePath": "/home/xw/workspace/app" }
    },
    "nextAction": "forja status"
}
```

```json
{
    "ok": true,
    "action": "use",
    "useScope": "remote",
    "changed": ["remote.selectedServer", "remote.remotePath"],
    "config": {
        "remote": { "configured": true, "server": "dev", "remotePath": "/home/xw/workspace/app" }
    },
    "nextAction": "forja status"
}
```

## 异常场景

```json
{
    "ok": false,
    "action": "use",
    "useScope": "target",
    "changed": [],
    "diagnostics": [
        { "level": "error", "message": "Cannot determine project kind from: thirdparty/project.txt. Expected .pro, .sln, Makefile, or CMakeLists.txt" }
    ],
    "nextAction": "forja list targets"
}
```

## 文本输出

```
target updated
  Target: qt app/app.pro release x64 local
  Changed: qt.pinnedProject, activeTarget
Next:
  forja status
```

## 验证点

- `forja use target --project app.pro --json` 推断 `kind=qt`。
- `forja use target --project project.sln --json` 推断 `kind=sdk`。
- `forja use qt --qmake-target MyApp --json` 保存旧 Qt TARGET 覆盖语义。
- 切换 Qt/SDK active target 不删除另一类已保存配置。
- `forja use execution --remote --json` 不创建 server。
- `forja use sync --server <id> --remote-path <path> --json` 只写 sync server/path。
- `forja use remote --server <id> --remote-path <path> --json` 只写 remote execution server/path。
- `forja use sync --enable|--disable --json` 只切换 sync.enabled，不清 server/path。
- `forja use remote repo/build-order/transfer --json` 覆盖旧 remote 高级配置。
