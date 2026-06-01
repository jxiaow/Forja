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
| `compilot remote qt build/clean/qmake/run` | prepare 远端 workspace 后执行远端 Qt 动作 | prepare 和远端 action 都成功才 `ok=true` |
| `compilot remote qt stop/ps` | 直接桥接远端 Qt 后台运行状态管理，不做 branchSync/sync | bridge 成功才 `ok=true` |
| `compilot remote sdk build/rebuild/clean` | prepare 远端 workspace 后执行远端 SDK 构建类动作 | prepare 和远端 action 都成功才 `ok=true` |
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

## Real Remote Smoke

真实 SSH smoke 是发布前人工执行的 E2E 检查，不进入自动单测。仓库提供 runner：

当前状态（2026-05-25）：本地 compile、全量单测和 `build:cli` 已通过；`remote doctor` 已提供 readiness 体检摘要，`remote transfer status` 已支持本地配置校验和 plan 输出。由于当前没有可用真实远端环境，真实 SSH smoke 记录为后续环境自测项。拿到远端环境后必须执行本节推荐命令，并保留 `--json-dir` 产物用于回溯。

```bash
npm run remote:smoke -- --target qt --build --run-detach --stop
npm run remote:smoke -- --target qt --build --run-detach --stop --execute --yes
```

默认不执行 SSH，只打印计划。只有显式传入 `--execute` 时才调用本地已编译 CLI：

- `compilot remote doctor --json`
- `compilot remote status --json`
- `compilot remote test --json`
- `compilot remote build-order status --json`
- `compilot remote transfer status --json`
- 可选 `compilot remote test --bootstrap --json`
- `compilot remote qt|sdk status --json`
- 可选 `compilot remote qt|sdk build --json`
- 可选 `compilot remote qt run --detach --json`
- 可选 `compilot remote qt ps --json`
- 可选 `compilot remote qt stop --json`
- 最后再次 `compilot remote doctor --json`，确认没有 stale lock 或 readiness 退化

执行前提：

- 本地已执行 `npm run compile`，或通过 `--cli <path>` 指向可用 CLI
- 当前 workspace 已配置 sync server、selectedServer、remotePath
- 远端 workspace root 是多仓库根；本地分支/upstream 满足 baseline precheck
- 远端已有兼容 compilot，或传入 `--bootstrap --yes` 并且本地已有 bootstrap artifact
- Qt/SDK 远端配置已可由 `compilot remote qt|sdk status --json` 验证

安全约束：

- 执行 `--bootstrap`、`--build`、`--run-detach` 或 `--stop` 时必须同时传 `--yes`；dry-run 可省略
- runner 不执行 `remote unlock --force`、`remote restore`、`git reset`、`git clean`
- runner 不自动挑选 restore 路径，也不清理远端 preserved dirty 文件
- 失败时停在当前 step，保留远端诊断和 lock nextAction，人工确认后再处理

推荐记录：

```bash
npm run remote:smoke -- --workspace C:\Code\workspace\dev\qt_client --target both --build --run-detach --stop --execute --yes --json-dir /tmp/compilot-remote-smoke
```

`--json-dir` 只保存每个 step 的 stdout/stderr 和退出码，便于对照 pipeline JSON；它不是远端状态源。

手工排查时，`compilot remote status` 的普通文本输出会给出 server、remotePath、remoteCompilotBin、buildOrder、transfer 和 next action 摘要。JSON 模式仍是 AI/脚本集成的稳定入口。

## Remote Test Checklist

按从低风险到真实执行的顺序测试。每一步失败时先保留命令输出和 `--json-dir` 产物，不要直接执行 unlock、restore、reset 或 clean。

### 1. 本地静态与 CLI 基线

- `npm run compile` 通过，确认 `out/cli/index.js` 已更新。
- `node --test --test-reporter=spec out/test/remote*.test.js out/test/cliEntrySource.test.js out/test/statusBarLabels.test.js out/test/settingsIO.test.js out/test/serverStoreCrud.test.js` 通过。
- `compilot remote --help` 能看到 status、doctor、test、bootstrap、build-order、transfer、qt、sdk 等入口。

### 2. 本地配置与 dry-run

