# Module Communication

## Goal

Prevent tight coupling between Qt and SDK modules; ensure state changes propagate through defined channels rather than ad-hoc imports.

## Repo Facts

- Qt state: `src/vscode/qtState.ts` (get/set/subscribe pattern)
- SDK state: `src/sdk/modules/stateManager.ts` (class-based, config-backed)
- Settings (Qt): `src/vscode/settingsStore.ts` → reads from `~/.compilot/projects/*.json`
- Settings (SDK): `src/vscode/settingsStore.ts` → reads from `~/.compilot/projects/*.json`
- UI sync: `src/ui/unifiedStatusBar.ts` imports state from both modules
- Config panel: Webview ↔ extension via `postMessage` / `onDidReceiveMessage`

## Core Rules

1. Qt modules read config via `settingsStore` (never `vscode.workspace.getConfiguration`)
2. SDK extension modules read config via `settingsStore`; SDK CLI reads the pure IO APIs in `core/settingsIO`
3. Cross-module state observation goes through `ui/unifiedStatusBar.ts` — no direct qt↔sdk import
4. Webview communication uses typed message interfaces (defined in configPanel)
5. File-based config changes trigger watchers; do not poll

## Design Checklist

- [ ] State change has a single source of truth identified
- [ ] No new direct import between `qt/` and `sdk/`
- [ ] UI updates driven by state subscription, not imperative calls from business logic

## Implementation Checklist

- [ ] Qt config access uses `getSettings()` / `updateSettings()` from settingsStore
- [ ] SDK config access uses `getSdkSetting()` / `setSdkSetting()` in extension code, or `loadSdkSettings()` / `saveSdkSettings()` from pure CLI settings helpers
- [ ] New state fields added to the appropriate state manager with subscriber notification
- [ ] Webview messages have a `type` discriminator field

## Common Smells

- Importing `qtState` in SDK code to "just check one flag"
- Reading project config JSON directly with `fs` instead of going through settingsStore or settingsIO
- Passing vscode context objects into shared/core modules
