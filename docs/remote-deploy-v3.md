# 远程编译部署方案 v3

本文是当前远程编译部署的一版正式设计和实现状态记录。`docs/remote-deploy-v2.md` 保留为历史设计稿，后续实现以本文为准。

已收敛的风险决策记录在 `docs/remote-deploy-decisions.md`。

## 当前实现状态

已实现 Phase 1：`remote doctor/test/status/bootstrap/unlock`、`remote build-order status/set/clear`、`remote transfer status/set/clear/run`、`remote qt|sdk status/init/use`、`remote qt build/clean/qmake/run/stop/ps`、`remote sdk build/rebuild/clean`、`remote qt|sdk restore/reset`、`remote qt|sdk clean-untracked`、VSCode 命令面板中的 remote doctor/status/test/bootstrap/build/run/run-detach/stop/ps 类动作、VSCode 执行位置切换和状态栏/统一操作菜单远程分流，以及保守的 Problems 诊断映射。

当前剩余外部验证：真实远端 SSH smoke。SDK 是库，不提供 run/stop/ps。

## 目标

远程能力用于在远端编译机上复现当前本地工作区状态，并执行 Qt 或 SDK 构建。Qt 项目还支持远程运行态管理；SDK 是库，不提供 run/stop/ps。

第一版不追求通用部署平台，优先解决：

- 远端仓库基线和本地分支/提交对齐
- 本地未提交改动同步到远端
- 远端 Qt/SDK 构建命令复用 forja
- Qt 远程前台运行和后台运行
- 显式产物从编译机 transfer 到部署机
- AI/脚本可解析的远程 JSON pipeline 输出

## 命令入口

远程能力使用独立一级执行域：

```bash
forja remote test
forja remote test --bootstrap
forja remote doctor
forja remote doctor --bootstrap
forja remote bootstrap
forja remote status
forja remote unlock --lock-id <id> --force
forja remote build-order status
forja remote build-order set sdk:build qt:qmake qt:build
forja remote build-order clear
forja remote transfer status
forja remote transfer set --server <deployServerId> --path <deployPath> --artifact <path>
forja remote transfer run
forja remote transfer clear

forja remote qt build
forja remote qt status
forja remote qt init
forja remote qt use
forja remote qt run
forja remote qt run --detach
forja remote qt run --detach --json
forja remote qt stop
forja remote qt ps
forja remote qt clean
forja remote qt qmake
forja remote qt restore --repo <repo> -- <paths...>
forja remote qt reset --repo <repo> -- <paths...>
forja remote qt clean-untracked --repo <repo> -- <paths...>

forja remote sdk build
forja remote sdk status
forja remote sdk init
forja remote sdk use
forja remote sdk rebuild
forja remote sdk clean
forja remote sdk restore --repo <repo> -- <paths...>
forja remote sdk reset --repo <repo> -- <paths...>
forja remote sdk clean-untracked --repo <repo> -- <paths...>
```

不把第一版远程能力挂到 `forja qt ... --remote` 或 `forja sdk ... --remote`。后续如果需要，可以作为别名再评估，但 canonical 入口是 `forja remote <type> <action>`。

### 命令语义

| 命令 | 语义 |
| --- | --- |
| `remote test` | 检查 sync 配置、SSH、remotePath、远端 forja 版本 |
| `remote test --bootstrap` | 检测失败时允许执行 bootstrap |
| `remote bootstrap` | 上传并安装当前 forja CLI 到远端用户目录 |
| `remote status` | 返回远程配置和能力状态，不修改远端 |
| `remote unlock --lock-id <id> --force` | 显式清理匹配 lock-id 的远端 stale lock，不 kill 进程 |
| `remote build-order status/set/clear` | 管理用户目录 remote settings 中的远程 buildOrder |
| `remote transfer status/set/clear/run` | 管理并执行编译机到部署机的显式 artifact transfer |
| `remote qt/sdk status/init/use` | 桥接远端 forja 的 Qt/SDK 用户目录配置，不做 sync/build |
| `remote qt build/clean/qmake` | 远程 Qt 构建类动作 |
| `remote qt run` | 远程 Qt 前台运行，人工终端使用 |
| `remote qt run --detach` | 远程 Qt 后台运行 |
| `remote qt stop/ps` | 管理远端 Qt 后台运行状态 |
| `remote sdk build/rebuild/clean` | 远程 SDK 构建类动作 |
| `remote <type> restore/reset` | 恢复远端指定 tracked 路径到远端当前 git HEAD |
| `remote <type> clean-untracked` | 清理远端指定 untracked 路径，先由 git 确认；即 remote qt/sdk clean-untracked |

