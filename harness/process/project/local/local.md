# Local Project Adapter

本文件承载项目专属事实。可移植的 harness core 保持在 `harness/process/README.md`、`templates/`、`gates/`、`automation/` 和通用 `rules/` 中。

迁移 harness 到其他仓库时，优先替换本文件和项目专属规则，不要改 core gate 语义。

## Adapter Files

- `rules/` - 项目专属稳定规则
- `automation/check-entry.js` - 项目入口检查
- `automation/check-harness.js` - 项目聚合检查

## Repository Shape

```
compilot/
├── src/
│   ├── extension.ts              # 统一入口，初始化 + 命令注册
│   ├── core/                     # 核心服务层（状态、配置、日志）
│   ├── qt/                       # Qt 模块（构建、项目、环境、平台、同步、CLI）
│   ├── sdk/                      # SDK 模块（.sln/Makefile 构建）
│   ├── ui/                       # 纯 UI 层（状态栏、配置面板）
│   ├── cli/                      # 统一 CLI 入口
│   └── test/                     # 单元测试（node:test）
├── cli/                          # CLI 独立 npm 包（发布用）
├── harness/process/              # AI 工作流程约束
├── out/                          # 编译输出 (gitignored)
└── media/                        # 图标资源
```

## Product Chain Map

先判断任务属于哪条主链：

- 构建链（QMake / jom / Build / Run / Debug）
- 项目管理链（.pro 扫描 / 项目选择 / .pri 监听）
- 配置链（SettingsStore / ConfigService / ConfigPanel）
- 平台抽象链（PlatformBuilder / PlatformConfig / ShellPlan）
- 远程同步链（SyncWatcher / SftpClient / Transport）
- SDK 链（.sln/Makefile 扫描 / 构建 / 状态栏）
- CLI 链（compilot qt / compilot sdk 命令分发）
- UI 链（StatusBar / ConfigPanel WebView）

然后再判断模块落点。默认提示：

- 构建任务执行：`src/qt/build/`
- 项目扫描与选择：`src/qt/project/`
- Qt 环境检测：`src/qt/env/`
- 平台构建配置：`src/qt/platform/`（win/ 或 linux/）
- 远程同步：`src/qt/sync/`
- 不依赖 vscode 的共享逻辑：`src/qt/shared/`
- SDK 模块：`src/sdk/`
- 状态栏 UI：`src/ui/statusBar.ts`
- 配置面板：`src/ui/configPanel/`
- 核心服务：`src/core/`
- CLI 入口：`src/cli/` 或 `src/qt/cli/` 或 `src/sdk/cli/`
- 测试：`src/test/`

## High-Risk Changes

- 改 `src/extension.ts`（activate 函数、命令注册、disposable 管理）
- 改 `package.json` 的 `contributes`（commands / configuration / activationEvents）
- 改 `src/core/stateManager.ts`（全局状态源，所有模块订阅）
- 改 `src/core/configService.ts`（统一配置读写，影响所有构建流程）
- 改 `src/core/settingsStore.ts`（配置持久化，影响用户设置）
- 改 `src/qt/platform/shellPlan.ts`（BuildConfig / CommandPlan 接口定义）
- 改 `src/qt/shared/`（CLI 和扩展共用，改动影响两个运行时）
- 改 `src/cli/index.ts`（CLI 入口分发）

这些改动通常跨模块，且容易带出初始化链、配置链或平台抽象链问题；进入实现前先把边界和验证限制写清楚。

## Execution Defaults

agent 默认要分别判断：

- 逻辑落点（qt / sdk / core / ui / cli）
- 接口边界（vscode API / CLI stdout / IPC / 文件系统）
- 依赖方向（是否引入反向依赖，shared 是否引入了 vscode）
- 构建接入点（package.json contributes / extension.ts 注册）

## Technology Stack

- 语言：TypeScript（strict mode）
- 运行时：VSCode Extension Host（Node.js）
- 构建：tsc（无 bundler）
- 测试：node:test（内置测试框架）
- 类型检查：`npx tsc --noEmit`
- 打包：`@vscode/vsce`
- 目标平台：Windows（MSVC, x86），部分支持 Linux
- 外部工具依赖：Visual Studio DevShell, jom, qmake

## Common Reading Sets

- 新功能开发：`new-feature` + `rules/architecture-dependencies.md` + `rules/vscode-extension-patterns.md`
- Bug 修复：`bug-fix` + `rules/module-communication.md` + `rules/typescript-standards.md`
- 重构：`refactor` + `rules/architecture-dependencies.md` + `rules/typescript-standards.md`
- 跨模块改动：`cross-module-change` + `rules/architecture-dependencies.md` + `rules/module-communication.md`
- 平台相关：`new-feature` + `rules/platform-abstraction.md` + `rules/architecture-dependencies.md`
- CLI 相关：`new-feature` + `rules/architecture-dependencies.md`（注意 shared 边界）
