---
name: config-state-sync
description: When modifying Forja target selection, module switching, or process lifecycle, write to ALL config layers — activeTarget is a router, not the source of truth
source: auto-skill
extracted_at: '2026-06-22T02:08:39.572Z'
---

# Config State Synchronization

Forja has **multiple config/state layers** that must stay consistent. Changing one without updating the others causes silent misrouting — the UI shows one thing but build/run/stop operates on another.

## The Layers

| Layer | Storage | Consumers |
|---|---|---|
| **Routing** | `activeTarget` (settingsIO) | `build.ts`, `run.ts`, `stop.ts`, `clean.ts` — dispatch to Qt or SDK backend |
| **Qt domain** | `qtSettings.pinnedProject`, `qtSettings.mode/arch` | `qtCore.ts createActionPlan` → `resolveSavedProject` reads `pinnedProject` |
| **SDK domain** | `sdkSettings.pinnedProject`, `sdkSettings.mode/arch` | `build.ts` SDK path reads `sdkSettings.pinnedProject` as fallback |
| **UI module** | `statusBar._activeModule` | Status bar display, play button label |
| **Runtime** | `qtState.isRunning` | Status bar run/stop button toggle |

## Rules

### 1. Target selection writes to ALL layers

When `runUseTarget()` switches to a new project, it must write:
- `activeTarget` (routing) — always
- `qtSettings.pinnedProject` — when kind is `qt`
- `sdkSettings.pinnedProject` — when kind is `sdk`
- mode/arch in the matching domain config

**Why:** `createActionPlan` does NOT read `activeTarget.project` for Qt — it calls `resolveSavedProject(workspace, qtSettings)` which reads `qtSettings.pinnedProject`. Without syncing, build/run fails with "未配置项目".

### 2. Module switching restores full activeTarget from domain config

When the status bar `switch:qt` / `switch:sdk` fires, it must restore the **full** activeTarget (kind + project + mode + arch) from the target module's domain config (`qt.pinnedProject` or `sdk.pinnedProject`). Never just flip `kind` — that leaves the old project path intact and causes `{ kind: 'sdk', project: 'app.pro' }` corruption.

**Order matters:** `_syncActiveTarget()` must succeed **before** calling `setActiveModule()`. If no saved project exists for the target module, do NOT switch the UI module — instead open target selection (`forja.list`). This prevents the status bar from showing SDK while activeTarget is still Qt.

```typescript
// Correct:
if (_syncActiveTarget('sdk')) { setActiveModule('sdk'); }
else { vscode.commands.executeCommand('forja.list'); }

// Wrong:
setActiveModule('sdk');  // UI switches immediately
_syncActiveTarget('sdk'); // May fail, leaving UI/backend out of sync
```

### 3. Process lifecycle updates qtState

`forja.stop` must call `setState('isRunning', false)` after terminating. `forja.run` (detach mode) sets it to `true`. Without clearing, the status bar stays on the stop button.

### 4. VS path storage uses install root, not script path

`vsInstall` must store the VS installation root directory. Downstream code (`resolveVsDevShellPath`, `resolveVsDevCmdPath`) appends `Common7/Tools/Launch-VsDevShell.ps1` or `Common7/Tools/VsDevCmd.bat`. When receiving a script path (e.g. from `--vs-dev-shell`), use `inferVsInstall()` to strip back to the root before storing.

### 5. Target selection rejects projects outside the workspace

`runUseTarget()` must validate that the resolved project path is within the workspace boundary. Check `path.relative(workspace, projectPath)` — if it starts with `..` or is absolute, reject with `use.projectOutsideWorkspace`. This prevents `pinnedProject` from containing `../` escapes that break build/run resolution.

### 6. `runInit()` auto-select syncs domain config

When `runInit()` auto-selects a single target (`totalTargets === 1`), it must write both `activeTarget` AND the matching domain config (`qt.pinnedProject` or `sdk.pinnedProject`). Without this, `forja init` returns `nextActions: ['forja build']` but the immediate next build fails with "未配置项目".

### 7. VSCode `selectProject()` creates activeTarget

