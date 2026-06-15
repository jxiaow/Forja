# `forja init`

[← 返回总览](index.md)

**职责**：首次初始化。检测工具链路径并保存无歧义配置，不替用户做模糊选择。重复执行安全。

**语法**：
```
forja init [--workspace <path>] [--remote] [--plan] [--json]
```

**行为**：
1. 扫描 Qt 目标（.pro）。
2. 扫描 SDK 目标（.sln/Makefile）。
3. 发现可用工具链路径（Qt/VS/jom/make）用于保存默认值 — 仅发现路径，不做健康验证（健康验证归 `doctor`）。
4. 保存 toolchain 默认值（Qt path、VS path、jom path）。
5. 保存 mode/arch 默认值。mode 默认 `release`；arch 根据平台决定（Windows 默认 `x86`，其他平台默认 `x64`）。
6. 整个 workspace 只有一个目标时保存为 active target。
7. 多个目标或混合 Qt+SDK 时不选择，next actions 指向 `forja list` + `forja use`。
8. 零个目标时仅保存工具链默认值，next action 指向 `forja list`。
9. `--remote` 通过 bridge 在远端执行初始化。需要已配置 server；若远端缺少 Forja bin，next action 指向 `forja doctor fix --remote`。

**幂等性**：重复执行安全。已保存的用户选择不覆盖，仅填充缺失项。

**`--plan`**：输出"将检测到什么、将保存什么"，不写入配置。

**吸收的旧命令**：
`forja qt init`、`forja sdk init`、`forja remote qt init`、`forja remote sdk init`

**不吸收**：
`forja remote bootstrap`（部署 Forja bin）→ `forja doctor fix --remote`

**Result**：
```ts
interface InitResult extends ForjaJsonResult {
    action: 'init';
    mode: 'local' | 'remote';
    detected: {
        qtTargets: number;
        sdkTargets: number;
        toolchain: { qt?: boolean; vs?: boolean; jom?: boolean; make?: boolean };
    };
    saved?: { mode?: string; arch?: string; toolchain?: string[] };
    ambiguous?: boolean;  // true when multiple targets or mixed Qt+SDK
    plan?: CommandPlan;
}
```

**实现细节**：

### `--remote` Bridge 命令构造

`forja init --remote` 实际执行的远端命令格式：

```bash
cd <remotePath> && <remoteForjaBin> <target> init --workspace <remotePath> --json
```

- `<target>`：根据本地 active target 的 `kind` 决定（`qt` 或 `sdk`）。若未设置，默认 `qt`。
- `<remoteForjaBin>`：来自 `RemoteSettings.remoteForjaBin`，默认 `$HOME/.forja/bin/forja`。
- 超时：默认 120 秒（与 bridge 默认值一致）。

### ActiveTarget 存储

单目标自动保存时，activeTarget 存储在：

```
~/.forja/projects/<workspace-hash>/activeTarget.json
```

格式：

```json
{
    "kind": "qt",
    "project": "app/app.pro",
    "mode": "release",
    "arch": "x86",
    "runAt": "local"
}
```

同时向后兼容写入旧设置文件（`~/.forja/projects/<workspace-hash>:qt.json` 的 `pinnedProject` 字段）。

**Init 诊断码表**：

| code | level | EN message | ZH message |
|------|-------|-----------|-----------|
| `init.workspaceNotFound` | error | Workspace does not exist: {path} | Workspace 不存在: {path} |
| `init.noTargets` | info | No Qt or SDK targets found, only toolchain defaults saved | 未找到 Qt 或 SDK 目标，仅保存工具链默认值 |
| `init.multipleTargets` | info | Found {count} targets, not auto-selecting | 发现 {count} 个目标，未自动选择 |
| `init.mixedTargets` | info | Found {qtCount} Qt and {sdkCount} SDK targets, not auto-selecting | 发现 {qtCount} 个 Qt 目标和 {sdkCount} 个 SDK 目标，未自动选择 |
| `init.toolchainQtMissing` | warning | Qt installation not detected | 未检测到 Qt 安装 |
| `init.toolchainVsMissing` | warning | Visual Studio installation not detected | 未检测到 Visual Studio 安装 |
| `init.toolchainMakeMissing` | warning | make not detected | 未检测到 make 工具 |
| `init.toolchainJomMissing` | warning | jom not detected (optional, recommended for faster Qt builds on Windows) | 未检测到 jom（可选，推荐安装以加速 Qt 构建） |
| `init.targetKindMismatch` | error | --kind sdk specified but only Qt targets found | 指定 --kind sdk 但仅找到 Qt 目标 |
| `init.configWriteFailed` | error | Failed to write configuration: {detail} | 写入配置失败: {detail} |
| `init.remoteNoServer` | error | No server configured for remote init | 未配置服务器，无法执行远程初始化 |
| `init.remoteForjaMissing` | error | Remote Forja bin not installed | 远端 Forja 未安装 |
| `init.remoteBridgeFailed` | error | Remote bridge execution failed: {detail} | 远端 bridge 执行失败: {detail} |
| `init.alreadyInitialized` | info | Configuration already exists, only filling missing items | 配置已存在，仅填充缺失项 |

