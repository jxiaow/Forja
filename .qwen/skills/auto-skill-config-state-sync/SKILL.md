---
name: config-state-sync
description: workspaceStore is the single source of truth for all config — TargetProfile with nested toolchain, ActiveTarget is a type alias, module prefs separate from target fields, VSCode settingsStore reads from workspaceStore
source: auto-skill
extracted_at: '2026-06-22T02:08:39.572Z'
---

# Config State Synchronization

Forja uses a **single workspaceStore** as the source of truth for all target and toolchain configuration. Both CLI and VSCode read/write through workspaceStore. The old settingsIO per-project files only store sync/remote settings now.

## Storage Model

```
~/.forja/
  workspaces.json            ← workroot registry (path list)
  workspaces/
    <hash>.json              ← per-workspace: targets + modulePrefs
  servers.json               ← global server list (includes remote selectedServer/remotePaths)
  config.json                ← global config (lang)
  projects/
    <hash>.json (type=sync)  ← sync enabled/ignore only
    <hash>.json (type=remote) ← remote build config (workspaceMode, repos, etc.)
```

### WorkspaceConfig

```typescript
interface WorkspaceConfig {
    workroot: string;
    activeTarget: string | null;
    targets: Record<string, TargetProfile>;
    qtModulePrefs: QtModulePrefs;    // workspace-level: qmakeArgs, cStandard, etc.
    cppModulePrefs: CppModulePrefs;  // workspace-level: scanDepth
}
```

### TargetProfile (single source of truth for target + toolchain)

```typescript
interface TargetProfile {
    id: string;
    name: string;
    kind: 'qt' | 'cpp';
    project: string;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    runAt: 'local' | 'remote';
    toolchain: ToolchainConfig;
}

interface ToolchainConfig {
    qtPath?: string;
    qtVersion?: string;
    vsInstall?: string;
    vsVersion?: string;
    jomPath?: string;
    qmakeTarget?: string;
}
```

### ActiveTarget is a type alias

```typescript
export type ActiveTarget = TargetProfile;
```

All CLI commands use `TargetProfile` directly. Field access uses nested toolchain: `target.toolchain.qtPath`, NOT `target.qtPath`.

## Rules

### 1. All config reads come from workspaceStore

Both CLI (`cli/commands/`) and VSCode (`vscode/settingsStore.ts`) read target/toolchain from workspaceStore. The old `loadQtSettings`/`loadSdkSettings` in settingsIO are NOT used for Qt/SDK config anymore — only for sync/remote.

### 2. VSCode settingsStore separates target writes from module-pref writes

When writing Qt/SDK settings back to workspaceStore (`_saveQtToStore`/`_saveSdkToStore`):
- **Module prefs** (qmakeArgs, cStandard, scanExcludeDirs, etc.) are workspace-level — saved even without an active target
- **Target-specific fields** (mode, arch, qtPath, vsInstall, etc.) require an active target — silently skip if no target

```typescript
// Module prefs — save first, before target guard
switch (key) {
    case 'qmakeArgs': config.qtModulePrefs.qmakeArgs = value; saveWorkspaceConfig(config); return;
    // ... other prefs
}
// Target fields — require active target
if (!targetId) { return; }
```

### 3. selectedServer/remotePaths live in RemoteSettings only

`SyncSettings` and `ProjectSyncConfig` only have `enabled` and `ignore`. Server selection and remote paths are stored in `RemoteSettings` (`loadRemoteSettings`/`saveRemoteSettings`). All consumers (configPanel, sync status, remote plan) read from RemoteSettings.

### 4. Register workroot BEFORE saving config

In `forja init`, call `registerWorkroot(workroot)` AFTER `configureNewTarget` succeeds. If target configuration fails, the workroot is not registered — no orphan state.

### 5. setActiveTarget is full-replace

`setActiveTarget` replaces the entire target profile: `config.targets[id] = target`. Callers must construct the full profile (usually via `{ ...currentTarget, ...updates }`).

### 6. Quick switch skips toolchain re-detection

`forja use target --project <id>` matching a saved target by ID updates only the `activeTarget` pointer.

### 7. build --project copies toolchain from savedProfile

When `--project` is provided, the constructed target copies toolchain from the matching savedProfile in workspaceStore.

### 8. Per-subcommand flag validation

Each `use` subcommand has its own known-flag set. `suppress-warnings` requires `--add` or `--rm` when providing codes — bare codes without a flag return an error.

## Checklist for new config code

- [ ] Read toolchain? → `target.toolchain.qtPath` from workspaceStore
- [ ] Write config? → workspaceStore (not settingsIO for Qt/SDK)
- [ ] Write module pref? → Save even without active target
- [ ] Write target field? → Requires active target
- [ ] Read server/remotePath? → `loadRemoteSettings`, not sync settings
- [ ] Register workroot? → After successful configuration
