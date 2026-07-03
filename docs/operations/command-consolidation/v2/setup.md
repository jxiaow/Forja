# `forja setup`

[← 返回总览](index.md)

**职责**：一站式初始化。检测环境 + 保存配置 + 部署远程。从零到能 `forja build`。

**替代旧命令**：`forja init`、`forja qt init`、`forja sdk init`、`forja remote qt init`、`forja remote sdk init`

---

## 语法

```bash
# 本地初始化
forja setup [--json] [--reset] [--answers <path>]
    [--project <path>]
    [--qt-path <path>] [--vs-install <path>] [--jom-path <path>]
    [--mode <debug|release>] [--arch <x86|x64>]

# 远程初始化
forja setup remote [--json] [--reset] [--answers <path>]
    [--project <path>]
    [--qt-path <path>] [--vs-install <path>] [--jom-path <path>]
    [--host <h>] [--username <u>] [--port <n>]
    [--auth-mode <key|password>] [--private-key-path <p>]
    [--name <n>] [--remote-path <p>]
    [--mode <debug|release>] [--arch <x86|x64>]
```

---

## 三种使用模式

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| 终端交互 | TTY，无 `--json` | prompt 收集，flags 值作为默认值 |
| 脚本 | `--json` + flags | 直接用 flags，跳过 questions |
| AI agent | `--json` 无 flags | 返回 `status: "needs-input"` + `questions`，用 `--answers <path>` 回传 |

---

## `forja setup`（本地）

### 流程

1. 扫描工作区目标（`.pro` / `.sln` / `Makefile` / `CMakeLists.txt`）。
2. 检测工具链（Qt/VS/jom/make），支持多安装检测。
3. 有歧义的字段逐项解决：
   - 终端交互 → `choose` / `prompt`
   - flags → 直接使用
   - `--answers` → 从 JSON 文件读取
   - `--json` 无 flags → 返回 questions
4. 保存配置（qt settings、sdk settings、activeTarget）。

### 交互模式行为

- 多目标 → `choose` 选择
- 多 Qt 安装 → `choose` 选择
- 多 VS 安装 → `choose` 选择
- mode → 已配置则用已有值，未配置则 `choose`（默认 `release`）
- arch → 已配置则用已有值，未配置则 `choose`（默认平台默认）
- flags 值作为对应 prompt 的默认值

### 幂等性

重复执行安全。已保存的用户选择不覆盖，仅填充缺失项。

### `--reset`

强制重新配置。忽略已有配置，所有字段重新询问/选择。工具链路径（qtPath/vsInstall/jomPath）在 `--reset` 时会被新值覆盖。注意：配置写入不是原子操作——domain config 先写入，activeTarget 后写入。

### nextAction

| 场景 | nextAction |
|------|-----------|
| 已配置完成 | `forja build` |
| 多目标未选 | `forja list targets` |

---

## `forja setup remote`（远程）

### 流程

`forja setup remote` 包含完整的本地初始化，然后执行远程配置。一体化流程：

**Phase 1 — 本地初始化（同 `forja setup`）：**
1. 扫描工作区目标。
2. 检测工具链，支持多安装检测。
3. 解决目标选择（单目标自动选，多目标交互选/questions）。
4. 解决 mode/arch。
5. 保存本地配置（qt settings、sdk settings、activeTarget）。

**Phase 2 — 远程配置：**
6. 探测服务器：
   - 单个 → 自动选择
   - 多个 → 终端交互 `choose` / `--host` 作为 prompt 默认值 / questions
   - 零个 → 终端交互创建（prompt 收集 host/username/port/authMode/name）/ flags 创建 / questions
7. 推导远程路径：
   - 已配置 → 复用
   - 未配置 → 自动推导 `/home/<username>/<项目名>`
   - 终端交互 → prompt 确认（显示推导值，可覆盖）
   - `--remote-path` → 作为 prompt 默认值