**正常场景**：

_单目标 Qt workspace_：
```json
{
    "ok": true,
    "action": "init",
    "mode": "local",
    "workspace": "/path/to/workspace",
    "detected": {
        "qtTargets": 1,
        "sdkTargets": 0,
        "toolchain": { "qt": true, "vs": true, "jom": true }
    },
    "saved": {
        "mode": "release",
        "arch": "x86",
        "toolchain": ["qtPath", "vsInstall", "jomPath"]
    },
    "activeTarget": {
        "kind": "qt",
        "project": "app/app.pro",
        "mode": "release",
        "arch": "x86",
        "runAt": "local"
    },
    "nextActions": ["forja build"]
}
```

_多目标混合 workspace_：
```json
{
    "ok": true,
    "action": "init",
    "mode": "local",
    "workspace": "/path/to/workspace",
    "detected": {
        "qtTargets": 2,
        "sdkTargets": 1,
        "toolchain": { "qt": true, "vs": true, "jom": true }
    },
    "saved": {
        "mode": "release",
        "arch": "x86",
        "toolchain": ["qtPath", "vsInstall", "jomPath"]
    },
    "ambiguous": true,
    "diagnostics": [
        { "code": "init.mixedTargets", "level": "info", "message": "Found 2 Qt and 1 SDK targets, not auto-selecting", "params": { "qtCount": "2", "sdkCount": "1" } }
    ],
    "nextActions": ["forja list", "forja use --target <project>"]
}
```

_零目标 workspace_：
```json
{
    "ok": true,
    "action": "init",
    "mode": "local",
    "workspace": "/path/to/workspace",
    "detected": {
        "qtTargets": 0,
        "sdkTargets": 0,
        "toolchain": { "qt": false, "vs": true }
    },
    "saved": {
        "toolchain": ["vsInstall"]
    },
    "diagnostics": [
        { "code": "init.noTargets", "level": "info", "message": "No Qt or SDK targets found, only toolchain defaults saved" }
    ],
    "nextActions": ["forja list"]
}
```

_重复执行（幂等）_：
```json
{
    "ok": true,
    "action": "init",
    "mode": "local",
    "workspace": "/path/to/workspace",
    "detected": {
        "qtTargets": 1,
        "sdkTargets": 0,
        "toolchain": { "qt": true, "vs": true, "jom": true }
    },
    "saved": {},
    "diagnostics": [
        { "code": "init.alreadyInitialized", "level": "info", "message": "Configuration already exists, only filling missing items" }
    ],
    "nextActions": ["forja status"]
}
```

_`--plan` 预览_：
```json
{
    "ok": true,
    "action": "init",
    "mode": "local",
    "plan": {
        "mode": "dryRun",
        "willWrite": [".forja/qt.json"],
        "willSave": {
            "qtPath": "C:/Qt/5.15.2/msvc2019",
            "vsInstall": "C:/Program Files/Microsoft Visual Studio/2019/Professional",
            "jomPath": "C:/Qt/Tools/QtCreator/bin/jom.exe",
            "mode": "release",
            "arch": "x86",
            "pinnedProject": "app/app.pro"
        }
    },
    "nextActions": ["forja init"]
}
```

**异常场景**：

_Workspace 不存在_：
```json
{
    "ok": false,
    "action": "init",
    "mode": "local",
    "diagnostics": [
        { "code": "init.workspaceNotFound", "level": "error", "message": "Workspace does not exist: /path/to/workspace", "params": { "path": "/path/to/workspace" } }
    ],
    "nextActions": []
}
```

_工具链缺失_：
```json
{
    "ok": true,
    "action": "init",
    "mode": "local",
    "workspace": "/path/to/workspace",
    "detected": {
        "qtTargets": 1,
        "sdkTargets": 0,
        "toolchain": { "qt": false, "vs": true, "jom": false }
    },
    "saved": {
        "mode": "release",
        "arch": "x86",
        "toolchain": ["vsInstall"]
    },
    "diagnostics": [
        { "code": "init.toolchainQtMissing", "level": "warning", "message": "Qt installation not detected", "hint": "Install Qt and re-run forja init, or use forja use --qt-path to specify manually" },
        { "code": "init.toolchainMakeMissing", "level": "warning", "message": "make not detected", "hint": "Install build-essential or equivalent toolchain" }
    ],
    "nextActions": ["forja list env", "forja use --qt-path <path>"]
}
```

_`--remote` 未配置 server_：
```json
{
    "ok": false,
    "action": "init",
    "mode": "remote",
    "diagnostics": [
        { "code": "init.remoteNoServer", "level": "error", "message": "No server configured for remote init", "hint": "Add a server first with forja list servers, then use forja use --server <id>" }
    ],
    "nextActions": ["forja list servers", "forja use --server <id> --remote-path <path>"]
}
```

_`--remote` 远端缺少 Forja bin_：
```json
{
    "ok": false,
    "action": "init",
    "mode": "remote",
    "diagnostics": [
        { "code": "init.remoteForjaMissing", "level": "error", "message": "Remote Forja bin not installed", "hint": "Deploy Forja to remote server first" }
    ],
    "nextActions": ["forja doctor fix --remote"]
}
```

