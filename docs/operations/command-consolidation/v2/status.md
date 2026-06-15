# `forja status`

[← 返回总览](index.md)

**职责**：轻量只读状态查看。不做深度 SSH、不做完整工具链探测、不修改配置。

**语法**：
```
forja status [--process] [--workspace <path>] [--json] [--lang <locale>]
```

**行为**：
1. 解析 workspace。
2. 读取 active target 元数据。
3. 读取 Qt/SDK/Sync/Remote 设置摘要。
4. 无 active target 时：扫描候选数量，不猜测，返回 `forja list` + `forja use`。
5. 有 active target 时：验证项目存在、mode/arch 有效、runAt 配置完整。
6. `--process` 返回 `runtime` 字段；不传只给 readiness 摘要。

**吸收的旧命令**：
`forja qt status`、`forja sdk status`、`forja remote status`、`forja sync status`、`forja qt ps`、`forja remote qt ps`、`forja remote transfer status`、`forja remote workspace status`、`forja remote forja-bin status`、`forja remote build-order status`

**Result**：
```ts
interface StatusResult extends ForjaJsonResult {
    action: 'status';
    readiness: Readiness;
    toolchain?: ToolchainSummary;
    remote?: RemoteStatusSummary;
    sync?: SyncStatusSummary;
    runtime?: RuntimeState;    // 仅 --process
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
    remoteForjaVersion?: string;
    locked?: boolean;
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
| runtime | 进程运行中 | — | — | — | 无法查询 | 未运行（`--process` 无进程时） |

**Status 诊断码表**：

| code | level | EN message | ZH message |
|------|-------|-----------|-----------|
| `workspace.notFound` | error | Workspace does not exist: {path} | Workspace 不存在: {path} |
| `workspace.configCorrupt` | error | Config file parse failed: {file} — {detail} | 配置文件解析失败: {file} — {detail} |
| `target.notSelected` | warning | No active target selected | 未选择 active target |
| `target.mixedNotSelected` | info | Found {qtCount} Qt and {sdkCount} SDK targets, none selected | 发现 {qtCount} 个 Qt 目标和 {sdkCount} 个 SDK 目标，未选择 |
| `target.projectMissing` | error | Project file does not exist: {project} | 项目文件不存在: {project} |
| `target.makefileMismatch` | warning | Makefile does not match current config ({diff}) | Makefile 与当前配置不匹配（{diff}） |
| `toolchain.neverInit` | warning | Not initialized, no config found | 未初始化，未找到任何配置 |
| `toolchain.qtMissing` | error | Qt not found at configured path: {path} | Qt 路径无效或不存在: {path} |
| `toolchain.vsMissing` | error | VS dev environment not found (vsDevShell) | 未找到 VS 开发环境 (vsDevShell) |
| `toolchain.jomMissing` | warning | jom not found (optional, recommended for faster builds) | 未找到 jom（可选，推荐安装以加速构建） |
| `toolchain.makeMissing` | error | make not found | 未找到 make 工具 |
| `remote.serverMissing` | error | runAt=remote but no server configured | runAt=remote 但未配置服务器和远程路径 |
| `remote.sshFailed` | error | SSH connection failed: {detail} | SSH 连接失败: {detail} |
| `remote.forjaIncompatible` | error | Remote Forja version incompatible: {remote} (local {local}) | 远端 Forja 版本不兼容: {remote}（本地 {local}） |
| `remote.forjaMissing` | error | Remote Forja not installed | 远端 Forja 未安装 |
| `remote.locked` | warning | Remote locked: lockId={lockId}, owner={owner}, stage={stage} | 远端被锁定: lockId={lockId}, owner={owner}, stage={stage} |
| `remote.platformUnsupported` | error | Remote platform unsupported: {platform} | 远端平台不支持: {platform} |
| `remote.pathUnreachable` | error | Remote path unreachable: {path} | 远程路径不可用: {path} |
| `sync.serverDeleted` | error | Sync server "{server}" does not exist | 同步服务器 "{server}" 不存在 |
| `sync.notEnabled` | error | Remote sync not enabled | 远程同步未启用 |
| `sync.remotePathMissing` | error | Remote path not configured | 未配置远程路径 |
| `sync.neverConfigured` | warning | No sync server added | 未添加同步服务器 |

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
        { "code": "target.notSelected", "level": "warning", "message": "No active target selected" }
    ],
    "nextActions": ["forja init"]
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
    "nextActions": ["forja build"]
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
        "remoteForjaVersion": "1.2.3",
        "locked": false,
        "workspaceMode": "legacy"
    },
    "sync": {
        "enabled": true,
        "server": { "id": "srv1", "name": "dev-server", "host": "192.168.1.10" },
        "remotePath": "/home/user/project"
    },
    "nextActions": ["forja build"]
}
```

