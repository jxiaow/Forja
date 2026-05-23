# 远程编译部署决策记录

本文记录 v3 设计中已经收敛的风险决策。实现阶段不得再把这些事项当成临场选择。

## 公开命令面

### Stale Lock 清理

正式命令：

```bash
compilot remote unlock --lock-id <id> --force
```

规则：

- 必须同时提供 `--lock-id` 和 `--force`
- `lock-id` 是 lock metadata 内的随机 id，不是 `targetId`
- 只删除匹配 lock-id 的 lock 目录
- 不 kill 远端进程
- 不修改 overlay manifest、underlay backup 或 run-state
- VSCode 提供 `Compilot: Remote Unlock`，但必须显示 lock metadata 再执行

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

- artifact: `dist/compilot-<version>/cli/compilot-cli-<version>.tgz`
- version: exact match
- install: `npm install -g --prefix ~/.compilot/runtime/<version> <tgz>`
- remote bin: `~/.compilot/bin/compilot`
- retention: active version + previous active version

完整规则见 `docs/remote-deploy-bootstrap.md`。

## BuildOrder

第一版不做 buildOrder。多 repo workspace 只保证 repo baseline/sync 正确，不负责跨 repo 构建编排。远端 build 只执行远端 Qt/SDK 当前 workspace settings 选中的项目。

后续如果要加 buildOrder，单独设计，不阻塞第一版。

## Submodule

第一版不把 submodule 当普通文件 overlay。

规则：

- 本地 submodule dirty 阻塞 remote build/run
- 本地 submodule gitlink 已提交并可拉取时允许
- 远端 submodule dirty 阻塞，不做 underlay 保护
- branchSync 后可执行 `git submodule sync --recursive` 和 `git submodule update --init --recursive --checkout`
- submodule update 失败阻塞

## Sync 历史接管

remote overlay manifest 只记录 remote pipeline 写过的 overlay。普通 `compilot qt sync` 或人工 SCP 的历史文件不会自动接管。

第一版不提供 scan/adopt。status 只报告 unknown/preserved 状态，不自动清理。
