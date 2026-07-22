# 远程 Bootstrap 设计

本文补充 `docs/remote-deploy-v3.md` 中 `forja remote bootstrap` 的 artifact、版本兼容、安装和清理策略。

## Artifact

第一版只 bootstrap CLI npm 包，不上传 VSIX。

本地 artifact 固定为当前 `package.json` version 对应的 CLI 包：

```text
dist/forja-<version>/cli/forja-cli-<version>.tgz
```

规则：

- bootstrap 不执行 `npm run build:cli` 或 `npm run package:all`
- 缺少 exact version artifact 时失败
- 开发验证可先执行 `npm run build:cli` 生成 CLI tgz
- 正式发布打包执行 `npm run package:all`
- 如果 dist 下存在其他版本，不自动选择 latest
- 上传前计算 sha256，远端安装前后都记录该摘要

`npm run package:all` 会 bump version；`npm run build:cli` 不 bump version，只按当前 package version 生成 CLI tgz。bootstrap 只消费已经生成的包，不能在远程动作里隐式改变本地版本。

## Version Compatibility

第一版要求本地 launcher 和远端 forja exact version 一致。

- `remote test` 检测远端 version 不一致时失败
- `remote test --bootstrap` 可以安装 exact version 后复测
- `remote bootstrap` 安装成功后必须读取 `npm prefix -g`，并从非安装目录执行 `<prefix>/bin/forja --version`
- version 输出不等于本地 package version 时安装失败

后续如需 semver range 兼容，需要单独设计 JSON 协议版本。

## Remote Install

远端前提：

- POSIX-compatible shell
- Node.js `>=18`
- npm 可用
- 当前用户可写 `~/.forja/` 和 npm 已配置的全局 prefix
- 不使用 sudo

安装目录：

```text
~/.forja/bootstrap/
<npm prefix -g>/lib/node_modules/forja/
<npm prefix -g>/bin/forja
~/.forja/npm/（默认全局 prefix 无写权限时的用户级 fallback）
```

安装流程：

1. 上传 tgz 到 `~/.forja/bootstrap/forja-cli-<version>.tgz.tmp`
2. 校验 sha256
3. rename 为 `forja-cli-<version>.tgz`
4. `npm install -g <tgz>`；当远端启用了 npm 的 engine-strict 且 Node.js 版本低于包的 `engines` 要求时，可用 `forja remote bootstrap --force` 执行 `npm install -g --engine-strict=false <tgz>`
5. 执行 `npm prefix -g`，推导并记录 `<prefix>/bin/forja`
6. 从 `/tmp` 验证 `<prefix>/bin/forja --version`
7. 删除旧入口 `~/.forja/bin/forja`

若默认 npm 全局目录返回 `EACCES` 或 `EPERM`，bootstrap 会改用 `~/.forja/npm` 作为用户级 npm prefix，不修改系统目录。它会把该 prefix 写入 `~/.npmrc`，并把 `~/.forja/npm/bin` 加到 bash/zsh 的登录与交互启动文件（`.profile`、`.bashrc`、`.bash_profile`、`.bash_login`、`.zshrc`、`.zprofile`）；新的 SSH 会话可直接执行 `forja`。

bootstrap 成功后会把已验证的绝对入口路径保存到当前工作区的 `remoteForjaBin`，后续远程命令直接调用该路径，不依赖远端 `PATH`。

bootstrap 不使用 `command -v forja` 判断安装结果，避免 SSH 非交互 shell 未加载登录 PATH 时产生假失败。

## Cleanup

安装成功后 npm 全局 prefix 中保留当前安装版本，并保留当前 bootstrap tgz。

bootstrap 不清理 remote project settings、overlay manifest、underlay backup、run-state 或 lock。

## JSON

```json
{
  "ok": true,
  "action": "bootstrap",
  "mode": "remote",
  "version": "0.7.42",
  "artifact": "dist/forja-0.7.42/cli/forja-cli-0.7.42.tgz",
  "sha256": "<sha256>",
  "remoteBin": "/home/dev/.nvm/versions/node/v22.0.0/bin/forja",
  "stages": [
    { "stage": "upload", "ok": true },
    { "stage": "install", "ok": true },
    { "stage": "resolvePrefix", "ok": true },
    { "stage": "verifyPublicBin", "ok": true },
    { "stage": "removeLegacyBin", "ok": true }
  ],
  "diagnostics": []
}
```
