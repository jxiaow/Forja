---
name: config-write-error-handling
description: All config save operations must be wrapped in error handling to prevent Node stack traces from leaking to users
source: auto-skill
extracted_at: '2026-06-23T16:30:00.000Z'
---

# Config Write Error Handling

When writing configuration files (settings, active target, server store), all write operations must be wrapped in error handling. Unhandled write failures (EPERM, ENOSPC, etc.) produce raw Node stack traces that break JSON output and confuse users/AI agents.

## The Pattern

Every `save*Settings()` or `writeFileSync()` call that persists user configuration must be wrapped in try/catch, returning a structured error result instead of letting the exception propagate.

### CLI Commands

In CLI command handlers, use a `safeSave` helper:

```typescript
// Helper function
function safeSave(fn: () => void, configName: string): { ok: true } | { ok: false; error: string } {
    try {
        fn();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: `Failed to save ${configName}: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// Usage in command handler
const saveResult = safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
if (!saveResult.ok) {
    return {
        ok: false,
        action: 'use',
        useTarget: 'target',
        changed: [],
        diagnostics: [{ code: 'use.saveFailed', level: 'error', message: saveResult.error }],
        nextActions: ['forja doctor'],
    };
}
```

### Init Command

The init command uses a dedicated `initWriteFailed` helper:

```typescript
function initWriteFailed(e: unknown): InitResult {
    return {
        ok: false,
        action: 'init',
        mode: 'local',
        detected: { qtTargets: 0, sdkTargets: 0, toolchain: {} },
        diagnostics: [{
            code: 'init.configWriteFailed',
            level: 'error',
            message: `Failed to write configuration: ${e instanceof Error ? e.message : String(e)}`,
        }],
        nextActions: ['forja doctor'],
    };
}

// Usage
try {
    saveActiveTarget(workspace, activeTarget);
    saveQtSettings(workspace, qt);
} catch (e) {
    return initWriteFailed(e);
}
```

### Server Commands

Server add/update/remove must wrap write operations:

```typescript
try {
    addServer({ ... });
} catch (e) {
    return {
        ok: false,
        action: 'server',
        serverAction: 'add',
        changed: [],
        diagnostics: [{ code: 'server.saveFailed', level: 'error', message: `Failed to save: ${e instanceof Error ? e.message : String(e)}` }],
        nextActions: ['forja doctor'],
    };
}
```

## Affected Operations

All functions that write to `~/.forja/projects/` or `~/.forja/servers.json`:

| Function | File | Operations |
|----------|------|------------|
| `runUseTarget` | `use.ts` | `saveActiveTarget`, `saveQtSettings`, `saveSdkSettings` |
| `runUseSync` | `use.ts` | `saveSyncSettings` |
| `runUseRemote*` | `use.ts` | `saveRemoteSettings` |
| `runUseQt` | `use.ts` | `saveQtSettings` |
| `runUseSdk` | `use.ts` | `saveSdkSettings` |
| `runInit` | `init.ts` | `saveActiveTarget`, `saveQtSettings`, `saveSdkSettings` |
| `runServerAdd` | `server.ts` | `addServer` |
| `runServerUpdate` | `server.ts` | `updateServer` |
| `runServerRemove` | `server.ts` | `removeServer` |

## Why This Matters

1. **JSON output contract**: CLI commands with `--json` must always return valid JSON. A raw stack trace breaks parsing.
2. **AI agent compatibility**: AI agents parsing `--json` output expect structured `diagnostics` arrays, not crash output.
3. **User experience**: "EPERM: operation not permitted" is unhelpful. "Failed to save Qt settings: EPERM. Run `forja doctor` to diagnose." is actionable.
4. **Idempotency**: If a save fails mid-operation, the error result tells the user what succeeded and what didn't.

## Checklist

- [ ] Does every `save*Settings()` call have error handling?
- [ ] Does every `writeFileSync()` for config files have error handling?
- [ ] Do error results include `nextActions: ['forja doctor']`?
- [ ] Does the error message include the underlying OS error (EPERM, ENOSPC, etc.)?
- [ ] Are multiple saves in one operation wrapped together (so partial failure is reported)?
