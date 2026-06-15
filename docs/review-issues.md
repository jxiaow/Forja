# 代码 Review 问题清单

> 生成时间: 2026-05-15

## 架构违规

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| A1 | 🔴 高 | `core/configService.ts` 已不存在，core 不再通过该路径导入 `qt/` 模块 | — | ✅ 不再适用 |
| A2 | 🟡 中 | `core/stateManager.ts` 已不存在，SDK 状态管理位于 `src/sdk/modules/stateManager.ts` | — | ✅ 不再适用 |
| A3 | 🟡 中 | `core/logger.ts` 已不存在，`core/syncState.ts` 不再通过该链路动态依赖 vscode | — | ✅ 不再适用 |

## 类型安全

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| T1 | 🟡 中 | `fromStage: options.from as any` 已不存在，源码无 `as any` | — | ✅ 不再适用 |
| T2 | 🟢 低 | `src/core/stateManager.ts` 已不存在；当前 SDK state manager 无 `as BuildMode` 类断言 | — | ✅ 不再适用 |

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
| E1 | 🟡 中 | ~~`serverStore.ts` 读取 JSON 失败时空 `catch {}`，配置损坏无任何反馈~~ servers 与 qt/sdk/sync/remote 项目配置读取失败已通过统一 logger 输出 warn，并保留默认值回退 | src/core/serverStore.ts, src/core/settingsIO.ts | ✅ 已修 |
| E2 | 🟡 中 | `ensureRemoteDir` 已集中到 `core/sshTransport.ts`，mkdir 失败时抛出包含退出码和 stderr 的错误 | src/core/sshTransport.ts | ✅ 已修 |
| E3 | 🟢 低 | `createAskpassEnv` 已加 try/catch，tmpdir 写入失败时通过统一 logger 记录 warn 并返回 undefined | src/core/ssh.ts | ✅ 已修 |
| E4 | 🟢 低 | ~~remote/core/index.ts build 阶段 JSON.parse 失败时丢失原始 stdout~~ remote bridge JSON parse 失败 diagnostic 已包含截断 stdout 预览 | src/remote/core/bridge.ts | ✅ 已修 |
| E5 | 🟢 低 | RCC 扫描与 config panel message catch 仍绕过统一 logger 直接 `console.warn` | src/qt/shared/rccResolver.ts, src/ui/configPanel/index.ts | ✅ 已修 |
| E6 | 🟢 低 | cleanup 扫描项目配置 / sync state 时遇到损坏 JSON 静默跳过 | src/core/settingsIO.ts, src/core/syncState.ts | ✅ 已修 |

## 代码组织

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| O1 | 🟢 低 | `sftpClient.ts` 当前是 VSCode 同步编排实现，不再是大量 re-export 层 | src/sync/sftpClient.ts | ✅ 不再适用 |
| O2 | 🟢 低 | remote core 已拆分为 pipeline/baseline/lock 等模块，锁管理已位于 `lock.ts` | src/remote/core/ | ✅ 已修 |
| O3 | 🟢 低 | `DeployResult` 等类型定义散落在各文件而非集中在 types.ts | src/remote/core/ | 可选 |
| O4 | 🟢 低 | 远程部署无取消机制，vscode 的 CancellationToken 未传递到 orchestrator | src/remote/ | 可选 |

## 修复优先级建议

### P0 — 下次提交前修

当前 P0 项已清空。

### P1 — 近期修

4. ~~**E1** — serverStore readProjectSyncConfig 兜底路径补充可观测日志~~ ✅ 已修

### P2 — 长期改进

7. **O3~O4** — 代码组织优化 / 取消机制
8. **V2 / V4** — SDK Extension Host 交互与部分入口测试继续作为长期覆盖项

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
| V1 | 🟡 中 | ~~`sync/cli.ts`、`core/ssh.ts`、`core/serverStore.ts` 无专属测试~~ 当前已有 sync CLI、core ssh、serverStore CRUD/日志行为覆盖 | src/test/qtCliBehavior.test.ts, src/test/serverStoreAndSsh.test.ts, src/test/serverStoreCrud.test.ts | ✅ 已修 |
| V2 | 🟡 中 | SDK 模块测试覆盖不足；CLI、projectScanner source、settings watcher、stale project 已有覆盖，Extension Host 交互仍缺 | src/sdk/ | 部分已补 |
| V3 | 🟡 中 | `remote/core/index.ts` 已不存在；remote core 关键路径已有 staged pipeline/baseline/bridge 等测试覆盖 | src/test/remote*.test.ts | ✅ 已修 |
| V4 | 🟢 低 | qt/build/、sync/、cli/ 入口无测试 | src/qt/build/, src/sync/, src/cli/ | 可选 |

## 工程配置

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| P1 | 🟡 中 | ~~无 ESLint/Prettier 等静态分析工具~~ ESLint 已配置，`no-explicit-any` 已升为 error | eslint.config.mjs | ✅ 已修 |
| P2 | 🟡 中 | ~~循环依赖：`core/stateManager` ↔ `qt/project/projectManager`~~ 已不存在（types 已提取到 core/types.ts） | — | ✅ 不再适用 |
| P3 | 🟢 低 | `forja.showSyncTab` 和 `forja.qt.loadManualProject` 已补充 package.json 声明；`forja.qt.runCustomCommand` 等内部/参数化命令通过 commandPalette when=false 保持不外显 | package.json | ✅ 已修 |
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

- **V2 / V4** — SDK Extension Host 交互与部分入口测试继续作为长期覆盖项
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

## 2026-06-13 Review 追加修复记录

| 问题 | 修复内容 | 状态 |
|------|----------|------|
| RCC / config panel 警告绕过统一 logger | 改为 `loggerBase.warn` / `logger.warn`，并补充红绿测试 | ✅ 已修 |
| cleanup 扫描损坏 JSON 静默跳过 | `listProjectConfigs` / `listSyncStates` 通过统一 logger 输出 warn，返回值保持跳过 | ✅ 已修 |