SDK 是库，第一版不提供 `remote sdk run`、`remote sdk stop`、`remote sdk ps`。

`remote test/status/unlock`、target readiness、Qt/SDK bridge command、真实远程 smoke 流程的规则见 `docs/remote-deploy-status.md`。bootstrap 细节见 `docs/remote-deploy-bootstrap.md`。SSH 执行、安全边界和日志脱敏规则见 `docs/remote-deploy-security.md`。

## 配置模型

远程配置只存用户目录，不新增项目内 remote 配置文件。

```text
~/.forja/
├── servers.json
├── projects/
│   ├── <hash(workspace:qt)>.json
│   ├── <hash(workspace:sdk)>.json
│   ├── <hash(workspace:sync)>.json
│   └── <hash(workspace:remote)>.json
├── sync/
└── remote-state/
```

不创建：

- `.forja/remote.json`
- `.forja/deploy.json`
- `.forja/*.local.json`

### Sync 复用

remote 强依赖当前 sync 目标作为编译机和代码同步目标：

- `SyncSettings.selectedServer`
- `SyncSettings.remotePaths[selectedServer]`
- `SyncSettings.ignore`
- sync state

`RemoteSettings` 不重复保存编译机 server 或 remotePath，只保存 remote 专属字段。
remote sync 复用这些配置。mtime state 可继续作为普通 sync 的记录，但 remote pipeline 在 branchSync 清理 overlay 后必须按当前 git change set 重放 overlay，不能只靠 mtime skip；细节见 `docs/remote-deploy-baseline.md`。

```ts
interface RemoteSettings {
  remoteForjaBin?: string;
  buildOrder?: Array<{ target: "qt" | "sdk"; action: string; args: string[] }>;
  transfer?: {
    deployServer: string;
    deployPath: string;
    artifacts: string[];
  } | null;
}
```

`remoteForjaBin` 默认使用：

```text
PATH 中的 `forja`
```

后续如果需要记录 UI 偏好、bootstrap 偏好或阶段开关，应继续放在 `type=remote` 文件中。

## 远端 Qt/SDK 设置

bootstrap 只保证远端有兼容的 forja CLI，不保证远端 Qt 或 SDK 工具链已经初始化。

远端 Qt/SDK 设置仍由远端 forja 按它自己的用户目录规则保存。remote 不把本地 Qt/SDK settings 复制到远端，也不把这类配置写入项目内文件。

最小桥接动作：

- `forja remote qt status`
- `forja remote qt init`
- `forja remote qt use`
- `forja remote sdk status`
- `forja remote sdk init`
- `forja remote sdk use`

这些动作只负责解析 sync server/remotePath、确认远端 forja 可用，然后在远端 workspace 下执行对应的 `forja qt|sdk ...`。它们不执行 branchSync、sync、baselineCheck，也不修改本地 Qt/SDK 配置。

build/run/rebuild/qmake 前必须做 target readiness：

- Qt 动作需要远端 `forja qt status --json` 通过
- SDK 动作需要远端 `forja sdk status --json` 通过
- readiness 失败时返回诊断和下一步命令，例如 `forja remote qt init`

readiness 输出协议见 `docs/remote-deploy-status.md`。

## 远端 Forja

第一版要求远端安装 forja，不做 shell fallback。

原因：

- Qt/SDK 构建逻辑已经由本地 CLI 封装，远端复用同一套 CLI 最少漂移
- JSON、errors、pid、logFile 可以复用远端 forja 输出
- shell fallback 会重新实现 Qt/SDK 构建规则，第一版不承担这层复杂度

### Bootstrap

当远端没有 forja 或版本不兼容时，普通 build/run/clean/qmake/rebuild 应失败并提示：

```bash
forja remote bootstrap
```

bootstrap 是显式动作，不在 build/run 中静默安装。

安装策略：

1. 本地准备当前 forja CLI 安装包
2. 上传到远端临时目录
3. 检查远端 node/npm 或运行时要求
4. 安装到远端用户目录，不使用 sudo
5. 通过 `command -v forja` 获取真实入口
6. 从非安装目录执行 `forja --version` 验证

第一版本地输入是当前 package version 对应的 CLI package artifact；开发验证可用 `npm run build:cli` 生成，正式发布用 `npm run package:all`。bootstrap 不隐式执行 package/version bump。缺少 artifact 时提示先打包。远端至少需要可用 node/npm；缺失时 bootstrap 失败并返回诊断，不退回 shell fallback。artifact、版本和清理策略见 `docs/remote-deploy-bootstrap.md`。