_`--remote` bridge 执行失败_：
```json
{
    "ok": false,
    "action": "init",
    "mode": "remote",
    "diagnostics": [
        { "code": "init.remoteBridgeFailed", "level": "error", "message": "Remote bridge execution failed: SSH connection timeout", "hint": "Check server connectivity and credentials", "params": { "detail": "SSH connection timeout" } }
    ],
    "nextActions": ["forja doctor --remote"]
}
```

_`--kind sdk` 但只找到 Qt 目标_：
```json
{
    "ok": false,
    "action": "init",
    "mode": "local",
    "workspace": "/path/to/workspace",
    "detected": {
        "qtTargets": 1,
        "sdkTargets": 0,
        "toolchain": { "qt": true, "vs": true }
    },
    "diagnostics": [
        { "code": "init.targetKindMismatch", "level": "error", "message": "--kind sdk specified but only Qt targets found" }
    ],
    "nextActions": ["forja use --kind qt"]
}
```

_配置写入失败_：
```json
{
    "ok": false,
    "action": "init",
    "mode": "local",
    "workspace": "/path/to/workspace",
    "detected": {
        "qtTargets": 1,
        "sdkTargets": 0,
        "toolchain": { "qt": true, "vs": true }
    },
    "diagnostics": [
        { "code": "init.configWriteFailed", "level": "error", "message": "Failed to write configuration: Permission denied", "params": { "detail": "Permission denied" } }
    ],
    "nextActions": []
}
```

**文本输出**（无 `--json` 时）：

_单目标初始化成功_：
```
Forja init succeeded
Workspace: /path/to/workspace
Detected: 1 Qt target, toolchain: Qt/VS/jom
Saved: mode=release arch=x86 pinnedProject=app/app.pro
Active target: qt app/app.pro release x86 local
Next:
  forja build
```

_多目标未选择_：
```
Forja init succeeded
Workspace: /path/to/workspace
Detected: 2 Qt targets, 1 SDK target, toolchain: Qt/VS/jom
Saved: mode=release arch=x86
Not auto-selecting (multiple targets found)
Next:
  forja list
  forja use --target <project>
```

_零目标_：
```
Forja init succeeded
Workspace: /path/to/workspace
Detected: 0 targets, toolchain: VS
No targets found, only toolchain defaults saved
Next:
  forja list
```

_工具链缺失_：
```
Forja init succeeded
Workspace: /path/to/workspace
Detected: 1 Qt target, toolchain: VS (Qt: not found, jom: not found)
Saved: mode=release arch=x86
Warning: Qt installation not detected
Warning: make not detected
Next:
  forja list env
  forja use --qt-path <path>
```

_Workspace 不存在_：
```
Forja init failed
Error: Workspace does not exist: /path/to/workspace
```

_`--remote` 缺 bin_：
```
Forja init failed (remote)
Error: Remote Forja bin not installed
Next:
  forja doctor fix --remote
```

_重复执行（幂等）_：
```
Forja init succeeded
Workspace: /path/to/workspace
Detected: 1 Qt target, toolchain: Qt/VS/jom
Configuration already exists, only filling missing items
Next:
  forja status
```

_`--plan` 预览_：
```
Forja init plan (dry run)
Workspace: /path/to/workspace
Will detect: Qt targets, SDK targets, toolchain paths
Will save:
  mode=release arch=x86
  qtPath=C:/Qt/5.15.2/msvc2019
  vsInstall=C:/Program Files/Microsoft Visual Studio/2019/Professional
  jomPath=C:/Qt/Tools/QtCreator/bin/jom.exe
  pinnedProject=app/app.pro
Next:
  forja init
```

_`--remote` 缺 server_：
```
Forja init failed (remote)
Error: No server configured for remote init
  hint: Add a server first with forja list servers, then use forja use --server <id>
Next:
  forja list servers
  forja use --server <id> --remote-path <path>
```

_`--remote` bridge 失败_：
```
Forja init failed (remote)
Error: Remote bridge execution failed: SSH connection timeout
  hint: Check server connectivity and credentials
Next:
  forja doctor --remote
```

_`--kind sdk` 但只找到 Qt 目标_：
```
Forja init failed
Error: --kind sdk specified but only Qt targets found
Next:
  forja use --kind qt
```

_配置写入失败_：
```
Forja init failed
Error: Failed to write configuration: Permission denied
```

**`ok` 判定规则**：
- `mode: 'local'` 时：
  - 配置写入成功 → `ok: true`（即使工具链缺失、目标为 0 或多目标）
  - 配置写入失败 → `ok: false`
  - `--kind` 与扫描结果不匹配 → `ok: false`
- `mode: 'remote'` 时：
  - 任何 error 级别诊断 → `ok: false`
  - Bridge 执行成功且远端返回 `ok: true` → `ok: true`
  - Bridge 执行失败或远端返回 `ok: false` → `ok: false`
- warning 级别诊断不影响 `ok` 值
- `info` 级别诊断仅用于信息提示，不影响 `ok` 值
