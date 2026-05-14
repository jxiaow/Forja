# Module Communication

## Goal

约束模块间通信方式，避免随意绕过既有门面和通信机制。

## Repo Facts

**Qt 模块：**

- 全局状态通过 `core/stateManager.ts` 管理，使用事件订阅模式（`onStateChange` 返回 Disposable）
- 配置读写走 `core/configService.ts`（门面）→ `core/settingsStore.ts`（持久化到 `.compilot/settings.json`）
- 不使用 `vscode.workspace.getConfiguration()`，配置完全自管理
- UI 层（statusBar）订阅 stateManager 事件，不直接调用业务模块
- ConfigPanel 通过 WebView message 与扩展通信
- CLI 通过 `qt/shared/` 复用核心逻辑，不依赖 vscode

**SDK 模块：**

- 独立的 `sdk/modules/stateManager.ts`（非共用 core/stateManager）
- 配置通过 `vscode.workspace.getConfiguration('compilot.sdk')` 读写
- 独立的 `sdk/modules/configService.ts`（VS 环境检测）
- 独立的 `sdk/modules/statusBar.ts`（UI 展示）
- SDK 和 Qt 模块之间互不依赖，各自独立初始化

## Communication Choice Guide

| 场景                         | 推荐方式                                    |
| ---------------------------- | ------------------------------------------- |
| Qt 模块状态同步              | `core/stateManager` 事件订阅（`onStateChange`） |
| Qt 配置读写                  | `core/configService.ts` → `settingsStore.ts`（`.compilot/settings.json`） |
| SDK 配置读写                 | `vscode.workspace.getConfiguration('compilot.sdk')` |
| SDK 状态管理                 | `sdk/modules/stateManager.ts`（独立实例）   |
| Qt UI 更新                   | 订阅 `core/stateManager` → 更新 StatusBarItem |
| SDK UI 更新                  | `sdk/modules/statusBar.ts` 订阅 SDK stateManager |
| ConfigPanel ↔ Extension      | WebView `postMessage` / `onDidReceiveMessage` |
| 构建任务执行                 | `vscode.tasks.executeTask()`                |
| 文件系统监听                 | `vscode.workspace.createFileSystemWatcher()` |
| CLI 复用扩展逻辑             | 通过 `qt/shared/` 纯函数                   |
| 跨平台差异                   | `platform/` 工厂模式                        |

## State Flow

**Qt 模块：**

```
用户操作 / 文件变化
  ↓
业务模块（qt/build, qt/project）
  ↓ setState()
core/stateManager（单一状态源，.compilot/settings.json 持久化）
  ↓ onStateChange 事件通知
ui/statusBar（纯展示层）
```

**SDK 模块：**

```
用户操作 / 配置变化
  ↓
sdk/modules/sdkBuilder, sdk/modules/showActions
  ↓ 直接修改
sdk/modules/stateManager（独立状态，vscode settings 持久化）
  ↓ 属性 setter 触发
sdk/modules/statusBar（独立展示层）
```

## ConfigPanel Communication

```
ConfigPanel WebView
  ↓ postMessage({ type, payload })
configPanel/index.ts (WebviewViewProvider)
  ↓ onDidReceiveMessage
configPanel/messageHandler.ts
  ↓ 调用
core/configService.ts 或 core/settingsStore.ts
```

## Design Checklist

- 这次交互是否已有现成通信路径
- 是否真的需要新增事件或状态字段
- 是否会绕过 stateManager 直接修改 UI
- 是否把该走配置服务的逻辑写成局部硬编码
- CLI 路径是否保持了与 vscode 的隔离

## Implementation Checklist

- 是否直接操作 StatusBarItem 而不是通过 stateManager
- Qt 模块是否绕过 configService/settingsStore 直接读写配置
- SDK 模块是否误用了 Qt 的 settingsStore（应使用 vscode.workspace.getConfiguration）
- 是否在 shared/ 中引入了 vscode 依赖
- 新增的 disposable 是否推入 context.subscriptions
- WebView 消息是否有明确的 type 字段区分
- Qt 和 SDK 之间是否引入了互相依赖

## Common Smells

- UI 层直接调用 buildManager 而不是订阅状态
- 业务模块直接操作 StatusBarItem
- ConfigPanel 绕过 messageHandler 直接处理逻辑
- Qt 模块中使用 `vscode.workspace.getConfiguration` 而不是 settingsStore
- SDK 模块中使用 Qt 的 settingsStore 而不是 vscode settings
- CLI 模块引入了 vscode 命名空间
- 新增文件监听但忘记 dispose
- stateManager 事件名不一致或重复定义
- Qt 和 SDK 模块之间产生了直接 import 依赖
