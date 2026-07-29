# Forja Command Inventory

本文档从源码中全量盘点所有已存在的命令，作为命令收敛迁移的基准。任何不在本文档中的命令都不属于迁移范围。

_生成方式：从 `package.json` contributes、`src/cli/index.ts`、各 CLI 入口、`extension.ts`、`registerQtCommands`、`registerRemoteCommands`、`activateSdk` 等注册点逐一提取。_

---

## 1. CLI 命令

### 1.1 顶层分发 (`src/cli/index.ts`)

| 命令 | 路由目标 | 源码 |
|------|----------|------|
| `forja qt <action>` | `runQtCli` | `src/qt/cli/index.ts` |
| `forja sdk <action>` | `runSdkCli` | `src/sdk/cli/index.ts` |
| `forja remote <action>` | `runRemoteCli` | `src/remote/cli/index.ts` |
| `forja sync <action>` | `runSyncCli` | `src/sync/cli.ts` |
| `forja cleanup` | `runCleanup` | `src/cli/cleanup.ts` |

全局选项：`--help`、`--version`、`--json`

### 1.2 Qt CLI — 12 个动作 (`src/qt/cli/args.ts`)

| 命令 | 功能 | 专属选项 |
|------|------|----------|
| `forja qt init` | 自动初始化配置（检测环境，保存可自动确定的值） | — |
| `forja qt use` | 选择/切换项目和构建配置 | `--project`, `--mode`, `--arch`, `--qt-path`, `--vs-dev-shell`, `--target`, `--qmake-args` |
| `forja qt status` | 显示配置和项目状态 | — |
| `forja qt env` | 查看工具链环境（Qt/VS/jom） | — |
| `forja qt projects` | 列出 workspace 下的 .pro 文件 | — |
| `forja qt qmake` | 执行 qmake | `--plan` |
| `forja qt build` | 构建项目 | `--plan` |
| `forja qt clean` | 清理编译产物 | `--plan` |
| `forja qt run` | 构建并运行 | `--plan`, `--detach` |
| `forja qt stop` | 停止运行中的程序 | — |
| `forja qt ps` | 查看后台运行状态 | — |
| `forja qt rcc` | 编译 .qrc 资源文件 | `--plan` |

通用选项：`--workspace`, `--json`

### 1.3 SDK CLI — 8 个动作 (`src/sdk/cli/index.ts`)

| 命令 | 功能 | 专属选项 |
|------|------|----------|
| `forja sdk init` | 初始化配置（检测 VS/make，保存默认值） | — |
| `forja sdk use` | 选择/切换 SDK 项目和构建配置 | `--project`, `--mode`, `--arch`, `--vs-dev-cmd` |
| `forja sdk status` | 显示项目就绪状态 | — |
| `forja sdk env` | 查看构建环境 | — |
| `forja sdk projects` | 列出 .sln / Makefile | — |
| `forja sdk build` | 编译项目 | `--plan` |
| `forja sdk rebuild` | 重新编译（clean + build） | `--plan` |
| `forja sdk clean` | 清理编译产物 | `--plan` |

通用选项：`--workspace`, `--json`

### 1.4 Remote CLI — 15 个顶层动作 + 子命令 (`src/remote/cli/index.ts`)

#### 顶层动作

| 命令 | 功能 |
|------|------|
| `forja remote status` | 远程配置状态摘要 |
| `forja remote doctor` | 深度远程诊断 |
| `forja remote test` | 测试远程连接和 Forja bin |
| `forja remote bootstrap` | 部署 Forja bin 到远端 |
| `forja remote unlock` | 解除远程锁（需 `--lock-id`） |

#### 远程配置子命令

| 命令 | 子动作 | 功能 |
|------|--------|------|
| `forja remote workspace` | `status` / `use` / `clear` | 远程 workspace 模式配置（legacy/staged） |
| `forja remote repo` | `list` / `set` / `remove` / `clear` | 远程 repo 映射配置 |
| `forja remote forja-bin` | `status` / `use` / `clear` | 远端 Forja 可执行文件路径 |
| `forja remote build-order` | `status` / `set` / `clear` | 远程构建顺序配置 |
| `forja remote transfer` | `status` / `set` / `clear` / `run` | 产物传输配置和执行 |

#### 远程 Qt 动作（通过 bridge/preparedAction 路由）

| 命令 | 路由类型 | 功能 |
|------|----------|------|
| `forja remote qt status` | bridge | 远程 Qt 状态 |
| `forja remote qt init` | preparedAction | 远程 Qt 初始化 |
| `forja remote qt use` | preparedAction | 远程 Qt 配置切换 |
| `forja remote qt build` | preparedAction | 远程 Qt 构建 |
| `forja remote qt clean` | preparedAction | 远程 Qt 清理 |
| `forja remote qt qmake` | preparedAction | 远程 Qt qmake |
| `forja remote qt run` | preparedAction | 远程 Qt 运行 |
| `forja remote qt stop` | bridge | 远程 Qt 停止 |
| `forja remote qt ps` | bridge | 远程 Qt 进程状态 |
| `forja remote qt restore` | restore | 远程 git restore |
| `forja remote qt reset` | restore | 远程 git reset |
| `forja remote qt clean-untracked` | cleanUntracked | 远程清理未跟踪文件 |

