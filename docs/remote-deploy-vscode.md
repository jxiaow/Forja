# 远程部署 VSCode 设计

本文补充 `docs/remote-deploy-v3.md` 中 VSCode 插件体验。CLI 使用显式 remote 命令；当前 Phase 1 已提供命令面板辅助入口、执行位置切换，以及状态栏/统一操作菜单的远程分流。

## 执行位置

执行位置切换已在当前 Phase 1 接入。状态栏和项目 QuickPick 显示当前执行位置：

```text
Qt · Debug x64 · 本地
Qt · Debug x64 · 远程

SDK · Release x64 · 本地
SDK · Release x64 · 远程
```

默认是本地。当前切换动作只保存 VSCode workspaceState，不写项目内 remote 配置文件。具体远程动作执行前检查：

- sync enabled
- selectedServer 存在
- remotePath 存在
- SSH 可连
- 远端 compilot 存在且版本兼容

Qt/SDK 工具链 readiness 按具体动作检查，因为同一 workspace 可能同时有 Qt 和 SDK，且二者远端设置独立。

失败时保留当前执行位置，并给出同步配置、Remote Test、Remote Bootstrap 或远端 Qt/SDK 初始化入口。

readiness 层级和 `remote status/test` 输出协议见 `docs/remote-deploy-status.md`。
SSH 安全、密码处理和日志脱敏规则见 `docs/remote-deploy-security.md`。

## 操作映射

### Qt

| VSCode 操作 | 远程行为 |
| --- | --- |
| Build | preflight 后远端 `compilot qt build --json` |
| Run | preflight 后在 Terminal 启动远端 `compilot qt run` |
| Run Detached | preflight 后远端 `compilot qt run --detach --json` |
| Stop | 远端 `compilot qt stop --json` |
| PS | 远端 `compilot qt ps --json` |
| QMake | preflight 后远端 `compilot qt qmake --json` |
| Clean | 远端 `compilot qt clean --json` |

### SDK

| VSCode 操作 | 远程行为 |
| --- | --- |
| Build | preflight 后远端 `compilot sdk build --json` |
| Rebuild | preflight 后远端 `compilot sdk rebuild --json` |
| Clean | 远端 `compilot sdk clean --json` |

SDK 不提供 run/stop/ps。

## Foreground Run

VSCode 前台 Run 使用 Pseudoterminal 直接调用 remote core：

```text
Pseudoterminal -> executePreparedRemoteAction({ target: "qt", action: "run", stream: true })
```

这样：

- branchSync/sync/baseline 日志和远端前台输出都在同一个 Terminal 中
- remote core pipeline 持有 remote target lock，直到远端 foreground run 退出或 Terminal 被终止
- Terminal 的 Ctrl+C 只管理前台 run 会话
- foreground run 期间不承诺 JSON，不写 detached pid/logFile 状态

Terminal 启动失败时不会进入远程 pipeline，不修改远端 checkout。

## 反馈通道

| 通道 | 用途 |
| --- | --- |
| Status bar | 执行位置、当前 remote 阶段 |
| `window.withProgress` | preflight、build、detach run、bootstrap |
| `Compilot` Output Channel (`[RemoteCommands]` scope) | SSH、git、sync、build 阶段日志 |
| Problems | 可映射回本地路径的远程编译诊断 |
| Terminal | foreground Qt run |

状态栏阶段示例：

```text
远程 · branchSync
远程 · sync
远程 · build
```

## Diagnostics 映射

远端编译诊断进入 Problems 前必须先做路径映射：

- 远端绝对路径 `<remotePath>/<repoName>/<relativePath>` 映射到本地对应 repo 的 `<relativePath>`
- 远端相对路径按远端 compilot action 的 cwd `<remotePath>` 解析
- build 目录中的 generated 文件只有能映射回本地 workspace 时才进入 Problems
- 无法安全映射的诊断只写入 `Compilot` Output Channel，不创建虚假的 Problems

当前实现解析远端 JSON `errors`、stdout 和 stderr 中的 GCC/Clang/MSVC 常见诊断行。映射失败不能让 build/run 失败，只影响 IDE 展示；成功映射的诊断写入 `compilot.remote` DiagnosticCollection。

## Commands

Phase 1 先接入命令面板辅助入口，全部走 `src/remote/vscode/commands.ts` 适配层，不改普通 Qt/SDK 本地命令语义：

```text
Compilot Remote: Status
Compilot Remote: Test
Compilot Remote: Bootstrap
Compilot: Select Execution Location
Compilot: Use Local Execution
Compilot: Use Remote Execution
Compilot Remote Qt: Build
Compilot Remote Qt: Clean
Compilot Remote Qt: QMake
Compilot Remote Qt: Run
Compilot Remote Qt: Run Detached
Compilot Remote Qt: Stop
Compilot Remote Qt: PS
Compilot Remote SDK: Build
Compilot Remote SDK: Rebuild
Compilot Remote SDK: Clean
```

这些命令复用 sync server、remotePath、ignore 和用户目录 remote settings。bootstrap 直接通过 remote core 上传并安装当前扩展目录下的 CLI artifact；缺少 artifact 时只返回 diagnostics 和 `npm run build:cli` / `npm run package:all` next actions，不在 VSCode 内自动构建。build 类动作先执行 remote readiness preflight，再通过 remote core 执行 baseline、lock、branchSync、overlaySync、baselineCheck，最后桥接远端 compilot；如果配置了 buildOrder，VSCode Build 与 CLI 使用同一套编排。

Phase 1 不贡献 SDK run/stop/ps。日常 Build/Run 可通过状态栏和统一操作菜单在远程执行位置下分流，命令面板入口保留为辅助/诊断入口。

新命令实现时必须同步 `package.json` contributes 和 `src/extension.ts` 注册，不修改 activate 导出签名。

## Adapter 边界

```text
src/remote/core/       # 纯 Node，CLI + VSCode 共用
src/remote/vscode/     # VSCode adapter
```

依赖方向：

```text
remote/vscode -> remote/core -> core
remote/core 不能 import vscode
remote/core 不能 import qt 或 sdk
```

VSCode adapter 负责：

- progress callback
- Output Channel
- Diagnostics mapping
- Terminal session creation
- cancellation bridge

remote core 负责：

- SSH
- bootstrap
- branchSync
- sync orchestration
- baselineCheck
- remote action execution
- lock/state

## 取消和状态

取消 preflight/build/detach run：

1. 停止当前 SSH 子进程
2. 释放 remote lock
3. 将失败阶段写入 remote pipeline state
4. 不回滚已经完成的 branchSync 或 sync

foreground Terminal 启动后：

- Terminal 关闭或前台进程退出后释放 remote target lock
- `remote qt ps/stop` 只管理 detach run
- Terminal 会话结束后状态栏回到远程空闲状态
