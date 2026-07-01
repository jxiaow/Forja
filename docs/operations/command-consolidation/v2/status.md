# `forja status`

[← 返回总览](index.md)

**职责**：轻量只读状态查看。不做主动 SSH 探测、不做完整工具链探测、不修改配置。

**语法**：
```
forja status [--workspace <path>] [--json] [--lang <locale>]
```

**行为**：
1. 解析 workspace。
2. 读取 active target 元数据。
3. 读取 readiness 判断所需的最小设置，不返回完整配置摘要。
4. 无 active target 时：扫描候选数量，不猜测，返回 `forja list` + `forja use target --project <path>`。
5. 有 active target 时：验证项目存在、mode/arch 有效、runAt 配置完整。
6. `runtime` 字段始终返回，读取本地 runState 文件（轻量操作）。
7. `nextAction` 可提示 `forja list config` 查看配置、`forja use target --project <path>` 切换目标、`forja use qt|sdk ...` 修改配置。
8. status 只使用本地可读配置、缓存的 remote metadata、已有 lock/runState 摘要；不会为了判断状态主动发起 SSH、上传、bootstrap 或远程命令。需要实时 SSH/版本/路径可达性验证时指向 `forja doctor --remote`。

**吸收的旧命令**：
`forja qt status`、`forja sdk status`、`forja remote status`、`forja sync status`、`forja qt ps`、`forja remote qt ps`

**注意**：以下旧命令已归入 `forja list remote`（纯配置列举）：
`forja remote workspace status`、`forja remote forja-bin status`、`forja remote build-order status`、`forja remote transfer status`

**与 `list` 的边界**：
- `status` 回答"能不能用"，只输出 readiness 判断所需的最小摘要（server/remotePath/workspaceMode）。
- `status` 可以在 `nextAction` 中提示查看或切换配置的命令，但不展开配置内容。
- `list config` 回答"当前保存了哪些配置摘要"，输出 Qt/SDK/Sync/Remote 配置摘要。
- `list remote` 回答"配了什么"，输出全部远程配置细节（workspace/bin/build-order/transfer/repos）。
- `list targets/env/servers/remote` 回答可选项和专项明细。

**VSCode 映射**：

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.remote.status` | `forja.status` | 远程 readiness 归统一 status |
| `forja.remote.qt.ps` | `forja.status` | runtime 区域 |
| `forja.remote.transfer.status` | `forja.list` / `forja.status` | 纯配置详情归 list，readiness 摘要归 status |
| `forja.remote.workbench` | `forja.status` / QuickPick | 工作台入口收敛为状态 + 操作建议 |

**Result**：
```ts
interface StatusResult extends ForjaJsonResult {
    action: 'status';
    readiness: Readiness;
    toolchain?: ToolchainSummary;
    remote?: RemoteStatusSummary;
    sync?: SyncStatusSummary;
    runtime?: RuntimeState;
    nextAction?: string;
}

interface ToolchainSummary {
    qt?: { path: string; version?: string };
    vs?: { path: string; version?: string };
    jom?: string;              // Windows only
    make?: boolean;            // POSIX only
}

interface RemoteStatusSummary {
    runAt: 'local' | 'remote';
    server?: { id: string; name: string; host: string };
    remotePath?: string;
    remoteForjaBin?: string;
    workspaceMode?: 'legacy' | 'staged';
}

