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
- `remote bootstrap` 安装成功后必须执行 `~/.forja/bin/forja --version`
- version 输出不等于本地 package version 时回滚，不切换入口

后续如需 semver range 兼容，需要单独设计 JSON 协议版本。

## Remote Install

远端前提：

- POSIX-compatible shell
- Node.js `>=18`
- npm 可用
- 当前用户可写 `~/.forja/`
- 不使用 sudo

安装目录：

```text
~/.forja/bootstrap/
~/.forja/runtime/<version>/
~/.forja/bin/forja
```

安装流程：

1. 上传 tgz 到 `~/.forja/bootstrap/forja-cli-<version>.tgz.tmp`
2. 校验 sha256
3. rename 为 `forja-cli-<version>.tgz`
4. `npm install -g --prefix ~/.forja/runtime/<version> <tgz>`
5. 验证 `~/.forja/runtime/<version>/bin/forja --version`
6. 原子切换 `~/.forja/bin/forja` symlink 或 shim
7. 验证 `~/.forja/bin/forja --version`

任何一步失败都保留旧 `~/.forja/bin/forja`。

## Cleanup

安装成功后保留：

- 当前 active version
- 上一个曾经 active 的 version
- 当前 bootstrap tgz

更旧的 runtime 目录可以清理。清理失败只给 warning，不影响 bootstrap 成功。

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
  "remoteBin": "~/.forja/bin/forja",
  "stages": [
    { "stage": "upload", "ok": true },
    { "stage": "install", "ok": true },
    { "stage": "verify", "ok": true }
  ],
  "diagnostics": []
}
```
