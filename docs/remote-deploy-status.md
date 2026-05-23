# 远程状态与 Readiness 协议

本文补充 `docs/remote-deploy-v3.md` 中 `remote test`、`remote status`、target readiness 和远端 Qt/SDK 配置桥接命令的输出语义。

## 命令定位

`remote test` 和 `remote status` 不做同一件事：

| 命令 | 目的 | 默认退出语义 |
| --- | --- | --- |
| `compilot remote test` | 判断远程通道是否能用于后续动作 | 任一必需层失败则 `ok=false` |
| `compilot remote test --bootstrap` | 在 compilot 缺失/不兼容时允许执行 bootstrap 后再测试 | bootstrap 或复测失败则 `ok=false` |
| `compilot remote status` | 盘点当前远程配置、目标状态和下一步建议 | 查询本身成功则 `ok=true`，具体能力看 `overall` |
| `compilot remote unlock --lock-id <id> --force` | 删除匹配 lock-id 的远端 stale lock | 删除成功才 `ok=true` |
| `compilot remote qt/sdk status` | 在远端 workspace 下运行远端 Qt/SDK status | 返回 bridge 结果 |
| `compilot remote qt/sdk init/use` | 在远端初始化或选择 Qt/SDK 用户配置 | 返回 bridge 结果 |
| `compilot remote qt/sdk restore --repo <repo> -- <paths...>` | 路径级恢复远端 tracked 文件到远端当前 git HEAD，并同步清理 overlay/underlay state | 成功恢复并清理状态才 `ok=true` |

`remote status` 不应该因为 Qt 或 SDK 未初始化就作为命令失败。它应该返回 `overall=blocked` 或 `degraded`，并在 `targets` 和 `nextActions` 中说明下一步。

## Readiness Layers

readiness 按层级表达，后续动作按需选择需要的层。

| layer | 含义 | build/run 是否必需 |
| --- | --- | --- |
| `syncConfig` | 本地 sync enabled、selectedServer、remotePath 可解析 | 是 |
| `ssh` | 服务器可连，认证可完成 | 是 |
| `remotePlatform` | 远端是 POSIX-compatible shell，Node/npm 满足 bootstrap/运行要求 | 是 |
| `remotePath` | 远端工作区根存在或可创建，路径安全 | 是 |
| `remoteCompilot` | 远端 compilot 存在且版本兼容 | 是 |
| `repoDiscovery` | 本地和远端 repo 模式可判定 | 是 |
| `baselinePrecheck` | 本地分支、upstream、可拉取 commit 满足 branchSync 前提 | `git` repo 必需 |
| `targetQt` | 远端 `compilot qt status --json` ready | Qt build/run/qmake/clean 必需 |
| `targetSdk` | 远端 `compilot sdk status --json` ready | SDK build/rebuild/clean 必需 |
| `targetLock` | 远端 checkout 当前没有被其他 pipeline 持有 | 会修改 checkout 的动作必需 |

`remote test` 第一版只要求 `syncConfig`、`ssh`、`remotePlatform`、`remotePath`、`remoteCompilot`。它不跑 branchSync、不跑 sync、不要求 Qt/SDK ready。

`remote qt/sdk restore` 是显式路径级动作：它不做 build/run，不做大范围 reset/clean；restore 成功后必须清理命中的 overlay manifest 记录和对应 underlay backup，清理失败时返回失败，避免远端 state 与工作区事实不一致。

build/run/rebuild/qmake 的 pipeline 中需要显式 `targetReadiness` stage。readiness 失败时不进入 branchSync/sync。

## Status JSON

`compilot remote status --json` 返回快照结构：

