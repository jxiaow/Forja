# VSCode Extension Patterns

## Goal

Ensure extension lifecycle, command registration, and resource management follow VSCode best practices and don't break activation or disposal.

## Repo Facts

- Entry: `src/extension.ts` → `activate(context)` / `deactivate()`
- Commands registered in `activate()` via `vscode.commands.registerCommand`
- Command IDs declared in `package.json` `contributes.commands`
- Webview: `ConfigPanel` registered as `WebviewViewProvider`
- Tasks: custom task provider for build/run operations
- Status bar: `src/ui/unifiedStatusBar.ts`

## Core Rules

1. Every `registerCommand` / `registerWebviewViewProvider` / event listener must push to `context.subscriptions`
2. Never modify the `activate` function signature or its export
3. Command IDs in code must match `package.json` `contributes.commands` exactly
4. New commands require both `package.json` entry AND registration in `extension.ts`
5. Disposable resources (watchers, channels, providers) must be disposed on deactivation
6. Do not use global mutable state outside of designated state managers

## Design Checklist

- [ ] New command has a unique ID following `forja.{module}.{action}` pattern
- [ ] Webview content uses CSP-compliant inline styles/scripts
- [ ] Long-running operations show progress via `vscode.window.withProgress`

## Implementation Checklist

- [ ] Command registered and pushed to `context.subscriptions`
- [ ] `package.json` `contributes.commands` updated with title
- [ ] No floating promises in activation path
- [ ] Tested via Extension Development Host (F5)

## Common Smells

- Registering a command but forgetting to add it to `package.json` (command won't appear in palette)
- Creating a `FileSystemWatcher` without disposing it
- Using `setTimeout` for sequencing instead of proper async/await
