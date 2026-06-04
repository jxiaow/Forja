# 代码 Review 问题清单

> 生成时间: 2026-05-15

## 架构违规

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| A1 | 🔴 高 | `core/configService.ts` 导入了 `qt/` 模块，破坏 core 作为共享基础层的定位 | src/core/configService.ts | 待修 |
| A2 | 🟡 中 | `core/stateManager.ts` 直接依赖 vscode，不能在 CLI 中使用，不应放在 core/ | src/core/stateManager.ts | 待修 |
| A3 | 🟡 中 | `core/syncState.ts` → `core/logger.ts` → 动态 `require('vscode')` 链路架构不纯（运行时安全但脆弱） | src/core/syncState.ts, src/core/logger.ts | 待修 |

## 类型安全

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| T1 | 🟡 中 | `fromStage: options.from as any` — 应改为 `DeployStage \| null` | src/qt/cli/index.ts:139, src/sdk/cli/index.ts:212 | 待修 |
| T2 | 🟢 低 | stateManager.ts 中 3 处 `value as BuildMode` 等类型断言，安全但绕过泛型约束 | src/core/stateManager.ts | 可选 |

## CLI 一致性

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| C1 | 🟡 中 | ~~SDK CLI 静默忽略未知参数，Qt CLI 会抛错~~ 已改为未知参数直接报错 | src/sdk/cli/index.ts parseArgs | ✅ 已修 |
| C2 | 🟡 中 | ~~SDK CLI 不校验 `--mode`/`--arch` 值，无效值直接透传~~ 已校验 mode/arch，非 Windows 拒绝不支持架构 | src/sdk/cli/index.ts parseArgs | ✅ 已修 |
| C3 | 🟡 中 | ~~SDK CLI help 文本缺少 `--remote`/`--fast`/`--from`/`--force` 文档~~ remote 尚未实现，不应作为已实现 SDK help 参数展示 | src/sdk/cli/index.ts getHelpText | ✅ 不再适用 |
| C4 | 🟢 低 | ~~SDK CLI 中 `run`/`stop`/`restart` 的部署配置检查是死代码~~ 当前 SDK CLI 已不包含该检查 | — | ✅ 不再适用 |

## 错误处理

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| E1 | 🟡 中 | `serverStore.ts` 读取 JSON 失败时空 `catch {}`，配置损坏无任何反馈 | src/core/serverStore.ts readServers/readProjectSyncConfig | 待修 |
| E2 | 🟡 中 | `sync/cli.ts` 的 `ensureRemoteDir` 永远 resolve，mkdir 失败时后续 scp 报错信息不清晰 | src/sync/cli.ts | 待修 |
| E3 | 🟢 低 | `ssh.ts` 的 `createAskpassEnv` 写临时文件无 try/catch，tmpdir 不可写时直接抛异常 | src/core/ssh.ts | 待修 |
| E4 | 🟢 低 | remote/core/index.ts build 阶段 JSON.parse 失败时丢失原始 stdout | src/remote/core/index.ts | 可选 |

## 代码组织

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| O1 | 🟢 低 | `sftpClient.ts` 大量 re-export 是历史遗留，syncWatcher.ts 可直接从 core/ 导入 | src/sync/sftpClient.ts | 可选 |
| O2 | 🟢 低 | remote/core/index.ts 25KB，锁管理可提取到 lock.ts | src/remote/core/index.ts | 可选 |
| O3 | 🟢 低 | `DeployResult` 等类型定义散落在各文件而非集中在 types.ts | src/remote/core/ | 可选 |
| O4 | 🟢 低 | 远程部署无取消机制，vscode 的 CancellationToken 未传递到 orchestrator | src/remote/ | 可选 |

## 修复优先级建议

### P0 — 下次提交前修

1. **T1** — `as any` 改为正确类型
2. **C1 + C2 + C3** — SDK CLI 参数校验和文档补全
3. **C4** — 删除死代码

