# AGENTS.md

Project instructions for agentic coding assistants working in this repository.

## Project Overview

This is a VSCode extension for Qt/C++ development on Windows. It provides:
- Status bar with Debug/Release mode toggle
- QMake, Build, Rebuild, Run commands
- .pri/.pro file watcher for automatic file sync
- Configuration panel for VS DevShell and project paths

## Build Commands

```bash
# Compile TypeScript to JavaScript
npm run compile

# Watch mode for development
npm run watch
```

## Test Commands

```bash
# Run all tests (compile + node --test)
npm test
```

Manual testing:
1. Press F5 in VSCode to launch Extension Development Host
2. Test commands via Command Palette (Ctrl+Shift+P) → "Qt Pilot:"

## Lint/Typecheck Commands

```bash
# TypeScript type checking (no separate lint configured)
npx tsc --noEmit
```

## Code Style Guidelines

### Imports

```typescript
// Use namespace imports for modules with multiple exports
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Use named imports for specific functions
import { createStatusBar, setBuilding, toggleMode, getMode } from './statusBar';
import { registerPriWatcher } from './priWatcher';
```

### Formatting

- **Indentation**: 4 spaces (TypeScript standard)
- **Quotes**: Single quotes for strings, double quotes for JSON/HTML templates
- **Semicolons**: Required
- **Trailing commas**: Not used

### Types

- TypeScript strict mode is enabled
- Use explicit return types for exported functions
- Use type annotations for function parameters
- Prefer `string | null` over `string | undefined` for optional returns

```typescript
// Good
export function getMode(): BuildMode { return _mode; }
function findPriOrPro(dir: string, root: string): string | null { ... }

// Type alias for unions
export type BuildMode = 'debug' | 'release';
```

### Naming Conventions

- **Files**: camelCase.ts (e.g., `buildManager.ts`, `configPanel.ts`)
- **Classes**: PascalCase (e.g., `ConfigPanel`)
- **Functions**: camelCase, exported functions are public API
- **Private methods**: Prefix with underscore (e.g., `_loadConfig`, `_saveConfig`)
- **Constants**: camelCase at module level (e.g., `actionDefs`)
- **Static readonly**: PascalCase (e.g., `ConfigPanel.viewId`)

### Error Handling

- Use try-catch for file operations with silent fallbacks
- Use async/await with .catch() for command handlers
- Display errors to user via `vscode.window.showErrorMessage()`

```typescript
// Silent fallback for non-critical operations
function getExeName(proFilePath: string): string {
    try {
        // ... file operations
    } catch {}
    return 'app'; // Default fallback
}

// User-facing error handling
const err = (e: Error) => vscode.window.showErrorMessage(e.message);
// Usage: someAsyncOp().catch(err)
```

### Async Patterns

```typescript
// Prefer async/await
export async function runDebug() {
    const execution = await vscode.tasks.executeTask(buildTask);
    return new Promise<void>((resolve, reject) => {
        const disposable = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) {
                disposable.dispose();
                // ... handle result
            }
        });
    });
}
```

### VSCode Extension Patterns

- Register disposables in `context.subscriptions`
- Use `vscode.workspace.getConfiguration()` for settings
- Use `vscode.tasks` for build operations
- Use `vscode.window.showInformationMessage()` for user prompts

### Chinese Language

- This project uses Chinese for user-facing strings (commands, messages, tooltips)
- Keep Chinese strings for user-facing text
- Technical terms in code remain in English

## Project Structure

