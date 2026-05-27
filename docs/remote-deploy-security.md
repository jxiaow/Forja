# 远程 SSH 与安全边界

本文补充 `docs/remote-deploy-v3.md` 的 SSH 执行、安全边界、密码处理和日志脱敏规则。

## 基本原则

remote 第一版复用当前 sync server 配置，但不得扩大敏感信息暴露面：

- 不新增项目内服务器或密码配置
- 不把密码写入 remote settings、pipeline state、日志或 JSON
- 不把密码放入命令行 argv
- 不在 shell 字符串里拼接未转义的用户输入
- 不用 `sudo` 安装或执行远端 compilot
- 不做 shell fallback 构建

当前 `servers.json` 支持 password auth，且历史实现中密码可能明文存储。remote 第一版可以复用这个现状，但不能再复制一份。`remote status` 应在 password auth 且密码来自明文 server config 时给出 warning；后续迁移 SecretStorage 是独立安全改造。

## SSH 执行模型

本地启动 SSH/SCP 必须使用 `spawn` 或 `execFile` 形式传 argv，不通过本地 shell 解释整条命令。

远端命令通过 SSH 传给远端 shell 时，必须走统一 builder：

```text
remoteArgv(["git", "-C", repoPath, "status", "--porcelain"])
```

builder 负责：

- 对每个 argv 做 POSIX shell 单引号转义
- 拒绝 NUL
- 保留空字符串为安全的 quoted arg
- 不执行本地 glob 展开
- 不把 pathspec、branch、remotePath 拼进模板字符串

第一版远端 shell 要求 POSIX-compatible shell。`remote test` 必须探测远端平台；Windows SSH 远端、PowerShell quoting 和 cmd quoting 返回“不支持”，不进入 build/run。

## 路径和 Pathspec

远端路径分两类：

| 类型 | 处理 |
| --- | --- |
| remote workspace path | 作为远端绝对路径或用户配置路径处理，经 remote argv quoting |
| repo-relative pathspec | 必须规范化并验证不逃逸 repo，再作为 argv 传给 git/scp |

规则：

- 拒绝 NUL、空 path、absolute path、`..` 逃逸
- restore 必须使用 `git restore -- <paths...>`
- 不做 shell glob 展开；用户传入 `*.cpp` 时按 git pathspec 语义交给 git
- scp 上传目标路径只允许落在 `<remotePath>/<repoName>/...`

## Authentication

推荐 key auth。password auth 支持但按最小暴露处理：

- CLI 可从当前 server config 或 `COMPILOT_SSH_PASSWORD` 获取密码
- VSCode 可继续走现有 SecretStorage/ask password 能力
- ASKPASS 脚本必须写入临时目录，权限尽量收紧，用完清理
- ASKPASS 环境变量和密码值不得写入日志、JSON、diagnostics
- 失败诊断只能说明认证失败，不回显用户名以外的 secret 信息

foreground Terminal 场景不得把密码拼到 terminal 命令中。如果实现无法安全注入密码，Terminal 允许由 SSH 自己交互式询问。

## Host Key

当前 server 配置有 `strictHostKeyChecking`。remote 不应静默改变该配置。

- `strictHostKeyChecking=true`：按用户配置严格校验
- `strictHostKeyChecking=false`：允许连接，但 `remote status` 返回 warning
- bootstrap、build、run 不因为该 warning 阻塞，除非 SSH 实际失败

## ControlMaster

可以借鉴 `origin/feat/remote-deploy` 中的 ControlMaster 思路，但第一版不是必需。

如果启用：

- ControlPath 放在用户临时目录或 `~/.compilot/ssh/`
- 文件/目录权限尽量收紧为当前用户可读写
- 以 server、username、port、host 做 key
- pipeline 结束后按引用计数或超时清理
- 不把 password 放进 ControlPath 或日志

ControlMaster 只优化连接复用，不改变锁、baseline 或认证语义。

## 日志脱敏

remote core 输出日志、JSON、diagnostics 前必须脱敏：

- password、ASKPASS env、private key 内容
- 临时 askpass 脚本内容
- 带密码的 URL
- 可能包含 secret 的完整环境变量 dump

允许输出：

- server id/name、host、port、username
- remotePath
- remote compilot version
- repo 名称、branch、commit
- 失败命令的 argv 摘要，但 secret 参数必须替换为 `<redacted>`

## 实现边界

`src/remote/core` 可以依赖 `src/core/ssh.ts` 或新增 core 级 SSH helper，但不能 import VSCode。

VSCode adapter 只负责取密钥/密码、进度、Terminal 和诊断展示；SSH argv 构造、quoting、日志脱敏必须在 remote core 或 core helper 中统一实现。
