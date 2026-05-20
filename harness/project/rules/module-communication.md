# Module Communication

## Goal

Prevent tight coupling between Qt and SDK modules; ensure state changes propagate through defined channels rather than ad-hoc imports.

## Repo Facts

- Qt state: `src/core/qtState.ts` (get/set/subscribe pattern)
- SDK state: `src/sdk/modules/stateManager.ts` (class-based, config-backed)
- Settings (Qt): `src/core/settingsStore.ts` → reads from `.compilot/settings.json`
- Settings (SDK): VSCode `workspace.getConfiguration('compilot.sdk')`
- UI sync: `src/ui/unifiedStatusBar.ts` imports state from both modules
- Config panel: Webview ↔ extension via `postMessage` / `onDidReceiveMessage`

## Core Rules

1. Qt modules read config via `settingsStore` (never `vscode.workspace.getConfiguration`)
2. SDK modules read config via `vscode.workspace.getConfiguration` (never Qt's settingsStore)
3. Cross-module state observation goes through `ui/unifiedStatusBar.ts` — no direct qt↔sdk import
4. Webview communication uses typed message interfaces (defined in configPanel)
5. File-based config changes trigger watchers; do not poll

## Design Checklist

- [ ] State change has a single source of truth identified
- [ ] No new direct import between `qt/` and `sdk/`
- [ ] UI updates driven by state subscription, not imperative calls from business logic

## Implementation Checklist

- [ ] Qt config access uses `getSettings()` / `updateSettings()` from settingsStore
- [ ] SDK config access uses `vscode.workspace.getConfiguration`
- [ ] New state fields added to the appropriate state manager with subscriber notification
- [ ] Webview messages have a `type` discriminator field

## Common Smells

- Importing `qtState` in SDK code to "just check one flag"
- Reading `.compilot/settings.json` directly with `fs` instead of going through settingsStore
- Passing vscode context objects into shared/core modules