_`--process` 有运行中进程_：
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
        "logFile": "/path/to/.forja/logs/myapp.log",
        "runAt": "local"
    },
    "nextActions": ["forja stop"]
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
        { "code": "workspace.notFound", "level": "error", "message": "Workspace does not exist: /path/to/workspace", "params": { "path": "/path/to/workspace" } }
    ],
    "nextActions": []
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
        { "code": "toolchain.neverInit", "level": "warning", "message": "Not initialized, no config found" }
    ],
    "nextActions": ["forja init"]
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
            "code": "target.projectMissing",
            "level": "error",
            "message": "Project file does not exist: app/app.pro",
            "hint": "The file may have been deleted or moved",
            "params": { "project": "app/app.pro" }
        }
    ],
    "nextActions": ["forja list", "forja use --target <project>"]
}
```

_工具链缺失_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "configured",
        "toolchain": "blocked",
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
        { "code": "toolchain.qtMissing", "level": "error", "message": "Qt not found at configured path: C:/Qt/old-path", "hint": "Qt installation may have changed, reconfigure with forja use", "params": { "path": "C:/Qt/old-path" } },
        { "code": "toolchain.vsMissing", "level": "error", "message": "VS dev environment not found (vsDevShell)", "hint": "Install Visual Studio and configure vcvarsall.bat" },
        { "code": "toolchain.jomMissing", "level": "warning", "message": "jom not found (optional, recommended for faster builds)" }
    ],
    "nextActions": ["forja doctor", "forja use --qt-path <path>"]
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
        { "code": "remote.serverMissing", "level": "error", "message": "runAt=remote but no server configured" }
    ],
    "nextActions": ["forja list servers", "forja use --server <id> --remote-path <path>"]
}
```

_SSH 连接失败_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "configured",
        "remote": "blocked"
    },
    "activeTarget": {
        "kind": "sdk",
        "project": "project.sln",
        "mode": "release",
        "arch": "x64",
        "runAt": "remote"
    },
    "remote": {
        "runAt": "remote",
        "server": { "id": "srv1", "name": "dev-server", "host": "192.168.1.10" },
        "remotePath": "/home/user/project",
        "locked": false
    },
    "diagnostics": [
        { "code": "remote.sshFailed", "level": "error", "message": "SSH connection failed: Connection refused", "hint": "Check if the server is online and reachable", "params": { "detail": "Connection refused" } }
    ],
    "nextActions": ["forja doctor --remote"]
}
```

_Remote Forja 版本不兼容_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "ready",
        "remote": "blocked"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "remote"
    },
    "remote": {
        "runAt": "remote",
        "server": { "id": "srv1", "name": "dev-server", "host": "192.168.1.10" },
        "remotePath": "/home/user/project",
        "remoteForjaVersion": "0.9.0",
        "locked": false
    },
    "diagnostics": [
        { "code": "remote.forjaIncompatible", "level": "error", "message": "Remote Forja version incompatible: 0.9.0 (local 1.2.3)", "hint": "Redeploy Forja to the remote server", "params": { "remote": "0.9.0", "local": "1.2.3" } }
    ],
    "nextActions": ["forja doctor fix --remote"]
}
```

