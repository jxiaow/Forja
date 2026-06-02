# Project Profile

## Stack

- Language: TypeScript 5.x (strict)
- Runtime: Node.js >= 18
- Framework: VSCode Extension API ^1.85
- Build: `tsc` + custom scripts (`scripts/build-cli.js`, `scripts/package-vs.js`)
- Test: `node:test` (built-in, no external runner)
- Lint: ESLint 9 (flat config)
- Package: `@vscode/vsce` for .vsix; custom script for CLI .tgz

## Repository Shape

```
src/
├── extension.ts          # 扩展入口
├── core/                 # 共享基础（纯 Node，不依赖 vscode）
├── qt/                   # Qt 模块（qmake 项目）
│   ├── build/            # 构建/运行/调试任务
│   ├── cli/              # Qt CLI 入口
│   ├── env/              # Qt/VS 环境检测
│   ├── platform/         # 平台抽象（win/linux）
│   ├── project/          # .pro 扫描、项目管理
│   ├── services/         # 配置服务
│   ├── shared/           # 不依赖 vscode 的逻辑（CLI 复用）
│   └── sync/             # 远程同步
├── sdk/                  # SDK 模块（.sln/Makefile）
│   ├── cli/              # SDK CLI 入口
│   ├── modules/          # 配置/扫描/构建/状态
│   ├── platform/         # 平台命令生成
│   └── utils/            # 日志委托
├── ui/                   # UI 层（状态栏、Webview 配置面板）
├── cli/                  # 统一 CLI 入口（forja qt/sdk 分发）
└── test/                 # 单元测试
```

## Product Chain Map

1. **Qt Build Chain**: extension → qt/project → qt/env → qt/platform → qt/build → task execution
2. **Qt Sync Chain**: extension → qt/sync/syncWatcher → core/serverStore → qt/sync/transport → SSH/SCP
3. **SDK Build Chain**: extension → sdk/sdkExtension → sdk/modules/sdkBuilder → task execution
4. **CLI Chain**: cli/index → qt/cli or sdk/cli → qt/shared or sdk/cli logic → stdout
5. **Config Panel**: extension → ui/configPanel → vscode/settingsStore → .forja/ files
6. **Status Bar**: extension → ui/unifiedStatusBar → qt state + sdk state → display

## Module Placement

| 类型 | 放置位置 |
| --- | --- |
| 纯 Node 工具/IO | `src/core/` |
| Qt 构建/调试/运行 | `src/qt/build/` |
| Qt 项目扫描/管理 | `src/qt/project/` |
| Qt 环境检测 | `src/qt/env/` |
| Qt 平台差异 | `src/qt/platform/{win,linux}/` |
| Qt 不依赖 vscode 的逻辑 | `src/qt/shared/` |
| Qt 远程同步 | `src/qt/sync/` |
| Qt CLI | `src/qt/cli/` |
| SDK 模块 | `src/sdk/modules/` |
| SDK CLI | `src/sdk/cli/` |
| SDK 平台差异 | `src/sdk/platform/` |
| UI（状态栏/面板） | `src/ui/` |
| 统一 CLI 入口 | `src/cli/` |
| 单元测试 | `src/test/` |

## High-Risk Changes

| 文件/目录 | 风险 |
| --- | --- |
| `src/extension.ts` | 扩展入口，签名和导出不可变 |
| `package.json` contributes | 命令 ID、activationEvents 已发布 |
| `src/core/settingsIO.ts` | Qt 配置持久化，格式变更影响用户数据 |
| `src/vscode/settingsStore.ts` | 配置存储中枢，多模块依赖 |
| `src/core/serverStore.ts` | 全局服务器列表，格式变更影响 CLI + 扩展 |
| `src/qt/shared/` | CLI 和扩展共用，不可引入 vscode |
| `scripts/build-cli.js` | CLI 打包逻辑，路径变更导致产物缺失 |

## Active Rules

| 规则文件 | 适用场景 |
| --- | --- |
| `architecture-dependencies.md` | 新增模块、跨模块引用、分层变更 |
| `typescript-standards.md` | 所有 TS 代码编写 |
| `module-communication.md` | 模块间通信、状态传递 |
| `vscode-extension-patterns.md` | 扩展命令注册、生命周期、Webview |
| `platform-abstraction.md` | 平台相关代码、win/linux 差异 |
| `build-and-package.md` | 构建打包命令使用 |

## Reading Sets

| 任务类型 | 阅读组合 |
| --- | --- |
| 新功能开发 | `new-feature` + `architecture-dependencies` + `vscode-extension-patterns` |
| Bug 修复 | `bug-fix` + `module-communication` + `typescript-standards` |
| 重构 | `refactor` + `architecture-dependencies` + `typescript-standards` |
| 跨模块改动 | `cross-module-change` + `architecture-dependencies` + `module-communication` |
| 平台相关 | `new-feature` + `platform-abstraction` + `architecture-dependencies` |
| CLI 相关 | `new-feature` + `architecture-dependencies` + `build-and-package` |

## Project Hard Constraints

- 不修改 `extension.ts` 的 activate 函数签名或导出
- 不删除或重命名现有 VSCode 命令 ID
- 不修改 `package.json` 中已发布的 `activationEvents`
- 不把平台相关逻辑写进 `shared/`（shared 必须不依赖 vscode）
- 不在 CLI 模块中引入 `vscode` 依赖
- 不在 Qt 模块中使用 `vscode.workspace.getConfiguration`（应走 settingsStore）
- SDK 扩展模块通过 `vscode/settingsStore` 读写统一项目配置；SDK CLI 走 `core/settingsIO`
- 不让 `sdk/` 和 `qt/` 之间产生直接 import 依赖
- 新增命令后同步 `package.json` contributes 和 `extension.ts` 注册
- 新增配置项后同步 `package.json` configuration（SDK）或 `core/settingsIO.ts`（Qt）
- 打包必须用 `npm run package:all`，禁止用 compile 替代