8. 保存远程配置（remote settings: server + path）。
9. 保存同步配置（sync settings: enable + server + path）。
10. **交互确认**（仅 TTY 模式）：显示服务器/路径摘要，询问用户是否继续。用户可选择跳过远程配置。
11. 部署 Forja 到远程：
    - SSH 检测 `~/.forja/bin/forja`
    - 已有 → 跳过（检测版本号）
    - 没有 → SCP + bootstrap
12. 远程 init（bridge init，按 Phase 1 确定的 target kind）。
13. 切换执行模式（activeTarget.runAt → `remote`）。

### 交互模式：无服务器时创建

```
没有服务器。创建一个：
主机地址: 192.168.1.10
用户名: dev
端口 [22]: ↵
认证方式 [1. 密钥 2. 密码] [1]: 2
密码: ********
名称 [192.168.1.10]: mybox

✓ 服务器已创建: mybox (dev@192.168.1.10)
```

> 认证方式为 `key` 时询问私钥路径（默认 `~/.ssh/id_rsa`）；为 `password` 时询问密码。密码通过 `prompt` 输入，存入 server 配置。

### 幂等性

已配置 + SSH 可达 → 跳过全部步骤（检测远程 Forja 版本号）。
已配置 + SSH 不可达 → `ok: false`，标记 failed 并返回 `nextAction: "forja doctor --remote"`（不自动重试，用户需手动排查后重新执行）。

### `--reset`

强制重新配置。重新选择服务器、路径、mode/arch，重新部署。配置写入非原子操作，同本地。

### nextAction

| 场景 | nextAction |
|------|-----------|
| 全部成功 | `forja build` |
| 无服务器（非交互） | `forja server add` |
| 多服务器未选（非交互） | `forja server` |

---

## Questions 协议

当 `--json` 模式遇到无法自动决定的字段时，返回 `status: "needs-input"` + `questions` 数组。`nextAction` 指示调用方如何用 `--answers` 回传。

### questions 规则

- 只包含**需要解决的字段**（未配置、多选项、或 `--reset` 强制重新）
- 已配置且无 `--reset` 的字段不出现在 questions 中
- `--reset --json` 时所有字段都出现在 questions 中（包括已配置的）
- `required: true` 的字段必须由调用方提供
- 有 `choices` 的字段值必须是 choices 之一
- 有 `default` 的字段可不提供，使用默认值
- 有 `when` 的字段仅在前置条件匹配时需要提供（如 `authMode: "password"` 时才需要 `password` 字段）

### 本地 questions

```json
{
  "ok": false,
  "action": "setup",
  "status": "needs-input",
  "questions": [
    { "id": "target", "label": "选择目标", "choices": ["app (Qt) — src/app/app.pro", "lib (Qt) — src/lib/lib.pro"] },
    { "id": "qtPath", "label": "Qt 路径", "choices": ["D:/Qt/6.5.0/msvc2019_64", "D:/Qt/6.7.0/msvc2019_64"] },
    { "id": "vsInstall", "label": "VS 安装", "choices": ["C:/Program Files/Microsoft Visual Studio/2022/Community", "C:/Program Files/Microsoft Visual Studio/2019/Enterprise"] },
    { "id": "mode", "label": "构建模式", "default": "release", "choices": ["debug", "release"] },
    { "id": "arch", "label": "目标架构", "default": "x64（Windows 上为 x86）", "choices": ["x86", "x64"] }
  ],
  "nextAction": "forja setup --json --answers <answers.json>"
}
```

### 远程 questions（无服务器时）

> 如果本地也未配置，questions 会同时包含本地字段（target/qtPath/vsInstall/mode/arch）和远程字段。以下示例假设本地已配置，仅展示远程字段。

