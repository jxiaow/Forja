---
name: post-selection-toolchain-prompt
description: Toolchain version selection (Qt/VS) must happen AFTER project selection, not at startup — only prompt when unconfigured and multiple candidates exist
source: auto-skill
extracted_at: '2026-06-25T08:19:51.296Z'
---

# Post-Selection Toolchain Prompting

Toolchain version selection (Qt path, VS install) must be triggered by project selection, not by extension startup. Only prompt when the toolchain is unconfigured AND multiple candidates are detected.

## The Pattern

```
User selects project → check toolchain for that project type → unconfigured + multiple candidates? → prompt
```

### Flow

1. User selects a target via status bar (`forja._selectTarget`)
2. After target is saved, call `promptToolchainIfNeeded(target.kind)`
3. For `kind === 'qt'`: check `getQtPath()` — if empty, detect Qt, if >1 candidate → QuickPick
4. For `kind === 'sdk'`: check `getVsDevShellPath()` — if empty, detect VS, if >1 candidate → QuickPick
5. If already configured → skip silently
6. If only 1 candidate → auto-configure silently (no prompt needed)

## Why Not at Startup

The original approach ran `autoWriteDetectedEnv(env)` at extension activation, wrapped in `if (project)`. This had two problems:

1. **No Qt project → no prompt**: When only SDK projects exist, `project` (Qt project) is null, so the env detection result is never used. User has 2 Qt versions but never gets asked.
2. **Wrong timing**: Prompting at startup before the user has chosen what to work on is premature. The toolchain needed depends on which project type the user selects.

## Implementation

In `src/vscode/commands.ts`, inside `forja._selectTarget` after successful target selection:

```typescript
vscode.window.showInformationMessage(`Selected: ${target.project}`);
await promptToolchainIfNeeded(target.kind);
```

The `promptToolchainIfNeeded` function:

```typescript
async function promptToolchainIfNeeded(kind: string) {
    const { getQtPath, getVsDevShellPath } = await import('../qt/services/configService');
    const { detectEnv } = await import('../qt/env/envDetector');
    const { inferVsInstall, loadQtSettings, saveQtSettings, loadSdkSettings, saveSdkSettings } = await import('../core/settingsIO');

    if (kind === 'qt' && !getQtPath()) {
        const env = await detectEnv();
        if (env.qtCandidates?.length > 1) {
            // Show QuickPick with Qt versions
            // On selection: saveQtSettings(ws, { ...current, qtPath: picked.path })
        }
    }

    if (kind === 'sdk' && !getVsDevShellPath()) {
        const env = await detectEnv();
        if (env.vsCandidates?.length > 1) {
            // Show QuickPick with VS versions
            // On selection: saveSdkSettings(ws, { ...current, vsInstall: inferVsInstall(picked.devShellPath) })
        }
    }
}
```

## Rules

1. **Don't prompt at startup** — remove or skip `autoWriteDetectedEnv` during activation
2. **Prompt after project selection** — in the target selection flow, after `runUseTarget` succeeds
3. **Context-aware** — Qt project → check Qt versions; SDK project → check VS versions
4. **Only when unconfigured** — `!getQtPath()` or `!getVsDevShellPath()`
5. **Only when ambiguous** — `candidates.length > 1` (single candidate = auto-configure)
6. **Save to workspace config** — use `saveQtSettings` / `saveSdkSettings`, not global config

## Common Pitfalls

- **`if (project)` guard**: Wrapping env detection in `if (project)` means SDK-only workspaces never get toolchain prompts. `project` refers to Qt project — it's null when no Qt project is configured.
- **Wrong config key**: `SdkSettings` has `vsInstall` (not `vsDevCmdPath`). Use `inferVsInstall(devShellPath)` to convert.
- **Detecting env is async**: `detectEnv()` takes time. Don't block the target selection UI — show the "Selected" message first, then prompt.