interface SyncStatusSummary {
    enabled: boolean;
    server?: { id: string; name: string; host: string };
    remotePath?: string;
}
```

**Readiness 语义**：

| 维度 | ready | configured | blocked | missing | unknown | not-selected |
|------|-------|------------|---------|---------|---------|--------------|
| target | 项目存在、配置完整 | 有配置但未深度验证 | 配置有但有问题（如 Makefile 不匹配） | 项目文件不存在 | 无法判断（配置损坏） | 未选择 |
| toolchain | Qt/VS/jom/make 就绪 | 有路径但未验证可用性 | 路径无效或版本不对 | 缺少工具链 | 无法判断 | — |
| sync | server + remotePath 完整 | 有配置但未验证 SSH | 配置有阻塞（如服务器被删） | 缺少 server/path | 无法判断 | 未配置 |
| remote | SSH + forja + path 就绪 | 有配置但未连接 | SSH/forja 失败或被锁 | 缺少 server | 无法判断 | runAt=local |
| runtime | 进程运行中 | — | — | — | 无法查询 | 未运行（无进程时） |

**Status 诊断表**：

| key | level | EN message | ZH message |
|-----|-------|-----------|-----------|
| `sts.workspaceNotFound` | error | Workspace does not exist: {path} | Workspace 不存在: {path} |
| `sts.configCorrupted` | error | Config file parse failed: {file} — {detail} | 配置文件解析失败: {file} — {detail} |
| `noActiveTarget` | warning | No active target selected | 未选择 active target |
| `sts.targetsFound` | info | Found {qtCount} Qt and {sdkCount} SDK targets, none selected | 发现 {qtCount} 个 Qt 目标和 {sdkCount} 个 SDK 目标，未选择 |
| `sts.projectFileMissing` | error | Project file does not exist: {project} | 项目文件不存在: {project} |
| `sts.makefileMismatch` | warning | Makefile does not match current config ({diff}) | Makefile 与当前配置不匹配（{diff}） |
| `notInitialized` | warning | Not initialized, no config found | 未初始化，未找到任何配置 |
| `qtNotFound` | error | Qt not found at configured path: {path} | Qt 路径无效或不存在: {path} |
| `vsNotFoundDetail` | error | VS dev environment not found (vsDevShell) | 未找到 VS 开发环境 (vsDevShell) |
| `jomNotFound` | warning | jom not found (optional, recommended for faster builds) | 未找到 jom（可选，推荐安装以加速构建） |
| `makeNotFound` | error | make not found | 未找到 make 工具 |
| `remoteNoServer` | error | runAt=remote but no server configured | runAt=remote 但未配置服务器和远程路径 |
| `remoteForjaBinDefault` | info | Remote Forja bin not configured, will use default | 远程 Forja 二进制未配置，将使用默认值 |
| `remotePathNotConfigured` | error | Remote path not configured: {path} | 未配置远程路径: {path} |
| `sts.syncServerNotFound` | error | Sync server "{server}" does not exist | 同步服务器 "{server}" 不存在 |
| `noSyncServer` | warning | No sync server added | 未添加同步服务器 |
| `sts.syncNotEnabled` | info | Sync not configured; configure with forja use sync for remote builds | 同步未配置，远程构建可用 forja use sync 配置 |

**正常场景**：

_空 workspace_：
```json
{
    "ok": false,
    "action": "status",
    "readiness": {
        "target": "not-selected",
        "toolchain": "unknown",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "diagnostics": [
        { "level": "warning", "message": "No active target selected", "fix": "forja setup" }
    ],
    "nextAction": "forja setup"
}
```

_Qt 项目就绪（本地）_：
```json
{
    "ok": true,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "local"
    },
    "toolchain": {
        "qt": { "path": "C:/Qt/5.15.2/msvc2019", "version": "5.15.2" },
        "vs": { "path": "C:/Program Files/.../vcvarsall.bat", "version": "2019" },
        "jom": "C:/Qt/Tools/QtCreator/bin/jom.exe"
    },
    "nextAction": "forja build"
}
```

_SDK 项目 + Remote_：
```json
{
    "ok": true,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "ready",
        "remote": "ready"
    },
    "activeTarget": {
        "kind": "sdk",
        "project": "project.sln",
        "mode": "release",
        "arch": "x64",
        "runAt": "remote"
    },
    "toolchain": {
        "vs": { "path": "C:/Program Files/.../vcvarsall.bat", "version": "2022" }
    },
    "remote": {
        "runAt": "remote",
        "server": { "id": "srv1", "name": "dev-server", "host": "192.168.1.10" },
        "remotePath": "/home/user/project",
        "remoteForjaBin": "/home/user/.forja/bin/forja",
        "workspaceMode": "legacy"
    },
    "sync": {
        "enabled": true,
        "server": { "id": "srv1", "name": "dev-server", "host": "192.168.1.10" },
        "remotePath": "/home/user/project"
    },
    "nextAction": "forja build"
}
```

_有运行中进程_：
```json
{
    "ok": true,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "not-selected",
        "remote": "not-selected",
        "runtime": "ready"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "local"
    },
    "runtime": {
        "running": true,
        "pid": 12345,
        "executablePath": "/path/to/build/debug/myapp.exe",
        "logFile": "~/.forja/logs/myapp.log",
        "runAt": "local"
    },
    "nextAction": "forja stop"
}
```

**异常场景**：

_Workspace 不存在_：
```json
{
    "ok": false,
    "action": "status",
    "readiness": {
        "target": "unknown",
        "toolchain": "unknown",
        "sync": "unknown",
        "remote": "unknown"
    },
    "diagnostics": [
        { "level": "error", "message": "Workspace does not exist: /path/to/workspace", "params": { "path": "/path/to/workspace" } }
    ],
    "nextAction": "forja status --workspace <path>"
}
```

_从未初始化_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "not-selected",
        "toolchain": "unknown",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "diagnostics": [
        { "level": "warning", "message": "Not initialized, no config found", "fix": "forja setup" }
    ],
    "nextAction": "forja setup"
}
```