### P1 — 近期修

4. **E1** — serverStore JSON 解析失败加 console.warn
5. **E2** — ensureRemoteDir 失败时 reject 或返回错误信息
6. **E3** — createAskpassEnv 加 try/catch

### P2 — 长期改进

7. **A1** — configService.ts 拆分或移到 qt/
8. **A2** — stateManager.ts 拆分为纯状态（core）和 vscode 绑定（ui 层）
9. **A3** — logger 提供 console fallback 或接口化
10. **O1~O4** — 代码组织优化

---

## 安全性

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| S1 | 🔴 高 | XSS：`configPanel.html` 中 `showPassword` 使用 innerHTML — 已改为 DOM API（textContent + createElement） | src/ui/configPanel/configPanel.html | ✅ 已修 |
| S2 | 🟡 中 | Shell 注入：`transport.ts` 中 `remoteDir`/`remoteFile` 直接拼入 SSH/SCP 命令 — 已改为单引号包裹 + 内部转义 | src/sync/transport.ts | ✅ 已修 |
| S3 | 🟡 中 | 密码暴露：`_pushServerList` 已使用 `'••••••••'` mask，无需额外修复 | src/ui/configPanel/messageHandler.ts | ✅ 已修 |

## 测试覆盖

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| V1 | 🟡 中 | `sync/cli.ts`、`core/ssh.ts`、`core/serverStore.ts` 无专属测试 | src/core/ | 待补 |
| V2 | 🟡 中 | SDK 模块测试覆盖不足；CLI、projectScanner source、settings watcher、stale project 已有覆盖，Extension Host 交互仍缺 | src/sdk/ | 部分已补 |
| V3 | 🟡 中 | remote/core/index.ts（25KB 编排逻辑）无测试 | src/remote/core/index.ts | 待补 |
| V4 | 🟢 低 | qt/build/、sync/、cli/ 入口无测试 | src/qt/build/, src/sync/, src/cli/ | 可选 |

## 工程配置

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| P1 | 🟡 中 | ~~无 ESLint/Prettier 等静态分析工具~~ ESLint 已配置，`no-explicit-any` 已升为 error | eslint.config.mjs | ✅ 已修 |
| P2 | 🟡 中 | ~~循环依赖：`core/stateManager` ↔ `qt/project/projectManager`~~ 已不存在（types 已提取到 core/types.ts） | — | ✅ 不再适用 |
| P3 | 🟢 低 | `forja.qt.showSyncTab` 和 `forja.qt.loadManualProject` 注册了但未在 package.json 声明（内部命令） | src/extension.ts | 可选 |
| P4 | 🟢 低 | ~~`_updateDeployJson` 中 `fs.writeFileSync` 无 try/catch~~ 该函数已不存在 | — | ✅ 不再适用 |
| P5 | 🟡 中 | ~~Task source 名 `'Forja Qt'` 是散落的字符串字面量~~ 已提取为 `TASK_SOURCE_QT` 常量 | src/qt/constants.ts | ✅ 已修 |
| P6 | 🟢 低 | ~~`configGenerator.ts` 中 logging 不一致~~ 已统一使用 `log()` | src/qt/build/configGenerator.ts | ✅ 已修 |
| P7 | 🟢 低 | ~~`serverStore.ts` chmod 600 在非 Windows 平台的 catch 应加日志~~ 已加平台判断日志 | src/core/serverStore.ts | ✅ 已修 |
| P8 | 🟢 低 | devDependencies 已锁定精确版本 | package.json | ✅ 已修 |

## 修复优先级建议（补充）

### P0 — 安全问题优先

- **S1** — configPanel.html 中所有 innerHTML 插入点改用 textContent 或转义函数
- **S2** — remotePath 拼入 SSH 命令前用 shellEscape 转义

### P1 — 近期修（补充）