推荐远端目录：

```text
<npm prefix -g>/lib/node_modules/forja/
<command -v forja>
```

remote 执行优先使用 `remoteForjaBin`，不依赖远端 PATH。

bootstrap 复用远端 npm 已配置的全局 prefix；新入口验证成功后删除旧的 `~/.forja/bin/forja`。安装后必须能通过 PATH 直接调用 `forja`。

## 仓库和路径模型

本地 workspace 的 git 仓库发现沿用当前 sync 规则：

- 如果 workspace 自身是 git repo，使用该 repo
- 否则扫描直接子目录中的 git repo

sync 的远端路径仍为：

```text
<sync.remotePath>/<repoName>/<relativePath>
```

`remotePath` 表示远端工作区根，不是单个项目根。

legacy workspace 模式下，远端 forja 动作的 cwd 是 `<sync.remotePath>`，并且显式传入 `--workspace <sync.remotePath>`。staged workspace 模式下，执行类动作、bridge action 和 transfer source 使用 primary repo 对应的 action path；target identity、overlay manifest、underlay backup 和 lock 仍按 workspace root 归属。repo 位于该工作区根下：

```text
<remotePath>/
└── <repoName>/
    └── <relativePath>
```

因此远端 Qt/SDK settings 也按远端 workspace root `<remotePath>` 建立。单仓库项目的远端 project path 仍应包含 repoName，例如 `qt-app/app.pro`；多仓库 workspace 也是同一规则。remote 不把本地 workspace hash 对应的 Qt/SDK settings 复制到远端。

远端 target identity 按远端用户目录隔离。同一个远端用户、同一个规范化 `remotePath` 必须得到同一个 remote target id，用于 lock、overlay manifest 和 underlay backup：

```text
targetId = sha256(canonicalRemotePath)
```

`canonicalRemotePath` 由远端执行 `cd <remotePath> && pwd -P` 得到；如果路径尚不存在，先创建工作区根，再取 canonical path。本地 pipeline cache 可以额外把 `serverId`、host、port、username 放入 key，但远端锁和远端 state 不能只依赖本地 serverId；否则同一远端 target 被两个 server alias 访问时会绕开互斥。

远端 repo 分两种模式：

| 模式 | 条件 | 行为 |
| --- | --- | --- |
| `git` | `<remotePath>/<repoName>/.git` 存在 | 执行 branchSync 和 commit baselineCheck |
| `files` | 无 `.git` | 跳过 git 对齐，只执行 sync/build |

## Baseline 流程

第一版把 baseline/branchSync 作为核心能力，不延后。

dirty、overlay manifest、state 和 restore 的完整规则见 `docs/remote-deploy-baseline.md`。

远程 build/run 主链路：

```text
resolve config
check remote forja
check target readiness
discover repos
acquire target lock
branchSync
sync
baselineCheck
remote action
release target lock
```

Qt run 的 detach 链路：

```text
lock -> branchSync -> sync -> baselineCheck -> remote forja qt run --detach --json -> unlock
```

Qt run 的前台链路：

```text
lock -> branchSync -> sync -> baselineCheck -> remote forja qt run -> unlock on session exit
```

### Action Policy

不同动作是否进入 baseline/sync 链路必须固定，避免 CLI 和 VSCode 行为不一致。

| 动作 | remote forja | target readiness | branchSync | sync | baselineCheck | target lock |
| --- | --- | --- | --- | --- | --- | --- |
| `remote test/status` | 检查 | 可选摘要 | 否 | 否 | 否 | 否 |
| `remote bootstrap` | 安装/更新 | 否 | 否 | 否 | 否 | 否 |
| `remote unlock` | 否 | 否 | 否 | 否 | 否 | 清理匹配 lock |
| `remote transfer status/set/clear/run` | 否 | 否 | 否 | 否 | 否 | 否 |
| `remote qt/sdk status/init/use` | 必须 | 动作自身处理 | 否 | 否 | 否 | 短锁 |
| `remote qt build/clean/qmake` | 必须 | 必须 | 是 | 是 | 是 | pipeline 全程 |
| `remote sdk build/rebuild/clean` | 必须 | 必须 | 是 | 是 | 是 | pipeline 全程 |
| `remote qt run` | 必须 | 必须 | 是 | 是 | 是 | 前台会话退出后释放 |
| `remote qt run --detach` | 必须 | 必须 | 是 | 是 | 是 | launch 完成后释放 |
| `remote qt stop/ps` | 必须 | Qt run-state | 否 | 否 | 否 | 短锁或无锁 |
| `remote <type> restore` | 必须 | 否 | 否 | 否 | 否 | action 全程 |
| `remote <type> clean-untracked` | 必须 | 否 | 否 | 否 | 否 | action 全程 |