_Remote 被锁定_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "ready",
        "toolchain": "ready",
        "sync": "ready",
        "remote": "blocked"
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x64",
        "runAt": "remote"
    },
    "remote": {
        "runAt": "remote",
        "server": { "id": "srv1", "name": "dev-server", "host": "192.168.1.10" },
        "remotePath": "/home/user/project",
        "remoteForjaVersion": "1.2.3",
        "locked": true
    },
    "diagnostics": [
        { "code": "remote.locked", "level": "warning", "message": "Remote locked: lockId=abc123, owner=build, stage=compile", "hint": "If a build is stuck, force unlock with doctor", "params": { "lockId": "abc123", "owner": "build", "stage": "compile" } }
    ],
    "nextActions": ["forja doctor unlock abc123", "forja doctor unlock abc123 --force"]
}
```

_Sync 配置的服务器被删除_：
```json
{
    "ok": false,
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
        { "code": "sync.serverDeleted", "level": "error", "message": "Sync server \"old-server\" does not exist", "hint": "Server was deleted, please re-select", "params": { "server": "old-server" } }
    ],
    "nextActions": ["forja list servers", "forja use --server <id> --remote-path <path>"]
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
        { "code": "target.mixedNotSelected", "level": "info", "message": "Found 2 Qt and 1 SDK targets, none selected", "params": { "qtCount": "2", "sdkCount": "1" } }
    ],
    "nextActions": ["forja list", "forja use --target <project>"]
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
        { "code": "workspace.configCorrupt", "level": "error", "message": "Config file parse failed: .forja/qt.json — Unexpected token } in JSON", "hint": "File may be corrupted, delete and re-run forja init", "params": { "file": ".forja/qt.json", "detail": "Unexpected token } in JSON" } }
    ],
    "nextActions": ["forja init"]
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
        { "code": "target.makefileMismatch", "level": "warning", "message": "Makefile does not match current config (mode: release→debug, arch: x64→x86)", "hint": "Re-run qmake to regenerate Makefile", "params": { "diff": "mode: release→debug, arch: x64→x86" } }
    ],
    "nextActions": ["forja build qmake"]
}
```

_SDK on POSIX 缺少 make_：
```json
{
    "ok": false,
    "action": "status",
    "workspace": "/path/to/workspace",
    "readiness": {
        "target": "configured",
        "toolchain": "blocked",
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
        { "code": "toolchain.makeMissing", "level": "error", "message": "make not found", "hint": "Install build-essential or equivalent toolchain" }
    ],
    "nextActions": ["forja doctor"]
}
```

_`--process` 无运行记录_：
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
    "nextActions": ["forja run"]
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
  forja init
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

_`--process` 有运行中进程_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=ready toolchain=ready sync=not-selected remote=not-selected runtime=ready
Runtime: running (pid 12345)
  executable: /path/to/build/release/myapp.exe
  log: /path/to/.forja/logs/myapp.log
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
  forja init
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
  forja list
  forja use --target <project>
```

_工具链缺失_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=configured toolchain=blocked sync=not-selected remote=not-selected
Error: Qt not found at configured path: C:/Qt/old-path
  hint: Qt installation may have changed, reconfigure with forja use
Error: VS dev environment not found (vsDevShell)
  hint: Install Visual Studio and configure vcvarsall.bat
Warning: jom not found (optional, recommended for faster builds)
Next:
  forja doctor
  forja use --qt-path <path>
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
  forja use --server <id> --remote-path <path>
```

_SSH 连接失败_：
```
Forja status
Workspace: /path/to/workspace
Target: sdk project.sln release x86 remote
Readiness: target=ready toolchain=ready sync=configured remote=blocked
Error: SSH connection failed: Connection refused
  hint: Check if the server is online and reachable
Next:
  forja doctor --remote
```

_Remote Forja 版本不兼容_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 remote
Readiness: target=ready toolchain=ready sync=ready remote=blocked
Error: Remote Forja version incompatible: 0.9.0 (local 1.2.3)
  hint: Redeploy Forja to the remote server
Next:
  forja doctor fix --remote
```

_Remote 被锁定_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 remote
Readiness: target=ready toolchain=ready sync=ready remote=blocked
Warning: Remote locked: lockId=abc123, owner=build, stage=compile
  hint: If a build is stuck, force unlock with doctor
Next:
  forja doctor unlock abc123
  forja doctor unlock abc123 --force
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
  forja use --server <id> --remote-path <path>
```

_混合 workspace 未选择_：
```
Forja status
Workspace: /path/to/workspace
Readiness: target=not-selected toolchain=unknown sync=not-selected remote=not-selected
Info: Found 2 Qt and 1 SDK targets, none selected
Next:
  forja list
  forja use --target <project>
```

_配置文件损坏_：
```
Forja status
Workspace: /path/to/workspace
Readiness: target=unknown toolchain=unknown sync=unknown remote=unknown
Error: Config file parse failed: .forja/qt.json — Unexpected token } in JSON
  hint: File may be corrupted, delete and re-run forja init
Next:
  forja init
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
Readiness: target=configured toolchain=blocked sync=not-selected remote=not-selected
Error: make not found
  hint: Install build-essential or equivalent toolchain
Next:
  forja doctor
```

_`--process` 无运行记录_：
```
Forja status
Workspace: /path/to/workspace
Target: qt app/app.pro release x86 local
Readiness: target=ready toolchain=ready sync=not-selected remote=not-selected runtime=not-selected
Runtime: not running
Next:
  forja run
```

**`ok` 判定规则**：
- 任何 readiness 维度为 `blocked`、`missing`、`unknown` → `ok: false`
- 所有维度为 `ready`、`configured`、`not-selected` → `ok: true`
- `runtime` 不影响 `ok` 值