The VSCode-side `selectProject()` in `projectManager.ts` writes the old Qt `pinnedProject` setting. It must ALSO call `saveActiveTarget()` to create the routing-layer entry. Without this, old users upgrading see the project in the status bar but build/run fails with "No active target".

### 8. Write ordering: domain config first, router last

When writing to multiple config stores in one operation, always save the **domain config** (qtSettings, sdkSettings, syncSettings, remoteSettings) **before** saving the **router** (activeTarget). If the domain save fails, the router hasn't been updated yet — no partial-write state.

```typescript
// Correct: domain first, router last
saveQtSettings(workspace, qt);   // domain config
setActiveTarget(workspace, newTarget);  // router — last

// Wrong: router first leaves orphan pointer on domain save failure
setActiveTarget(workspace, newTarget);  // router updated
saveQtSettings(workspace, qt);   // fails → activeTarget points to unsynced config
```

**Why:** `runUseTarget()` originally called `setActiveTarget()` before `saveQtSettings()`. If the Qt save threw, activeTarget already pointed to a project whose `pinnedProject`/`mode`/`arch` hadn't been written — build would fail with stale or missing domain config.

### 9. Config panel checks `runUseTarget()` result before saving

`saveManualProPath` in the config panel must call `runUseTarget()` first and check its result. Only save `manualProPath` if `runUseTarget()` succeeds. Otherwise the UI saves a path that build/run will reject (e.g., outside workspace), creating an inconsistent state where the extension recovers the path on startup but build refuses it.

### 10. Config panel mode/arch changes must sync to activeTarget

When the config panel saves SDK `mode` or `arch` (via `saveSdkMode`/`saveSdkArch` in `messageHandler.ts`), it updates `sdkSettings` but NOT `activeTarget`. Since CLI `build.ts` reads `target.mode`/`target.arch` from activeTarget, the CLI will use stale values after a panel change.

**Fix:** After `setSdkSetting('mode', val)`, also update activeTarget:

```typescript
case 'saveSdkMode': {
    setSdkSetting('mode', val);
    const ws = getWorkspaceRoot();
    if (ws) {
        const target = getActiveTarget(ws);
        if (target && target.kind === 'sdk') {
            setActiveTarget(ws, { ...target, mode: val });
        }
    }
    break;
}
```

Same pattern for `saveSdkArch`. Without this, `forja build --plan` shows Debug/Win32 even though the panel shows Release/x64.

### 11. Child workspace config inheritance resolves paths correctly

When `loadActiveTarget()` inherits config from a parent directory (via `resolveConfigPath`), the `project` field is a relative path relative to the **parent** workspace. Status/build/run resolve it against the **child** workspace, producing wrong paths.

**Fix:** `loadActiveTarget()` compares the stored `workspace` field with the current workspace and re-resolves relative project paths:

```typescript
if (result && typeof raw.workspace === 'string' && raw.workspace !== workspace) {
    if (result.project && !path.isAbsolute(result.project)) {
        const absolute = path.resolve(raw.workspace, result.project);
        result.project = path.relative(workspace, absolute);
    }
}
```

## Checklist for new code that touches target/module state

- [ ] Does this code path write to multiple config stores? → domain config first, router (activeTarget) last
- [ ] Does this code path change which project is active? → sync `activeTarget` + domain config (`qt.pinnedProject` or `sdk.pinnedProject`)
- [ ] Does this code path change which module is displayed? → restore full activeTarget from domain config, don't just flip kind
- [ ] Does this code path start/stop a process? → sync `qtState.isRunning`
- [ ] Does this code path store a VS path? → use `inferVsInstall()` to convert script paths to install root
- [ ] Does this code path accept a project path? → validate it's within the workspace boundary
- [ ] Does this code path auto-select a target (init/scan)? → sync domain config, not just activeTarget
- [ ] Does this code path write a legacy config field (manualProPath, pinnedProject)? → also create activeTarget
- [ ] Does this code path call `runUseTarget()`? → check the result before persisting related state
- [ ] Does this code path change SDK mode/arch from the config panel? → also sync to activeTarget
- [ ] Does this code path load activeTarget from a potentially inherited config? → re-resolve relative project paths against the config's origin workspace
