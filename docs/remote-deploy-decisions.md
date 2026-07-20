# 远程编译部署决策记录

本文记录 v3 设计中已经收敛的风险决策。实现阶段不得再把这些事项当成临场选择。

## 公开命令面

### Stale Lock 清理

正式命令：

```bash
forja remote unlock --lock-id <id> --force
```

规则：

- 必须同时提供 `--lock-id` 和 `--force`
- `lock-id` 是 lock metadata 内的随机 id，不是 `targetId`
- 只删除匹配 lock-id 的 lock 目录
- 不 kill 远端进程
- 不修改 overlay manifest、underlay backup 或 run-state
- VSCode 提供 `Forja: Remote Unlock`，但必须显示 lock metadata 再执行

### Qt/SDK Bridge 参数

`remote qt/sdk status/init/use` 已定为 bridge。透传白名单：

| target | action | 允许透传 |
| --- | --- | --- |
| Qt | `status` | 无额外参数 |
| Qt | `init` | 无额外参数 |
| Qt | `use` | `--project`、`--mode`、`--arch`、`--qt-path`、`--vs-dev-shell`、`--target` |
| SDK | `status` | 无额外参数 |
| SDK | `init` | 无额外参数 |
| SDK | `use` | `--project`、`--mode`、`--arch`、`--vs-dev-cmd` |

remote wrapper 负责追加 `--workspace <remotePath>` 和 JSON 模式下的 `--json`。

## 平台边界

第一版只支持 POSIX remote。

`remote test` 需要执行 `uname` 或等价探测。Windows SSH 远端、PowerShell quoting、Windows path 和远端 VS toolchain 不进入第一版，检测到后返回不支持诊断。

## Bootstrap Artifact

已定：

- artifact: `dist/forja-<version>/cli/forja-cli-<version>.tgz`
- version: exact match
- install: `npm install -g <tgz>`
- remote bin: `command -v forja` 的结果
- retention: npm 全局 prefix 中的当前版本

完整规则见 `docs/remote-deploy-bootstrap.md`。

## BuildOrder

buildOrder 已实现为用户目录 remote settings，不写项目内配置。多 repo workspace 仍由 branchSync/baseline 保证仓库状态正确，buildOrder 只负责编排远端 Qt/SDK action 顺序。

规则：

- CLI 管理入口：`forja remote build-order status|set|clear`
- 配置项格式：`qt:build`、`qt:qmake`、`qt:clean`、`sdk:build`、`sdk:rebuild`、`sdk:clean`
- 仅 `remote qt build`、`remote sdk build`、`remote sdk rebuild` 读取 buildOrder
- 编排时只执行一次 prepare/lock/release，在 lock 内按顺序桥接远端 forja
- 不支持 run/stop/ps 进入 buildOrder

## Transfer

transfer 已实现为显式 artifact 配置，不自动推断构建产物，不进入 build pipeline。

规则：

- CLI 管理入口：`forja remote transfer status|set|clear|run`
- 配置写入用户目录 remote settings，不写项目内配置
- 编译机仍来自 sync 的 `selectedServer` 和 `remotePath`
- 部署机通过 `~/.forja/servers.json` 中的 server id 引用
- artifact 路径必须相对编译机 `remotePath`，拒绝 absolute、`..` 逃逸和空路径
- deployPath 必须是部署机绝对路径
- 当前只支持 build host 直接 SSH/SCP 到 deploy host
- direct 模式拒绝部署机 password auth，避免把密码拼进远端 shell 命令

## Explicit Untracked Cleanup

untracked 清理只提供显式路径级命令，不提供自动扫描清理。

规则：

- CLI 管理入口：`forja remote qt|sdk clean-untracked --repo <repo> -- <paths...>`
- 必须显式指定 repo 和路径
- 路径必须是 repo 内相对路径，拒绝 absolute、`..` 逃逸和空路径
- 远端先通过 `git ls-files --others --exclude-standard -- <paths>` 确认目标是 untracked
- 只删除被 git 确认为 untracked 的显式路径
- 目录删除必须显式传 `--recursive`
- 不执行 `git clean`
- 不触碰 tracked 文件，不触发 build/run，不影响本地文件

## Submodule

第一版不把 submodule 当普通文件 overlay。

规则：

- 本地 submodule dirty 阻塞 remote build/run
- 本地 submodule gitlink 已提交并可拉取时允许
- 远端 submodule dirty 阻塞，不做 underlay 保护
- branchSync 后可执行 `git submodule sync --recursive` 和 `git submodule update --init --recursive --checkout`
- submodule update 失败阻塞

## Sync 历史接管

remote overlay manifest 只记录 remote pipeline 写过的 overlay。普通 `forja qt sync` 或人工 SCP 的历史文件不会自动接管。

第一版不提供 scan/adopt。status 只报告 unknown/preserved 状态，不自动清理。