- **S3** — _pushServerList 发送时 mask 密码字段（仅在编辑时按需获取）
- ~~**P2** — 循环依赖~~ 已不存在
- ~~**P4** — _updateDeployJson 加 try/catch~~ 已不存在
- ~~**P5** — 提取 `'Forja Qt'` 为常量~~ ✅ 已修

### P2 — 长期改进（补充）

- **V1~V3** — 补充核心模块测试（`core/ssh.ts`、SDK 模块需 mock 框架，标记为长期）
- ~~**P6** — configGenerator.ts 统一使用 logger~~ ✅ 已修
- ~~**P7** — serverStore chmod catch 加平台判断日志~~ ✅ 已修

---

## 2026-05-19 Review 新增修复记录

| 问题 | 修复内容 | 状态 |
|------|----------|------|
| envInfo 为 null 时构建无 guard | buildManager.ts 增加 `_ensureEnvReady()` | ✅ 已修 |
| 全局 task 监听用 name 前缀匹配 | extension.ts 改为 `task.source === 'Forja Qt'` 精确匹配 | ✅ 已修 |
| Run task 监听器 source 名错误 `'Qt Pilot'` | buildManager.ts 改为 `'Forja Qt'` | ✅ 已修 |
| configPanel TARGET 保存命令名不匹配 | HTML 改为发送 `'saveQmakeTarget'` | ✅ 已修 |
| configPanel dataset 属性名不匹配 | HTML 改为 `data-default-target` / `data-saved-target` | ✅ 已修 |
| SSH StrictHostKeyChecking 默认 no 无提示 | syncWatcher.ts 增加首次连接提示 | ✅ 已修 |
| servers.json 文件权限未收紧 | serverStore.ts 写入后 chmod 600 | ✅ 已修 |
| CLI 密码获取无环境变量/stdin 支持 | syncCli.ts 增加 COMPILOT_SSH_PASSWORD + stdin 提示 | ✅ 已修 |
| Windows Qt 路径检测仅硬编码目录 | win/envDetector.ts 增加注册表扫描 | ✅ 已修 |
| configGenerator 空 catch 无日志 | 3 处 catch 改为带日志输出 | ✅ 已修 |
| ESLint no-explicit-any 是 warn | 升为 error | ✅ 已修 |
| devDependencies 用 ^ 范围 | 锁定精确版本 | ✅ 已修 |
| 编辑按钮紧贴路径信息 | 改为独立行 + 文案"编辑服务器" | ✅ 已修 |
| 多仓库工作区 git 命令失败 | syncWatcher/syncCli 增加 resolveGitRoots 子仓库检测 | ✅ 已修 |
| 同步时无法选择仓库 | 扩展侧增加 QuickPick 选择，CLI 增加 --repo 参数 | ✅ 已修 |
| git 仓库检测逻辑重复 | 提取到 core/gitRepoResolver.ts 共享 | ✅ 已修 |
| syncWatcher.ts 重复 import | 合并为单条 import | ✅ 已修 |

## 2026-05-22 CLI / SDK Review 修复记录

| 问题 | 修复内容 | 状态 |
|------|----------|------|
| SDK CLI 参数模型和 Qt 不一致 | `init` 只自动初始化，新增/使用 `use` 承担显式配置，执行命令只读保存配置 | ✅ 已修 |
| SDK CLI 非 Windows 架构默认值不一致 | 非 Windows 默认/保存/展示统一为 `x64`，拒绝不支持的 `--arch` | ✅ 已修 |
| SDK CLI stale pinned project 会回退到候选项目 | 缺失或失效项目时返回 `status`/诊断，不静默选择其他项目 | ✅ 已修 |
| SDK 扩展侧 stale project 状态 | 配置恢复和 build/rebuild/clean 前置检查会清理不存在的项目 | ✅ 已修 |
| AI Skill 仍使用旧 CLI 参数流程 | `skills/forja/SKILL.md` 改为 status → init/use → execution 流程 | ✅ 已修 |
