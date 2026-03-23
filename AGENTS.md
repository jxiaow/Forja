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

No automated tests are currently configured. Manual testing:
1. Press F5 in VSCode to launch Extension Development Host
2. Test commands via Command Palette (Ctrl+Shift+P) → "XY Qt:"

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
├── extension.ts    # Extension entry point, command registration
├── statusBar.ts    # Status bar UI, mode toggle
├── buildManager.ts # QMake/Build/Run task execution
├── configPanel.ts  # WebView configuration panel
└── priWatcher.ts   # File watcher for .pri/.pro sync
out/                # Compiled JavaScript (gitignored)
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

## No Additional Rules

No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` files found in this repository.