```json
{
  "ok": false,
  "action": "setup-remote",
  "status": "needs-input",
  "questions": [
    { "id": "host", "label": "主机地址", "required": true },
    { "id": "username", "label": "用户名", "required": true },
    { "id": "port", "label": "端口", "default": 22 },
    { "id": "authMode", "label": "认证方式", "default": "key", "choices": ["key", "password"] },
    { "id": "privateKeyPath", "label": "私钥路径", "default": "~/.ssh/id_rsa", "when": { "authMode": "key" } },
    { "id": "password", "label": "密码", "when": { "authMode": "password" } },
    { "id": "name", "label": "服务器名称" },
    { "id": "remotePath", "label": "远程路径", "default": "/home/dev/workspace" },
    { "id": "mode", "label": "构建模式", "default": "release", "choices": ["debug", "release"] },
    { "id": "arch", "label": "目标架构", "default": "x64（Windows 上为 x86）", "choices": ["x86", "x64"] }
  ],
  "nextAction": "forja setup remote --json --answers <answers.json>"
}
```

### `--answers` 回传

**本地示例：**
```bash
forja setup --json --answers answers.json
```
```json
{
  "target": "src/app/app.pro",
  "qtPath": "D:/Qt/6.7.0/msvc2019_64",
  "mode": "release",
  "arch": "x64"
}
```

**远程示例：**
```bash
forja setup remote --json --answers answers.json
```

`answers.json` 内容（只需填需要覆盖的字段）：
```json
{
  "host": "192.168.1.10",
  "username": "dev",
  "authMode": "key"
}
```

---

## JSON 输出

### `forja setup`

```json
{
  "ok": true,
  "action": "setup",
  "workspace": "C:/repo",
  "local": {
    "qtTargets": 2,
    "sdkTargets": 1,
    "toolchain": { "qt": true, "vs": true, "jom": true, "make": false },
    "configured": true
  },
  "steps": {
    "localConfig": "done"
  },
  "nextAction": "forja build"
}
```

### `forja setup remote`

```json
{
  "ok": true,
  "action": "setup-remote",
  "workspace": "C:/repo",
  "local": {
    "qtTargets": 1,
    "sdkTargets": 0,
    "toolchain": { "qt": true, "vs": true, "jom": true },
    "configured": true
  },
  "remote": {
    "serverId": "abc-123",
    "serverName": "dev",
    "host": "10.0.0.1",
    "remotePath": "/home/dev/workspace",
    "syncEnabled": true,
    "forjaDeployed": true,
    "forjaVersion": "0.7.0",
    "executionMode": "remote",
    "configured": true
  },
  "steps": {
    "localConfig": "done",
    "serverSetup": "done",
    "remoteConfig": "done",
    "syncSetup": "done",
    "forjaDeploy": "done",
    "remoteInit": "done",
    "executionSwitch": "done"
  },
  "nextAction": "forja build"
}
```

---

## 与其他命令的边界

| 命令 | 职责 | setup 不做 |
|------|------|-----------|
| `status` | 只读就绪度检查 | — |
| `list` | 只读枚举可选项 | — |
| `use` | 日常手动配置 | setup 是一次性初始化，use 是后续调整 |
| `server` | 服务器池 CRUD | setup 内部调 addServer，但对外不暴露 server 子命令 |
| `doctor fix --remote` | 远程修复（重新部署/重新 init） | setup 首次部署；doctor 修复已有 |
| `build` | 编译 | setup 不编译 |

---

## VSCode 映射

| Command ID | 行为 |
|------------|------|
| `forja.setup` | 调用 `runSetup(workspace, {})` — 纯本地初始化 |

---

## 翻译键