_项目文件被删除_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "missing",
        "toolchain": "ready",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "local"
    },
    "diagnostics": [
        {
            "level": "error",
            "message": "Project file does not exist: app/app.pro",
            "hint": "The file may have been deleted or moved",
            "params": { "project": "app/app.pro" }
        }
    ],
    "nextAction": "forja list targets"
}
```

_工具链缺失_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "missing",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "local"
    },
    "toolchain": {
        "qt": { "path": "C:/Qt/old-path" }
    },
    "diagnostics": [
        { "level": "error", "message": "Qt not found at configured path: C:/Qt/old-path", "hint": "Qt installation may have changed, reconfigure with forja use", "fix": "forja list env qt", "params": { "path": "C:/Qt/old-path" } },
        { "level": "error", "message": "VS dev environment not found (vsDevShell)", "hint": "Install Visual Studio and configure vcvarsall.bat", "fix": "forja list env vs" },
        { "level": "warning", "message": "jom not found (optional, recommended for faster builds)", "fix": "forja list env qt" }
    ],
    "nextAction": "forja list env qt"
}
```

_runAt=remote 但未配置服务器_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "not-selected",
        "remote": "missing"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "remote"
    },
    "remote": { "runAt": "remote" },
    "diagnostics": [
        { "level": "error", "message": "runAt=remote but no server configured" }
    ],
    "nextAction": "forja list servers"
}
```

_Sync 配置的服务器被删除_：
```json
{
    "ok": true,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "blocked",
        "remote": "not-selected"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "local"
    },
    "sync": { "enabled": true },
    "diagnostics": [
        { "level": "error", "message": "Sync server \"old-server\" does not exist", "hint": "Server was deleted, please re-select", "fix": "forja list servers", "params": { "server": "old-server" } }
    ],
    "nextAction": "forja list servers"
}
```

_混合 workspace 未选择_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "not-selected",
        "toolchain": "unknown",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "diagnostics": [
        { "level": "info", "message": "Found 2 Qt and 1 SDK targets, none selected", "fix": "forja list targets", "params": { "qtCount": "2", "sdkCount": "1" } }
    ],
    "nextAction": "forja list targets"
}
```

_配置文件损坏_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "unknown",
        "toolchain": "unknown",
        "sync": "unknown",
        "remote": "unknown"
    },
    "diagnostics": [
        { "level": "error", "message": "Config file parse failed: ~/.forja/projects/<hash(workspace:qt)>.json — Unexpected token } in JSON", "hint": "File may be corrupted, delete and re-run forja setup", "params": { "file": "~/.forja/projects/<hash(workspace:qt)>.json", "detail": "Unexpected token } in JSON" } }
    ],
    "nextAction": "forja setup"
}
```

_Makefile 与当前配置不匹配_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "blocked",
        "toolchain": "ready",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "debug",
        "arch": "x86",
        "runAt": "local"
    },
    "diagnostics": [
        { "level": "warning", "message": "Makefile does not match current config (mode: release→debug, arch: x64→x86)", "hint": "Re-run qmake to regenerate Makefile", "params": { "diff": "mode: release→debug, arch: x64→x86" } }
    ],
    "nextAction": "forja build qmake"
}
```

_SDK on POSIX 缺少 make_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "missing",
        "sync": "not-selected",
        "remote": "not-selected"
    },
    "activeTarget": {
        "kind": "sdk",
        "project": "Makefile",
        "mode": "release",
        "arch": "x64",
        "runAt": "local"
    },
    "toolchain": { "make": false },
    "diagnostics": [
        { "level": "error", "message": "make not found", "hint": "Install build-essential or equivalent toolchain", "fix": "forja doctor" }
    ],
    "nextAction": "forja doctor"
}
```

_无运行记录_：
```json
{
    "ok": true,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "not-selected",
        "remote": "not-selected",
        "runtime": "not-selected"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "local"
    },
    "runtime": {
        "running": false,
        "runAt": "local"
    },
    "nextAction": "forja build"
}
```

**文本输出**（无 `--json` 时）：

_空 workspace_：
```
Forja status
Workspace: /path/to/workspace
Readiness: target=not-selected toolchain=unknown sync=not-selected remote=not-selected
Warning: No active target selected
Next:
  forja setup