- `compilot remote status --json` 返回当前 server、remotePath、remoteCompilotBin、buildOrder、transfer 摘要。
- `compilot remote doctor --json` 能给出 readiness layers 和 nextActions。
- `compilot remote test --json` 在未配置或不可连接时返回可解释的 blocked/degraded 诊断。
- `compilot remote build-order status --json` 能读取当前构建顺序配置。
- `compilot remote transfer status --json` 在不连 SSH 时也能校验本地 transfer plan。
- `npm run remote:smoke -- --workspace C:\Code\workspace\dev\qt_client --target both --build --run-detach --stop` 只打印计划，不执行 SSH。

### 3. 远端连接与 bootstrap

- 配置 sync server、selectedServer、remotePath 后，`compilot remote test --json` 能验证 SSH、remotePath 和 remoteCompilot。
- 远端缺少 compilot 或版本不兼容时，执行 `compilot remote test --bootstrap --json` 先确认诊断。
- 准备好 artifact 后，再执行 `compilot remote test --bootstrap --yes --json`，确认 bootstrap 后复测通过。
- `compilot remote doctor --json` 不应留下 stale lock 或不可解释的 readiness 退化。

### 4. 远端 Qt / SDK 桥接

- `compilot remote qt status --json` 能在远端 workspace 下返回 Qt 状态。
- `compilot remote sdk status --json` 能在远端 workspace 下返回 SDK 状态。
- Qt 未初始化时，按 nextActions 执行 `compilot remote qt init --json` 和 `compilot remote qt use ... --json`。
- SDK 未初始化时，按 nextActions 执行 `compilot remote sdk init --json` 和 `compilot remote sdk use ... --json`。
- `compilot remote qt ps --json` 和 `compilot remote qt stop --json` 直接桥接运行状态管理，不应触发 branchSync/sync。

### 5. 远端准备式构建与运行

- `compilot remote qt qmake --json` 成功执行 prepare、branchSync、overlaySync、targetReadiness 和远端 qmake。
- `compilot remote qt build --json` 成功执行远端 Qt build。
- `compilot remote qt run --detach --json` 能后台启动目标进程。
- `compilot remote qt ps --json` 能看到运行状态。
- `compilot remote qt stop --json` 能停止后台进程。
- `compilot remote qt clean --json` 只清理 Qt 构建目标，不误清远端 checkout。
- `compilot remote sdk build --json`、`compilot remote sdk rebuild --json`、`compilot remote sdk clean --json` 分别验证 SDK 构建类动作。

### 6. 远端安全动作

- 本地 git repo 处于 detached HEAD、behind、unpushed 或 tracked dirty 时，prepare 阶段应阻断并返回诊断。
- 远端 checkout 有不属于当前 overlay 的 tracked dirty 文件时，branchSync 应阻断或 preserve 后恢复。
- `compilot remote unlock --lock-id <id> --force --json` 只删除匹配 lock id 的锁。
- `compilot remote qt restore --repo <repo> -- <paths...> --json` 只恢复显式路径，并清理命中的 overlay manifest 与 underlay backup。
- `compilot remote clean-untracked --repo <repo> -- <paths...> --json` 只删除显式 untracked 路径。

### 7. VSCode 手工验证

- 命令面板中 remote status、doctor、workbench、execution local/remote、Qt/SDK remote build/run/stop 命令可见。
- 切换执行位置后，状态栏显示本地/远端模式正确，Qt/SDK 原有本地命令仍可用。
- 远程命令失败时，输出面板能看到阶段、server、remotePath、nextActions 和问题匹配映射。
- 配置面板修改 server、remotePath、buildOrder、transfer 后，CLI status 能读取到一致配置。

### 8. 发布前真实 smoke

推荐完整命令：

```bash
npm run remote:smoke -- --workspace C:\Code\workspace\dev\qt_client --target both --build --run-detach --stop --execute --yes --json-dir /tmp/compilot-remote-smoke
```

完成后检查：

- 每个 step 的 exit code 为 0，或失败 step 有明确 nextActions。
- `remote doctor` 前后结果没有新增 stale lock。
- 远端 Qt 进程已停止，远端 checkout 没有遗留未解释 dirty 文件。
- `--json-dir` 产物已保存到本次测试记录中。

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
  "remoteSettings": {
    "remoteCompilotBin": "/opt/compilot/bin/compilot",
    "buildOrder": {
      "configured": true,
      "count": 2,
      "items": ["sdk:build", "qt:build"]
    },
    "transfer": {
      "configured": true,
      "deployServer": "deploy-1",
      "deployPath": "/opt/app",
      "artifactCount": 1
    }
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