| Key | EN | ZH |
|-----|----|----|
| `setupTitle` | Forja Setup | Forja 初始化 |
| `setupRemoteTitle` | Remote Setup | 远程配置 |
| `setupLocal` | Local: | 本地： |
| `setupRemote` | Remote: | 远程： |
| `setupConfigured` | Configured | 已配置 |
| `setupConfigFailed` | Configuration failed | 配置失败 |
| `setupTargets` | targets | 个目标 |
| `setupSteps` | Steps: | 步骤： |
| `setupStepLocalConfig` | Local config | 本地配置 |
| `setupStepServer` | Server | 服务器 |
| `setupStepRemoteConfig` | Remote config | 远程配置 |
| `setupStepSync` | Sync | 同步 |
| `setupStepDeploy` | Deploy Forja | 部署 Forja |
| `setupStepRemoteInit` | Remote init | 远程初始化 |
| `setupStepExecSwitch` | Execution switch | 切换执行 |
| `setupSelectServer` | Select a server: | 选择服务器： |
| `setupNoServer` | No server configured | 未配置服务器 |
| `setupNoServerSelected` | No server selected | 未选择服务器 |
| `setupMultipleServers` | servers found | 个服务器 |
| `setupSpecifyServer` | run interactively or configure with forja use remote first | 请在交互模式运行或先用 forja use remote 配置 |
| `setupRemotePathPrompt` | Remote path | 远程路径 |
| `setupRemotePath` | Remote path: | 远程路径： |
| `setupSync` | Sync: | 同步： |
| `setupForja` | Forja: | Forja： |
| `setupEnabled` | enabled | 已启用 |
| `setupDisabled` | disabled | 已禁用 |
| `setupSshUnreachable` | SSH connectivity check failed | SSH 连通性检查失败 |
| `setupSshVerifyExisting` | verifying existing setup | 验证已有配置 |
| `setupNeedsInput` | Needs input — provide answers via --answers | 需要输入 — 通过 --answers 提供答案 |
| `setupDefault` | default | 默认 |
| `setupRequired` | (required) | (必填) |
| `setupConfirmRemote` | Configure remote build environment? | 配置远程构建环境？ |
| `setupSkippedRemote` | Remote setup skipped by user | 用户跳过了远程配置 |
| `setupRemoteConfigured` | Remote | 远程 |
| `setupRemoteConfigFailed` | Failed to configure remote | 配置远程失败 |
| `setupSyncConfigFailed` | Failed to configure sync | 配置同步失败 |
| `setupSyncEnabled` | Sync enabled | 同步已启用 |
| `setupForjaAlreadyOnRemote` | already on remote | 已存在于远程 |
| `setupForjaDeployed` | Forja deployed to remote | Forja 已部署到远程 |
| `setupForjaNotFound` | Could not find Forja CLI package to deploy | 未找到可部署的 Forja CLI 包 |
| `setupDeployFailed` | Failed to deploy Forja | 部署 Forja 失败 |
| `setupRemoteInitFailed` | Remote init failed | 远程初始化失败 |
| `setupSshError` | SSH error | SSH 错误 |
| `setupAnswersLoadFailed` | Failed to load answers file | 加载答案文件失败 |
| `setupHostNeedsUsername` | --username is required when using --host | 使用 --host 时必须指定 --username |
| `setupServerCreated` | Server created | 已创建服务器 |
| `setupServerCreateFailed` | Failed to create server | 创建服务器失败 |
| `setupPromptHost` | Host address | 主机地址 |
| `setupPromptUsername` | Username | 用户名 |
| `setupPromptPort` | Port | 端口 |
| `setupPromptAuthMode` | Auth mode | 认证方式 |
| `setupAuthKey` | Key | 密钥 |
| `setupAuthPassword` | Password | 密码 |
| `setupPromptPrivateKey` | Private key path | 私钥路径 |
| `setupPromptPassword` | Password | 密码 |
| `setupPromptName` | Server name | 服务器名称 |
| `setupQuestionTarget` | Select target | 选择目标 |
| `setupQuestionQtPath` | Qt path | Qt 路径 |
| `setupQuestionVsInstall` | VS install | VS 安装 |
| `setupQuestionMode` | Build mode | 构建模式 |
| `setupQuestionArch` | Target arch | 目标架构 |
| `serverLabel` | Server: | 服务器： |
| `remotePathLabel` | Remote path: | 远程路径： |