```

_Qt 项目就绪（本地）_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=ready toolchain=ready sync=not-selected remote=not-selected
Toolchain: Qt 5.15.2, VS 2019, jom
Next:
  forja build
```

_SDK 项目 + Remote_：
```
Forja status
Workspace: /path/to/workspace
Target: sdk project.sln release x86 remote
Readiness: target=ready toolchain=ready sync=ready remote=ready
Toolchain: VS 2022
Remote: dev-server (192.168.1.10), Forja 1.2.3
Sync: enabled → dev-server:/home/user/project
Next:
  forja build
```

_有运行中进程_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=ready toolchain=ready sync=not-selected remote=not-selected runtime=ready
Runtime: running (pid 12345)
  executable: /path/to/build/release/myapp.exe
  log: ~/.forja/logs/myapp.log
Next:
  forja stop
```

_从未初始化_：
```
Forja status
Workspace: /path/to/workspace
Readiness: target=not-selected toolchain=unknown sync=not-selected remote=not-selected
Warning: Not initialized, no config found
Next:
  forja setup
```

_项目文件被删除_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=missing toolchain=ready sync=not-selected remote=not-selected
Error: Project file does not exist: app/app.pro
  hint: The file may have been deleted or moved
Next:
  forja list targets
```

_工具链缺失_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=ready toolchain=missing sync=not-selected remote=not-selected
Error: Qt not found at configured path: C:/Qt/old-path
  hint: Qt installation may have changed, reconfigure with forja use
Error: VS dev environment not found (vsDevShell)
  hint: Install Visual Studio and configure vcvarsall.bat
Warning: jom not found (optional, recommended for faster builds)
Next:
  forja list env qt
```

_runAt=remote 但未配置服务器_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 remote
Readiness: target=ready toolchain=ready sync=not-selected remote=missing
Error: runAt=remote but no server configured
Next:
  forja list servers
```

_Sync 配置的服务器被删除_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=ready toolchain=ready sync=blocked remote=not-selected
Error: Sync server "old-server" does not exist
  hint: Server was deleted, please re-select
Next:
  forja list servers
```

_混合 workspace 未选择_：
```
Forja status
Workspace: /path/to/workspace
Readiness: target=not-selected toolchain=unknown sync=not-selected remote=not-selected
Info: Found 2 Qt and 1 SDK targets, none selected
Next:
  forja list targets
```

_配置文件损坏_：
```
Forja status
Workspace: /path/to/workspace
Readiness: target=unknown toolchain=unknown sync=unknown remote=unknown
Error: Config file parse failed: ~/.forja/projects/<hash(workspace:qt)>.json — Unexpected token } in JSON
  hint: File may be corrupted, delete and re-run forja setup
Next:
  forja setup
```

_Makefile 与当前配置不匹配_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro debug x86 local
Readiness: target=blocked toolchain=ready sync=not-selected remote=not-selected
Warning: Makefile does not match current config (mode: release→debug, arch: x64→x86)
  hint: Re-run qmake to regenerate Makefile
Next:
  forja build qmake
```

_SDK on POSIX 缺少 make_：
```
Forja status
Workspace: /path/to/workspace
Target: sdk Makefile release x86 local
Readiness: target=ready toolchain=missing sync=not-selected remote=not-selected
Error: make not found
  hint: Install build-essential or equivalent toolchain
Next:
  forja doctor
```

_无运行记录_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=ready toolchain=ready sync=not-selected remote=not-selected runtime=not-selected
Runtime: not running
Next:
  forja build
```

**`ok` 判定规则**：
- target/toolchain 为 `blocked`、`missing`、`unknown` → `ok: false`
- target 为 `not-selected` → `ok: false`
- remote 为 `blocked`、`missing` → `ok: false`
- `sync`、`runtime` 不影响 `ok` 值（sync 问题不阻塞本地构建）

**验证点**：

- `forja status --json` 在无 active target 时不猜测目标。
- `forja status --json` 始终返回 runtime 字段，且 runtime 不影响 `ok`。
- `forja status --json --lang zh` 只本地化 message/hint，不改变 readiness 枚举值和 fix 命令。
- runAt=remote 缺 server/path 时返回 `remote=missing` 并指向 `forja list servers` + `forja use remote --server`。
- `forja status --json` 不主动 SSH；远程深度检查（SSH 连通性、版本兼容、锁状态）由 `forja doctor --remote` 负责。
- 纯远程配置详情不从 status 展开，指向 `forja list remote`。
