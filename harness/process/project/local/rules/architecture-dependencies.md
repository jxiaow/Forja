# Architecture Dependencies

## Goal

约束代码放置位置和依赖方向，避免引入反向依赖或破坏模块边界。

## Core Rule

依赖方向只能单向向下：

- 高层可以依赖低层
- 低层禁止依赖高层
- `shared/` 禁止依赖 `vscode` 命名空间

## Repo Facts

```
src/
├── extension.ts          # Layer 5: 入口，组装所有模块
├── ui/                   # Layer 4: 纯 UI 层（状态栏、WebView 面板）
├── qt/build/             # Layer 3: Qt 构建任务执行（依赖 vscode.tasks）
├── qt/project/           # Layer 3: 项目管理（依赖 vscode.workspace）
├── qt/sync/              # Layer 3: 远程同步（依赖 vscode + ssh2）
├── sdk/                  # Layer 3: SDK 模块（独立子系统，依赖 vscode）
├── qt/platform/builder.ts # Layer 2+: 平台构建器（依赖 vscode.ShellExecution）
├── qt/platform/*.ts      # Layer 2: 平台抽象（shellPlan/platformConfig 不依赖 vscode）
├── qt/env/               # Layer 2: 环境检测（文件系统操作）
├── core/                 # Layer 1: 核心服务（状态、配置、日志，依赖 vscode）
├── qt/shared/            # Layer 0: 纯逻辑（不依赖 vscode，CLI 复用）
└── cli/                  # Layer 0: CLI 入口（不依赖 vscode）
```

**依赖方向：**

```
extension.ts (入口组装)
  ↓ 初始化 + 注册
ui/ (状态栏、面板)  ←订阅→  core/ (stateManager, configService, settingsStore)
  ↓                           ↓ 提供状态和配置
qt/build/, qt/project/, qt/sync/ (Qt 业务模块)
  ↓ 使用
qt/platform/builder.ts (依赖 vscode.ShellExecution)
  ↓ 调用
qt/platform/shellPlan.ts, platformConfig.ts (纯平台逻辑)
  ↓ 调用
qt/shared/ (纯逻辑，CLI 复用)

sdk/ (独立子系统，内部自成体系)
  ├── modules/stateManager.ts (独立状态)
  ├── modules/configService.ts (vscode.workspace.getConfiguration)
  ├── modules/sdkBuilder.ts (构建执行)
  └── modules/statusBar.ts (独立 UI)
```

**关键边界：**

- `qt/shared/` 和 `cli/` 绝对不能 `import * as vscode from 'vscode'`
- `ui/statusBar.ts` 只订阅 `core/stateManager` 事件，不直接调用 buildManager
- `core/` 不依赖 `qt/` 或 `sdk/` 的具体实现
- `sdk/` 和 `qt/` 之间互不依赖（各自独立子系统）
- `qt/platform/shellPlan.ts` 和 `platformConfig.ts` 不依赖 vscode（只有 `builder.ts` 依赖）

## Placement Guide

- 新 VSCode 命令处理：`src/qt/build/` 或 `src/sdk/modules/`（按模块归属）
- 新平台配置：`src/qt/platform/win/` 或 `src/qt/platform/linux/`
- 新核心服务：`src/core/`
- 新 UI 组件：`src/ui/`
- 新 CLI 子命令：`src/qt/cli/` 或 `src/sdk/cli/`
- 不依赖 vscode 的工具函数：`src/qt/shared/` 或 `src/qt/env/utils.ts`
- 新测试：`src/test/`

## Test Placement Guide

- 测试使用 `node:test` 框架
- 测试文件放在 `src/test/` 目录
- 测试文件命名：`*.test.ts`
- 编译后通过 `node --test out/test` 运行

## Default Fallback

如果一时拿不准落点，按这个顺序排除：

1. 这段逻辑需要 `vscode` API 吗？
   - 不需要：优先放 `qt/shared/` 或 `qt/env/utils.ts`
2. 这是 UI 展示逻辑吗？
   - 是：优先放 `ui/`
3. 这是构建/运行任务吗？
   - 是：优先放 `qt/build/` 或 `sdk/modules/`
4. 这是项目扫描/选择逻辑吗？
   - 是：优先放 `qt/project/`
5. 这是配置读写吗？
   - 是：优先放 `core/configService.ts` 或 `core/settingsStore.ts`
6. 这是平台差异处理吗？
   - 是：优先放 `qt/platform/`

## Design Checklist

- 这段代码的语义归属到底是什么模块
- 是否只是因为"当前文件顺手"才准备放这里
- 是否引入跨层依赖（如 shared 依赖 vscode）
- 新文件是否已经接入 extension.ts 或 package.json
- CLI 相关改动是否保持了与 vscode 的隔离

## Implementation Checklist

- import 是否跨越不合理层级
- 是否把临时逻辑塞进 extension.ts
- 是否把公共能力写进业务模块
- 新命令是否已注册到 package.json contributes 和 extension.ts
- 新配置项是否已添加到 package.json contributes.configuration
- disposable 是否已推入 context.subscriptions

## Common Smells

- `qt/shared/` 中出现 `import * as vscode`
- `cli/` 中出现 `import * as vscode`
- `sdk/` 直接依赖 `qt/` 的内部模块
- 新功能直接堆进 extension.ts 而不是分模块
- 平台相关逻辑散落在业务模块中而不是集中到 `platform/`
- UI 层直接调用构建逻辑而不是通过 stateManager 事件