```
src/
├── extension.ts                    # 入口，初始化 + 命令注册
├── core/
│   ├── stateManager.ts             # 单一状态源，事件订阅
│   ├── configService.ts            # 统一配置读写、BuildConfig 组装、路径解析
│   ├── settingsIO.ts               # 配置文件纯 IO 逻辑（不依赖 vscode）
│   ├── settingsStore.ts            # 自管理配置存储（vscode 集成 + 文件监听）
│   ├── workspaceResolver.ts        # 多文件夹工作区项目根目录解析
│   └── logger.ts                   # Output channel 日志
├── build/
│   ├── buildManager.ts             # QMake/Build/Run 任务执行
│   ├── debugger.ts                 # 调试会话启动
│   └── configGenerator.ts          # IntelliSense c_cpp_properties.json 生成
├── project/
│   ├── projectManager.ts           # .pro 扫描、解析、项目选择
│   ├── priWatcher.ts               # .pri/.pro 文件监听
│   ├── selectedProject.ts          # 选中项目编解码
│   └── projectDisplay.ts           # 项目显示名称逻辑
├── env/
│   ├── envDetector.ts              # Qt 扫描公共逻辑 + detectEnv 入口（无状态）
│   └── utils.ts                    # 通用工具函数 (execAsync, readDir, isDir)
├── ui/
│   ├── statusBar.ts                # 纯 UI 层，订阅 stateManager
│   ├── statusBarLabels.ts          # 状态栏标签文本生成
│   └── configPanel/
│       ├── index.ts                # WebviewViewProvider，消息路由
│       ├── messageHandler.ts       # 消息处理逻辑
│       ├── template.ts             # HTML/CSS/JS 模板生成
│       └── configPanel.html        # 面板 HTML 模板
├── platform/
│   ├── builder.ts                  # PlatformBuilder 接口 + createBuilder 工厂
│   ├── platformConfig.ts           # PlatformConfig 平台抽象接口
│   ├── shellPlan.ts                # BuildConfig/CommandPlan/ShellPlanBuilder
│   ├── win/
│   │   ├── builder.ts              # Windows 平台配置 (winConfig)
│   │   └── envDetector.ts          # Windows 环境检测
│   └── linux/
│       ├── builder.ts              # Linux 平台配置 (linuxConfig)
│       └── envDetector.ts          # Linux 环境检测
├── shared/                         # 扩展与 CLI 共享逻辑（不依赖 vscode）
│   ├── qtCore.ts                   # CLI 核心逻辑 (createActionPlan)
│   ├── commandRunner.ts            # 命令执行器 (runCliResult)
│   ├── configResolver.ts           # BuildConfig 解析
│   ├── localState.ts               # .qtpilot/ 本地状态读写
│   ├── projectScanner.ts           # .pro 文件扫描 + 解析
│   └── runtimeTarget.ts            # 运行时目标解析
├── cli/
│   ├── index.ts                    # CLI 入口
│   ├── args.ts                     # 命令行参数解析
│   └── types.ts                    # CLI 类型定义
├── mcp/
│   └── server.ts                   # MCP Server（AI 工具集成）
├── sync/
│   ├── syncWatcher.ts              # 远程同步状态栏 + 文件监听
│   ├── sftpClient.ts              # 同步编排层（密码管理 + git diff + 上传流程）
│   ├── resolver.ts                 # 同步配置解析
│   ├── transport.ts                # SSH/SCP 传输操作
│   ├── serverStore.ts              # 服务器配置存储
│   ├── syncState.ts                # 同步状态追踪
│   ├── syncCli.ts                  # CLI 同步模块（不依赖 vscode）
│   └── crypto.ts                   # 密码加解密
└── test/                           # 单元测试（node:test）
out/                                # 编译输出 (gitignored)
```

## Important Notes

- Target platform: Windows only (MSVC, x86)
- Requires Visual Studio DevShell for compilation
- Uses `jom` for parallel builds (nmake compatible)
- Extension activates when workspace contains `.pro` files

## Dependencies

- `@types/vscode`: VSCode extension API types
- `@types/node`: Node.js types
- `typescript`: Compiler only (runtime uses VSCode's Node)
- `@modelcontextprotocol/sdk`: MCP server SDK（MCP 工具集成）
- `zod`: Schema validation（MCP 参数校验）

## No Additional Rules

No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` files found in this repository.
