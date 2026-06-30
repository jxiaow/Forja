# `forja build`

[← 返回总览](index.md)

**职责**：构建当前 active target。统一承接 Qt/SDK、本地/远程、普通构建/重建/qmake/rcc，不负责选择目标或修复环境。

**语法**：
```
forja build [fresh|qmake|rcc] [--workspace <path>] [--plan] [--json]
```

## 命令边界

| 问题 | 归属 |
|------|------|
| 当前目标是什么 | `forja status` / `forja use target --project <path>` |
| 有哪些可选项目 | `forja list` |
| 工具链能不能用 | `forja doctor` |
| Qt qmake/rcc/build | `forja build [qmake|rcc]` / `forja build` |
| SDK rebuild | `forja build fresh` |
| 清理产物 | `forja clean` |
| 构建后运行 | `forja run` |

## Action 矩阵

| 命令 | Qt 目标 | SDK 目标 |
|------|---------|----------|
| `forja build` | 必要时 qmake/rcc，然后 build | 正常 build |
| `forja build fresh` | clean + qmake + rcc + build | rebuild；若后端无 rebuild，退化为 clean + build |
| `forja build qmake` | 只跑 qmake | 失败：SDK 没有 qmake |
| `forja build rcc` | 只跑 rcc | 失败：SDK 没有 rcc |

## 路由规则

1. 读取 active target；缺失时不猜测目标，返回 `forja list` + `forja use target --project <path>`。
2. `runAt=local` 且 `kind=qt`：调用现有 Qt qmake/rcc/build 后端。
3. `runAt=local` 且 `kind=sdk`：调用现有 SDK build/rebuild 后端。
4. `runAt=remote`：先做 remote preflight、workspace prepare、lock，再通过 remote prepared action/bridge 调用远端后端。
5. `qmake`/`rcc` 只适用于 Qt target；SDK 下必须失败并给出 `build.actionUnsupported`。
6. `--plan` 不执行外部命令，只输出 `CommandPlan`；远程模式下也不建立 SSH mutation。
7. 构建失败保留后端退出码和关键错误摘要；不在 build 内自动执行 doctor/fix。

## 吸收的旧命令

| 旧命令 | 新命令 |
|--------|--------|
| `forja qt qmake` | `forja build qmake` |
| `forja qt rcc` | `forja build rcc` |
| `forja qt build` | `forja build` |
| `forja sdk build` | `forja build` |
| `forja sdk rebuild` | `forja build fresh` |
| `forja remote qt qmake` | `forja build qmake`（runAt=remote） |
| `forja remote qt build` | `forja build`（runAt=remote） |
| `forja remote sdk build` | `forja build`（runAt=remote） |
| `forja remote sdk rebuild` | `forja build fresh`（runAt=remote） |

## VSCode 映射

| 旧 Command ID | 新 Command ID | 说明 |
|---------------|---------------|------|
| `forja.qt.qmake` | `forja.build` | QuickPick 中选择 qmake |
| `forja.qt.rcc` | `forja.build` | QuickPick 中选择 rcc |
| `forja.qt.build` | `forja.build` | 直接构建当前目标 |
| `forja.sdk.build` | `forja.build` | 直接构建当前目标 |
| `forja.sdk.rebuild` | `forja.build` | QuickPick 中选择 fresh |
| `forja.remote.qt.build` | `forja.build` | activeTarget.runAt=remote |
| `forja.remote.qt.qmake` | `forja.build` | activeTarget.runAt=remote + qmake |
| `forja.remote.sdk.build` | `forja.build` | activeTarget.runAt=remote |
| `forja.remote.sdk.rebuild` | `forja.build` | activeTarget.runAt=remote + fresh |

## Result

```ts
interface BuildResult extends ForjaJsonResult {
    action: 'build';
    buildAction: 'default' | 'fresh' | 'qmake' | 'rcc';
    activeTarget?: ActiveTarget;
    plan?: CommandPlan;
    durationMs?: number;
    exitCode?: number;
    errors?: string[];
}
```

## 诊断码

| code | level | 触发条件 | nextActions |
|------|-------|----------|-------------|
| `build.targetNotSelected` | error | 没有 active target | `forja list`, `forja use target --project <path>` |
| `build.targetMissing` | error | active target 项目文件不存在 | `forja list`, `forja use target --project <path>` |
| `build.toolchainBlocked` | error | 本地工具链缺失或无效 | `forja doctor` |
| `build.remoteMissing` | error | runAt=remote 但 server/path/bin 缺失 | `forja list remote`, `forja use remote --server <id> --remote-path <path>` |
| `build.remoteBlocked` | error | SSH/lock/workspace prepare 失败 | `forja doctor --remote` |
| `build.actionUnsupported` | error | SDK 执行 qmake/rcc，或 Qt/SDK 不支持该 action | `forja build` |
| `build.commandFailed` | error | 后端命令返回非 0 | `forja doctor` |

## 正常场景

_Qt 默认构建_：
```json
{
    "ok": true,
    "action": "build",
    "buildAction": "default",
    "activeTarget": { "kind": "qt", "project": "app/app.pro", "mode": "release", "arch": "x64", "runAt": "local" },
    "durationMs": 1200,
    "exitCode": 0,
    "nextActions": ["forja run"]
}
```

_SDK fresh build_：
```json
{
    "ok": true,
    "action": "build",
    "buildAction": "fresh",
    "activeTarget": { "kind": "sdk", "project": "sdk/project.sln", "mode": "release", "arch": "x64", "runAt": "local" },
    "durationMs": 2600,
    "exitCode": 0,
    "nextActions": ["forja status"]
}
```

_Plan 模式_：
```json
{
    "ok": true,
    "action": "build",
    "buildAction": "qmake",
    "plan": {
        "mode": "dryRun",
        "commands": ["qmake app/app.pro -spec win32-msvc"],
        "willRun": ["qmake"]
    },
    "nextActions": ["forja build qmake"]
}
```

## 异常场景

_未选择目标_：
```json
{
    "ok": false,
    "action": "build",
    "buildAction": "default",
    "diagnostics": [
        { "code": "build.targetNotSelected", "level": "error", "message": "No active target selected" }
    ],
    "nextActions": ["forja list", "forja use target --project <path>"]
}
```

_SDK 执行 qmake_：
```json
{
    "ok": false,
    "action": "build",
    "buildAction": "qmake",
    "activeTarget": { "kind": "sdk", "project": "sdk/project.sln", "mode": "release", "arch": "x64", "runAt": "local" },
    "diagnostics": [
        { "code": "build.actionUnsupported", "level": "error", "message": "SDK targets do not support qmake" }
    ],
    "nextActions": ["forja build"]
}
```

## 文本输出

```
Forja build succeeded
Target: qt app/app.pro release x64 local
Duration: 1200ms
Next:
  forja run
```

```
Forja build failed (exit 2)
Target: sdk sdk/project.sln release x64 remote
Error: build command failed
Next:
  forja doctor --remote
```

## 验证点

- `forja build --json` 按 active target 分发到 Qt/SDK。
- `forja build fresh --json` 对 SDK 等价旧 `rebuild`。
- `forja build qmake --json` 对 Qt 可用，对 SDK 失败。
- `forja build rcc --json` 对 Qt 可用，对 SDK 失败。
- `forja build --plan --json` 不执行外部命令。
- runAt=remote 时只通过 remote 后端执行，不直接 import Qt/SDK 远端实现。