#### 远程 SDK 动作

| 命令 | 路由类型 | 功能 |
|------|----------|------|
| `forja remote sdk status` | bridge | 远程 SDK 状态 |
| `forja remote sdk init` | preparedAction | 远程 SDK 初始化 |
| `forja remote sdk use` | preparedAction | 远程 SDK 配置切换 |
| `forja remote sdk build` | preparedAction | 远程 SDK 构建 |
| `forja remote sdk rebuild` | preparedAction | 远程 SDK rebuild |
| `forja remote sdk clean` | preparedAction | 远程 SDK 清理 |
| `forja remote sdk restore` | restore | 远程 git restore |
| `forja remote sdk reset` | restore | 远程 git reset |
| `forja remote sdk clean-untracked` | cleanUntracked | 远程清理未跟踪文件 |

Remote 专属选项：`--bootstrap`, `--lock-id`, `--force`, `--recursive`, `--repo`, `--server`, `--path`, `--mode`, `--profile`, `--local`, `--remote`, `--role`, `--baseline`, `--overlay`, `--mount`, `--asset`, `--artifact`, `--`（passthrough）

### 1.5 Sync CLI — 11 个动作 (`src/sync/cli.ts`)

| 命令 | 功能 | 专属选项 |
|------|------|----------|
| `forja sync` | 执行同步（上传变更文件） | `--plan`, `--server`, `--repo`, `--file` |
| `forja sync status` | 查看同步配置就绪状态 | `--server` |
| `forja sync use` | 配置同步服务器/路径/启用 | `--server`, `--remote-path`, `--enable`, `--disable` |
| `forja sync test-connection` | 测试 SSH 连接 | `--server` |
| `forja sync reset` | 清除同步状态 | — |
| `forja sync servers` | 列举同步服务器 | — |
| `forja sync server` | 查看当前/指定服务器详情 | `--server` |
| `forja sync add-server` | 添加服务器 | `--name`, `--host`, `--port`, `--username`, `--auth-mode`, `--private-key-path`, `--password`, `--strict-host-key-checking` |
| `forja sync update-server` | 更新服务器 | `--server` + 同上字段 |
| `forja sync remove-server` | 删除服务器 | `--server` |

通用选项：`--workspace`, `--json`

### 1.6 Cleanup CLI (`src/cli/cleanup.ts`)

| 命令 | 功能 | 选项 |
|------|------|------|
| `forja cleanup` | 清理已删除/移动项目的残留配置 | `--plan`, `--json` |

---

## 2. VSCode 命令

### 2.1 全局/UI (`extension.ts`)

| Command ID | 标题 | Palette 可见 | 源码 |
|------------|------|--------------|------|
| `forja.config.openPage` | Forja: 打开配置页 | 是 | `extension.ts:71` |
| `forja.showSyncTab` | Forja: 打开远程页 | 否 (`when: false`) | `extension.ts:76` |

### 2.2 Qt 命令 (`src/qt/commands.ts`)

| Command ID | 标题 | Palette 可见 | 功能 |
|------------|------|--------------|------|
| `forja.qt.selectProject` | Forja Qt: 选择项目 | 是 | 交互式选择 .pro 文件 |
| `forja.qt.loadManualProject` | Forja Qt: 加载手动项目 | 否 (`when: false`) | 加载手动指定的 .pro |
| `forja.qt.showActions` | Forja Qt: 显示操作菜单 | 是 | 统一操作 QuickPick |
| `forja.qt.qmake` | Forja Qt: QMake | 是 | 执行 qmake 任务 |
| `forja.qt.build` | Forja Qt: Build | 是 | 执行构建任务 |
| `forja.qt.clean` | Forja Qt: Clean | 是 | 执行清理任务 |
| `forja.qt.run` | Forja Qt: Run | 是 | 构建并运行 |
| `forja.qt.stop` | Forja Qt: 停止 | 是 | 停止运行中进程 |
| `forja.qt.debug` | Forja Qt: 调试 | 是 | 启动调试会话 |
| `forja.qt.openWithQtDesigner` | Forja Qt: 用 Qt Designer 打开 | 是（Explorer .ui 上下文） | 用 Designer 打开 .ui 文件 |
| `forja.qt.rcc` | Forja Qt: RCC 编译 | 是 | 编译 .qrc 资源 |
| `forja.qt.runCustomCommand` | Forja Qt: 执行自定义命令 | 否 (`when: false`) | 运行已保存的自定义命令 |

### 2.3 Sync 命令 (`src/qt/commands.ts` 注册)

| Command ID | 标题 | Palette 可见 | 功能 |
|------------|------|--------------|------|
| `forja.syncTestConnection` | Forja: 测试远程连接 | 是 | 测试 SSH 连接 |
| `forja.syncChangedFiles` | Forja: 同步变更文件到远程 | 是（Explorer 上下文） | 同步当前文件/变更 |

### 2.4 SDK 命令 (`src/sdk/sdkExtension.ts`)