```json
{
  "ok": true,
  "action": "status",
  "mode": "remote",
  "overall": "blocked",
  "server": "build-01",
  "remotePath": "/remote/workspace",
  "layers": [
    {
      "name": "remoteCompilot",
      "ok": true,
      "message": "compatible",
      "version": "1.2.3"
    },
    {
      "name": "targetQt",
      "ok": false,
      "message": "Qt project is not initialized on remote",
      "nextActions": ["compilot remote qt init"]
    }
  ],
  "targets": {
    "qt": {
      "ready": false,
      "nextActions": ["compilot remote qt init"]
    },
    "sdk": {
      "ready": true
    }
  },
  "repos": [
    {
      "name": "qt-app",
      "mode": "git",
      "branch": "dev",
      "baselinePrecheck": "ready"
    }
  ],
  "lock": {
    "locked": true,
    "lockId": "8b3c...",
    "owner": "cli",
    "stage": "sync",
    "startedAt": "2026-05-23T10:00:00.000Z"
  },
  "diagnostics": [],
  "nextActions": ["compilot remote qt init"]
}
```

`overall` 取值：

| value | 含义 |
| --- | --- |
| `ready` | transport、remote compilot、repo precheck 和已知 target 都可用 |
| `degraded` | 可查询，但存在 files-only、unknown untracked 或非阻塞 dirty |
| `blocked` | 至少一个常用动作无法继续，需要 next action |
| `unknown` | 查询被权限、超时或输出解析问题中断 |

## Test JSON

`compilot remote test --json` 是更窄的布尔结果：

```json
{
  "ok": false,
  "action": "test",
  "mode": "remote",
  "failedLayer": "remoteCompilot",
  "diagnostics": [
    {
      "level": "error",
      "message": "remote compilot is not installed"
    }
  ],
  "nextActions": ["compilot remote bootstrap"]
}
```

`remote test --bootstrap --json` 可以包含 bootstrap stage：

```json
{
  "ok": true,
  "action": "test",
  "mode": "remote",
  "stages": [
    { "stage": "bootstrap", "ok": true },
    { "stage": "remoteCompilot", "ok": true }
  ],
  "diagnostics": []
}
```

## Unlock JSON

`unlock` 是显式破坏性动作，只清理 lock，不 kill 远端进程，不修改 overlay、underlay 或 run-state。

```json
{
  "ok": true,
  "action": "unlock",
  "mode": "remote",
  "lockId": "8b3c...",
  "targetId": "<targetId>",
  "removed": true,
  "diagnostics": []
}
```

失败规则：

- 缺少 `--force` 时失败
- 缺少 `--lock-id` 时失败
- lock-id 不匹配时失败
- lock 不存在时 `ok=true`、`removed=false`，并返回 warning

## Target Readiness Stage

build/run pipeline 中 target readiness 失败时返回 pipeline JSON：

```json
{
  "ok": false,
  "action": "build",
  "target": "qt",
  "mode": "remote",
  "stages": [
    {
      "stage": "targetReadiness",
      "ok": false,
      "target": "qt",
      "message": "remote Qt is not initialized",
      "nextActions": ["compilot remote qt init"]
    }
  ],
  "diagnostics": [
    {
      "level": "error",
      "message": "remote Qt is not initialized"
    }
  ],
  "nextActions": ["compilot remote qt init"]
}
```

## Qt/SDK Bridge Commands

`remote qt/sdk status/init/use` 是 bridge 命令。它们解析本地 sync target，通过 SSH 在远端 workspace 下执行对应的远端 compilot 命令。

参数规则：

- `compilot remote qt use --mode release --arch x64`
- `compilot remote qt use --project app.pro`
- `compilot remote sdk use -- <sdk-specific args>`

remote CLI 只消费 `remote`、`qt|sdk`、`status|init|use` 这三段和 remote 自己的通用参数；其余参数原样传给远端 `compilot qt|sdk`。

远端实际执行必须同时满足：

- cwd 是 `<sync.remotePath>`
- 远端命令包含 `--workspace <sync.remotePath>`
- `--json` 由 wrapper 在 JSON 模式下追加，避免远端输出不可解析
- 不把本地 workspace path 传给远端 Qt/SDK CLI

JSON wrapper：

```json
{
  "ok": true,
  "action": "use",
  "target": "qt",
  "mode": "remote",
  "remoteCommand": "compilot qt use --mode release --json",
  "result": {
    "ok": true,
    "action": "use"
  },
  "diagnostics": [],
  "nextActions": ["compilot remote qt status"]
}
```

非 JSON 模式直接展示远端命令文本输出，并在失败时追加本地 remote 诊断和 next action。