### Branch Sync

对远端 `git` repo：

1. 根据远端 target state 中的 overlay manifest 恢复上次 remote sync 留下的 overlay
2. stash 剩余 tracked dirty，保留远端打包修改
3. `git fetch`
4. `git checkout <本地当前分支>`
5. `git pull --ff-only`
6. `git stash pop` 恢复 preserved dirty

默认不执行：

```bash
git checkout -- .
git reset --hard
git clean -fd
```

远端 unknown untracked 默认保留；如果它阻塞 checkout/pull，流程停止。如果 `stash pop` 冲突，也不继续 sync/build。

### Baseline Check

baselineCheck 校验 commit 对齐，不要求远端 clean。输出必须区分 preserved tracked dirty、remote sync overlay、unknown untracked 和 files-only 降级状态。commit 不一致才阻塞。

### Restore / Clean Untracked

如果用户想清理远端某个或某几个 tracked 文件，不提供大范围 reset，使用路径级 restore/reset。`reset` 是同一安全语义下的命令别名。

```bash
forja remote qt restore --repo qt-app -- src/main.cpp generated/version.h
forja remote qt reset --repo qt-app -- src/main.cpp generated/version.h
forja remote sdk restore --repo sdk-lib -- include/version.h
forja remote sdk reset --repo sdk-lib -- include/version.h
```

规则：

- 必须显式提供路径
- 多仓库 workspace 必须指定 `--repo`
- 路径是 repo 内相对路径，拒绝 absolute、`..` 逃逸和空路径
- 只恢复 tracked 文件到远端当前 git HEAD
- 不清理 untracked 文件
- 不影响本地文件
- 不触发 build/run

如果用户想清理远端某个或某几个 untracked 文件，使用显式 clean-untracked：

```bash
forja remote qt clean-untracked --repo qt-app -- tmp/generated.txt
forja remote qt clean-untracked --repo qt-app --recursive -- tmp/generated-dir
forja remote sdk clean-untracked --repo sdk-lib -- generated/cache.bin
```

规则：

- 必须显式提供路径
- 多仓库 workspace 必须指定 `--repo`
- 路径是 repo 内相对路径，拒绝 absolute、`..` 逃逸和空路径
- 先通过 `git ls-files --others --exclude-standard -- <paths>` 确认目标是 untracked
- 只删除被 git 确认为 untracked 的显式路径
- 目录必须加 `--recursive`
- 不执行 `git clean`
- 不影响本地文件
- 不触发 build/run

JSON 输出：

```json
{
  "ok": true,
  "action": "restore",
  "target": "qt",
  "repo": "qt-app",
  "restored": ["src/main.cpp"],
  "skipped": [],
  "failed": [],
  "discardedOverlay": [],
  "discardedUnderlay": []
}
```

## Transfer

transfer 用于把编译机上的显式产物复制到部署机。它不自动发现产物，不进入 build pipeline，也不修改远端仓库状态。

```bash
forja remote transfer status
forja remote transfer set --server deploy-1 --path /opt/app --artifact qt-app/build/app
forja remote transfer run
forja remote transfer clear
```

规则：

- 配置保存在用户目录 remote settings，不写项目内配置
- `--server` 是 `~/.forja/servers.json` 中的部署服务器 id
- `--path` 必须是部署机绝对路径
- `--artifact` 可重复，路径相对编译机 `remotePath`
- artifact 拒绝 absolute、`..` 逃逸和空路径
- `transfer status` 只做本地校验并输出 source/destination plan，不连接 SSH
- 当前只支持 build host 直接 SSH/SCP 到 deploy host
- 部署机当前必须支持 key auth；password auth 不在 direct 模式中透传

JSON 输出：

```json
{
  "ok": true,
  "action": "transfer",
  "mode": "remote",
  "deployPath": "/opt/app",
  "artifacts": ["qt-app/build/app"],
  "transferred": ["qt-app/build/app"],
  "diagnostics": []
}
```

## Qt Run 协议

当前 CLI 已实现 `remote qt run/stop/ps`。前台 run 不支持 JSON，本地和远程使用同一规则：

