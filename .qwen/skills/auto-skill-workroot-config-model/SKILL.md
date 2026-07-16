---
name: workroot-config-model
description: When designing multi-project config management, use explicit workroot registration instead of cwd-based config anchoring — prevents config divergence from different working directories
source: auto-skill
extracted_at: '2026-07-15T11:07:42.200Z'
---

# Workroot Config Model

## Problem

When config storage key is `hash(cwd + type)`, running commands from different subdirectories produces different configs. Three-layer storage (activeTarget + domain config + targetToolchains) duplicates data with no single source of truth.

## Solution

Register an explicit **workroot** during project initialization. All subsequent commands resolve config by walking up from cwd to find the nearest registered workroot.

### Storage Layout

```
~/.forja/
  workspaces.json            ← workroot registry (path list)
  workspaces/
    <hash>.json              ← per-workspace config (targets + modulePrefs)
```

### Key Rules

1. **Registration before config save** — `registerWorkroot()` before `saveWorkspaceConfig()` to prevent orphan configs on crash
2. **Deepest prefix match** — from cwd upward, find the longest matching registered workroot path
3. **Subdirectory awareness** — `resolveWorkroot(cwd)` must be called before `isWorkrootRegistered(cwd)` to detect parent workroots
4. **Single source of truth** — per-workspace JSON contains targets, toolchain, and module preferences (no separate activeTarget/toolchain files)
5. **Target ID generation** — `{kind}-{projectBasename}-{mode}-{arch}` with hash suffix on collision

### CLI Commands

| Command | Workroot Required | Behavior |
|---------|------------------|----------|
| `forja init` | No | Registers workroot, scans projects, configures initial target |
| `forja use target` | No (auto-prompts) | Switches target; prompts to register if not found |
| `forja status` | No (shows "not initialized") | Shows readiness with diagnostic pointing to `forja init` |
| All others | Yes | Error + nextAction: `forja init` |

### Pitfalls Found

- `--answers` mode without `--json` failed because `interactive` was computed as `!wantsJson && !answers` — fix: check `!options.interactive && !options.answers`
- `console.log` in command handlers breaks JSON output — guard with `!args.json`
- `nextAction` strings must use exact command syntax (e.g., `forja remote set --server` not `forja remote --server`)
- `resolveWorkroot(cwd)` must be called before `isWorkrootRegistered(cwd)` — otherwise running init from a subdirectory registers the subdirectory as a new workroot instead of detecting the parent
- After storage migration, ALL consumers must read from the new source — `list env` was still using old settingsIO for "configured" marks while `list targets` used workspaceStore, causing inconsistency
- Dead function parameters: `assessToolchainReadiness(summary, target, diagnostics, qtPath?)` — the `qtPath` param was always falsy when checked (`!target.qtPath` implies `qtPath` is also falsy), making `pathSuffix` dead code
- Unreachable code after early return: `if (wantsJson) { return; } ... if (wantsJson) { ... }` — the second check is unreachable
- Flag scope: `--all` in global `knownFlags` was silently accepted by all subcommands but only used by `reset` — move to per-subcommand validation
- Duplicate scanning: `scanProjects()` called in both `handleNewWorkroot` and `configureNewTarget` — fix: pass candidates as parameter to avoid redundant I/O
- Misleading error messages: answers mode missing `project` field returned "noProjectsFound" instead of "answersMissingProject" — error message must match the actual failure reason

### Atomic File Writes

Config files (`workspaces.json`, `workspaces/<hash>.json`) must use **write-to-temp-then-rename** pattern to prevent corruption on interrupt:

```typescript
function atomicWriteFileSync(filePath: string, data: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    const tmpPath = filePath + '.tmp.' + process.pid;
    try {
        fs.writeFileSync(tmpPath, data, 'utf8');
        fs.renameSync(tmpPath, filePath);  // atomic on most filesystems
    } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw e;
    }
}
```

Without this, `fs.writeFileSync` can leave a truncated/corrupted JSON file if the process is killed mid-write. The `loadWorkspaceConfig` catch block returns empty config on corruption, causing **silent data loss** of all saved targets.

### Silent Return vs Explicit Error

Functions that modify persistent state must return success/failure, not silently return void:

```typescript
// BAD: caller can't distinguish "saved" from "skipped because precondition failed"
export function setActiveTarget(cwd: string, target: ActiveTarget): void {
    const workroot = resolveWorkroot(cwd);
    if (!workroot) { return; }  // silent — caller assumes success
    ...
}

// GOOD: caller checks and reports error
export function setActiveTarget(cwd: string, target: ActiveTarget): boolean {
    const workroot = resolveWorkroot(cwd);
    if (!workroot) { return false; }
    ...
    return true;
}
```

### Cross-Module Utility Consistency

When multiple modules define the same utility function (e.g., `normalizePath`), they must use the **same implementation**. In this project, `candidates.ts` had a local `normalizePath` that only did `replace(/\\/g, '/')` while `workspaceStore.ts` also lowercased on Windows. This caused path comparison failures on Windows (`list targets` current/configured marks were always false).

**Rule**: Import shared utilities from a single source module. Never duplicate utility functions across modules.
