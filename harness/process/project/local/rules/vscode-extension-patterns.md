# VSCode Extension Patterns

## Goal

统一 VSCode 扩展开发模式，确保命令注册、生命周期管理和 API 使用符合最佳实践。

## Repo Facts

- 扩展入口：`src/extension.ts`（`activate` / `deactivate`）
- 命令注册：`package.json` contributes.commands + extension.ts 中 `registerCommand`
- 配置声明：`package.json` contributes.configuration
- 激活条件：`workspaceContains:**/*.pro`、`workspaceContains:**/*.sln`、`workspaceContains:**/Makefile`
- WebView：`src/ui/configPanel/`（WebviewViewProvider）
- 状态栏：`src/ui/statusBar.ts`

## Command Registration

```typescript
// extension.ts 中注册命令
const disposable = vscode.commands.registerCommand('compilot.qt.build', async () => {
    await buildManager.build().catch(err);
});
context.subscriptions.push(disposable);
```

**规则：**

- 每个命令必须同时出现在 `package.json` contributes.commands 和 extension.ts 注册逻辑中
- 命令 ID 格式：`compilot.{module}.{action}`（如 `compilot.qt.build`、`compilot.sdk.clean`）
- 所有 registerCommand 返回的 disposable 必须推入 `context.subscriptions`

## Configuration

**Qt 模块** — 使用自管理配置存储（`.compilot/settings.json`）：

```typescript
// 通过 configService 门面读取
import { getQtPath, getVsDevShellPath } from './core/configService';
const qtPath = getQtPath();

// 通过 settingsStore 直接读写
import { getSetting, setSetting } from './core/settingsStore';
const mode = getSetting('mode');
setSetting('mode', 'release');

// 监听配置文件变化（外部编辑时自动重载）
// settingsStore 内部已处理，无需手动监听
```

**SDK 模块** — 使用标准 VSCode 配置 API：

```typescript
// 读取配置
const config = vscode.workspace.getConfiguration('compilot.sdk');
const pinnedProject = config.get<string>('pinnedProject', '');

// 监听配置变化
vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('compilot.sdk')) {
        // 重新加载
    }
});
```

**规则：**

- Qt 模块配置项在 `core/settingsIO.ts` 中定义默认值和类型
- SDK 模块配置项在 `package.json` contributes.configuration 中声明
- Qt 模块不使用 `vscode.workspace.getConfiguration`
- SDK 模块不使用 Qt 的 `settingsStore`

## Task Execution

```typescript
// 创建并执行 Shell Task
const task = new vscode.Task(
    { type: 'shell' },
    vscode.TaskScope.Workspace,
    'Build',
    'compilot',
    new vscode.ShellExecution(command, { cwd: workDir })
);
const execution = await vscode.tasks.executeTask(task);
```

**规则：**

- 构建任务统一使用 `vscode.tasks` API
- Task source 统一为 `'compilot'`
- 监听 `onDidEndTaskProcess` 判断任务结果

## Disposable Management

```typescript
// 所有资源必须正确释放
export function activate(context: vscode.ExtensionContext) {
    // 命令
    context.subscriptions.push(
        vscode.commands.registerCommand(...)
    );
    // 文件监听
    context.subscriptions.push(
        vscode.workspace.createFileSystemWatcher(...)
    );
    // 状态栏
    context.subscriptions.push(statusBarItem);
}
```

**规则：**

- 所有 disposable 必须推入 `context.subscriptions`
- FileSystemWatcher、StatusBarItem、EventEmitter 都是 disposable
- 不要在模块级创建无法释放的资源

## WebView Pattern

```typescript
// WebviewViewProvider
class ConfigPanel implements vscode.WebviewViewProvider {
    public static readonly viewId = 'compilot.configView';

    resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getHtml();
        webviewView.webview.onDidReceiveMessage(msg => {
            // 处理消息
        });
    }
}
```

**规则：**

- WebView HTML 模板放在 `src/ui/configPanel/configPanel.html`
- 消息处理逻辑分离到 `messageHandler.ts`
- WebView 中使用 `acquireVsCodeApi()` 与扩展通信

## Design Checklist

- 新命令是否需要 enablement 条件
- 新配置项的 scope 是 machine 还是 resource
- 是否需要激活条件（activationEvents）
- WebView 是否需要持久化状态

## Implementation Checklist

- 命令是否同时注册到 package.json 和 extension.ts
- disposable 是否推入 context.subscriptions
- 配置变化是否有监听和响应
- Task 执行是否处理了失败情况
- WebView 消息是否有类型区分

## Common Smells

- 命令在 package.json 中声明但 extension.ts 中未注册（或反过来）
- disposable 未推入 subscriptions 导致内存泄漏
- 直接在业务模块中 getConfiguration 而不走 configService
- Task 执行后不监听结果
- WebView 消息处理逻辑堆在 resolveWebviewView 中
- 在 deactivate 中手动清理已经推入 subscriptions 的资源（多余）