| Command ID | 标题 | Palette 可见 | 功能 |
|------------|------|--------------|------|
| `forja.sdk.build` | Forja SDK: Build | 是（`forja.sdk.activated`） | SDK 构建 |
| `forja.sdk.rebuild` | Forja SDK: Rebuild | 是（`forja.sdk.activated`） | SDK rebuild |
| `forja.sdk.clean` | Forja SDK: Clean | 是（`forja.sdk.activated`） | SDK 清理 |
| `forja.sdk.selectProject` | Forja SDK: Select Project | 是（`forja.sdk.activated`） | 选择 SDK 项目 |
| `forja.sdk.showActions` | Forja SDK: Show Actions | 是（`forja.sdk.activated`） | 别名，同 selectProject |

### 2.5 Remote 命令 (`src/remote/vscode/commands.ts`)

| Command ID | 标题 | 功能 |
|------------|------|------|
| `forja.remote.execution.pick` | Forja: Select Execution Location | 选择 local/remote |
| `forja.remote.execution.local` | Forja: Use Local Execution | 切换为本地执行 |
| `forja.remote.execution.remote` | Forja: Use Remote Execution | 切换为远程执行 |
| `forja.remote.workbench` | Forja Remote: Workbench | 远程工作台 |
| `forja.remote.status` | Forja Remote: Status | 远程状态 |
| `forja.remote.doctor` | Forja Remote: Doctor | 远程诊断 |
| `forja.remote.test` | Forja Remote: Test | 远程测试 |
| `forja.remote.bootstrap` | Forja Remote: Bootstrap | 部署远端 Forja |
| `forja.remote.transfer.status` | Forja Remote: Transfer Status | 产物传输状态 |
| `forja.remote.qt.build` | Forja Remote Qt: Build | 远程 Qt 构建 |
| `forja.remote.qt.clean` | Forja Remote Qt: Clean | 远程 Qt 清理 |
| `forja.remote.qt.qmake` | Forja Remote Qt: QMake | 远程 Qt qmake |
| `forja.remote.qt.run` | Forja Remote Qt: Run | 远程 Qt 前台运行 |
| `forja.remote.qt.runDetached` | Forja Remote Qt: Run Detached | 远程 Qt 后台运行 |
| `forja.remote.qt.stop` | Forja Remote Qt: Stop | 远程 Qt 停止 |
| `forja.remote.qt.ps` | Forja Remote Qt: PS | 远程 Qt 进程状态 |
| `forja.remote.sdk.build` | Forja Remote SDK: Build | 远程 SDK 构建 |
| `forja.remote.sdk.rebuild` | Forja Remote SDK: Rebuild | 远程 SDK rebuild |
| `forja.remote.sdk.clean` | Forja Remote SDK: Clean | 远程 SDK 清理 |

注：Remote VSCode 命令未在 `package.json` menus.commandPalette 中显式隐藏，依赖 package.json contributes.commands 中是否声明。

---

## 3. 统计

| 类别 | 数量 |
|------|------|
| CLI 顶层分发 | 5 |
| Qt CLI 动作 | 12 |
| SDK CLI 动作 | 8 |
| Remote CLI 顶层动作 | 5 |
| Remote CLI 配置子命令 | 5 × 2~4 子动作 ≈ 15 |
| Remote CLI Qt 动作 | 12 |
| Remote CLI SDK 动作 | 9 |
| Sync CLI 动作 | 10 |
| Cleanup CLI | 1 |
| **CLI 总计（约）** | **~67** |
| VSCode 全局/UI | 2 |
| VSCode Qt | 12 |
| VSCode Sync | 2 |
| VSCode SDK | 5 |
| VSCode Remote | 19 |
| **VSCode 总计** | **40** |
| **CLI + VSCode 总计（约）** | **~107** |

注：Remote CLI 子命令数量因 `status/use/clear` 等子动作展开而有差异，此处按用户可输入的独立命令路径计数。

---

## 4. 命令来源文件索引

| 注册点 | 文件 | 命令类型 |
|--------|------|----------|
| CLI 顶层分发 | `src/cli/index.ts` | CLI |
| Qt CLI 参数解析 | `src/qt/cli/args.ts` | CLI |
| Qt CLI 主逻辑 | `src/qt/cli/index.ts` | CLI |
| SDK CLI 主逻辑 | `src/sdk/cli/index.ts` | CLI |
| Remote CLI 主逻辑 | `src/remote/cli/index.ts` | CLI |
| Sync CLI 主逻辑 | `src/sync/cli.ts` | CLI |
| Cleanup CLI | `src/cli/cleanup.ts` | CLI |
| 扩展入口 | `src/extension.ts` | VSCode |
| Qt 命令注册 | `src/qt/commands.ts` | VSCode |
| SDK 扩展入口 | `src/sdk/sdkExtension.ts` | VSCode |
| Remote VSCode 命令 | `src/remote/vscode/commands.ts` | VSCode |
| SDK 常量 | `src/sdk/constants.ts` | VSCode command ID |
| package.json | `package.json` contributes | VSCode 声明 |

---

_更新时间: 2026-06-15_