```bash
forja qt run
forja qt run --detach
forja qt run --detach --json

forja remote qt run
forja remote qt run --detach
forja remote qt run --detach --json
```

拒绝：

```bash
forja qt run --json
forja remote qt run --json
```

错误建议：

```json
{
  "ok": false,
  "action": "run",
  "diagnostics": [
    {
      "level": "error",
      "message": "run --json 仅支持 --detach 模式，请使用 run --detach --json"
    }
  ],
  "nextActions": ["forja qt run --detach --json"]
}
```

`remote qt ps` 和 `remote qt stop` 只管理远端后台 detach 状态。前台进程由当前 SSH 会话和终端 Ctrl+C 管理。CLI 前台 remote run 必须持有 target lock，直到远端 `qt run` 进程退出或本地会话取消。

## JSON 输出协议

remote JSON 使用 pipeline 结构，不复用普通 `CliResult` 的平铺结构。

示例：

```json
{
  "ok": true,
  "action": "run",
  "target": "qt",
  "mode": "remote",
  "execution": "detach",
  "workspace": "/local/workspace",
  "remotePath": "/remote/workspace",
  "server": "build-01",
  "stages": [
    {
      "stage": "branchSync",
      "ok": true,
      "durationMs": 1200,
      "message": "synced 2 repos",
      "repos": [
        {
          "name": "qt-app",
          "mode": "git",
          "branch": "dev",
          "commit": "abc1234",
          "dirtyStashed": 3
        }
      ]
    },
    {
      "stage": "sync",
      "ok": true,
      "durationMs": 800,
      "uploaded": ["qt-app/src/main.cpp"],
      "skipped": []
    },
    {
      "stage": "build",
      "ok": true,
      "durationMs": 30200,
      "exitCode": 0
    },
    {
      "stage": "launch",
      "ok": true,
      "durationMs": 300,
      "pid": 12345,
      "logFile": "/remote/log/run.log"
    }
  ],
  "pid": 12345,
  "logFile": "/remote/log/run.log",
  "diagnostics": []
}
```

字段规则：

- `stages` 是 remote JSON 主干
- 顶层保留常用摘要：`ok`、`action`、`target`、`execution`、`pid`、`logFile`、`diagnostics`
- 编译错误放顶层 `errors`，build stage 保留摘要
- 默认不包含完整 stdout/stderr
- sync 文件列表需要截断或分页，避免 JSON 过大
- 详细日志通过 `logFile` 或未来的 verbose/debug 入口查看

## VSCode 插件体验

当前 Phase 1 已接入 Remote Workbench 和命令面板辅助入口：Remote Status/Doctor/Test/Bootstrap、Qt Build/Clean/QMake/Run/Run Detached/Stop/PS、SDK Build/Rebuild/Clean。VSCode 主入口是“执行位置：本地 / 远程”和 Remote Workbench，不是 CLI remote 命令菜单；状态栏和统一操作菜单在远程执行位置下映射到 remote core。完整规则见 `docs/remote-deploy-vscode.md`。

## 当前 Phase 1 不做

- `forja qt ... --remote` / `forja sdk ... --remote`
- 项目内 remote 配置
- shell fallback 构建
- SDK run/stop/ps
- 大范围远端 reset
- 自动扫描 untracked 并批量清理
- VSCode 大型配置 UI

buildOrder 已实现。transfer 和显式 clean-untracked 已实现。baseline 是正确性前提，buildOrder 是多仓库编排能力，两者不绑定。

## 实现阶段状态

已完成：

1. `remote test/status/bootstrap/unlock`
2. remote 配置 IO 和 sync 配置解析
3. SSH 执行层和远端 forja 版本检查
4. repo discovery、branchSync、baselineCheck
5. `remote <type> restore`
6. remote Qt/SDK 构建动作
7. remote Qt detach run/stop/ps
8. remote Qt foreground run
9. VSCode 执行位置切换、Bootstrap、状态栏/统一操作菜单远程分流、Qt foreground Terminal run
10. VSCode Problems diagnostics adapter
11. buildOrder 和路径级 reset 别名
12. transfer 和显式 clean-untracked
13. CLI/VSCode spec、README 和测试补齐

后续：

1. 真实远端 SSH smoke：执行 `remote:smoke -- --target both --build --run-detach --stop --execute --yes --json-dir <dir>`

每个阶段都需要单独 Scope/Solution gate；涉及公开命令、JSON、持久化格式时必须明确兼容影响。
