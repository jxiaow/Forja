---
name: diagnostic-fix-accuracy
description: Diagnostic fix fields must point to commands that can actually solve the problem, not commands that require the missing prerequisites to already exist
source: auto-skill
extracted_at: '2026-07-03T09:08:05.701Z'
---

# Diagnostic Fix Field Accuracy

## The Problem

When a diagnostic has a `fix` field, it tells the user (or AI agent) which command to run to resolve the issue. If the `fix` points to a command that **requires the missing prerequisites to already exist**, the user will run that command, it will fail with the same error, and they'll be stuck in a loop.

## Bug Pattern: Circular Fix References

```typescript
// BUG: sync not configured, but fix points to sync (which needs config)
if (!project.enabled) {
    return { 
        ok: false, 
        error: 'sync not configured', 
        nextAction: 'forja sync'  // ❌ Will fail again!
    };
}

// BUG: server not found, but fix points to server list (can't create from there)
if (!server) {
    return { 
        ok: false, 
        error: 'server not found', 
        nextAction: 'forja server'  // ❌ Only lists servers, can't create
    };
}
```

## Correct Pattern: Point to Setup Commands

```typescript
// CORRECT: point to setup command that can create the missing config
if (!project.enabled) {
    return { 
        ok: false, 
        error: 'sync not configured', 
        nextAction: 'forja setup remote'  // ✅ Interactive setup creates config
    };
}

// CORRECT: point to command that can create the missing resource
if (!server) {
    return { 
        ok: false, 
        error: 'server not found', 
        nextAction: 'forja server add --name <name> --host <host> --username <user>'  // ✅ Creates server
    };
}
```

## Why Setup Commands Over Management Commands

| Scenario | Wrong Fix | Right Fix | Why |
|----------|-----------|-----------|-----|
| Sync not configured | `forja sync` | `forja setup remote` | Setup provides interactive guidance |
| Server missing | `forja server` | `forja server add ...` | Management command needs flags |
| Remote path missing | `forja remote --server X` | `forja setup remote` | Setup handles full config chain |
| Toolchain missing | `forja list env` | `forja setup --qt-path <path>` | Setup saves config, list only shows |

**Setup commands** (`forja setup`, `forja setup remote`):
- Provide interactive guidance
- Handle the full configuration chain (server → sync → remote path → deployment)
- Can create missing prerequisites from scratch
- Best for first-time setup or when infrastructure is missing

**Management commands** (`forja server`, `forja remote`):
- Require prerequisites to already exist
- Need explicit flags for all parameters
- Best for modifying existing configuration
- Don't provide interactive guidance

## The `choices` Pattern for Ambiguous Scenarios

When there are multiple valid paths forward and the right choice depends on user intent, return a `choices` array instead of a single `nextAction`:

```typescript
// When workspace is completely uninitialized
if (!activeTarget && readiness.toolchain === 'unknown') {
    result.nextAction = undefined;  // No single right answer
    result.choices = [
        { 
            label: 'forja setup', 
            command: 'forja setup', 
            description: 'Local setup only' 
        },
        { 
            label: 'forja setup remote', 
            command: 'forja setup remote', 
            description: 'Local + remote setup' 
        },
    ];
}
```

This lets the AI agent present options to the user rather than guessing.

## Audit Checklist

When reviewing diagnostic `fix` fields:

- [ ] **Does the fix command require the missing prerequisite?** If yes, it's a circular reference
- [ ] **Can the fix command create the missing resource?** Setup commands usually can, management commands usually can't
- [ ] **Does the fix command provide interactive guidance?** If the user is missing config, they probably need guidance
- [ ] **Are there multiple valid paths?** If yes, use `choices` instead of `nextAction`
- [ ] **Will the fix command fail with the same error?** If yes, it's the wrong fix

## Common Scenarios

| Missing Resource | Wrong Fix | Right Fix |
|-----------------|-----------|-----------|
| No sync config | `forja sync` | `forja setup remote` |
| No server | `forja server` | `forja server add ...` or `forja setup remote` |
| No remote path | `forja remote --server X` | `forja setup remote` |
| No Qt path | `forja list env qt` | `forja setup --qt-path <path>` |
| No VS install | `forja list env vs` | `forja setup --vs-install <path>` |
| No active target | `forja list targets` | `forja setup` (if uninitialized) or `forja use target` (if initialized) |

## Real Example from This Project

When `forja sync --server` was removed and sync became read-only:

**Before (wrong):**
```typescript
if (!syncConfig.selectedServer) {
    diagnostics.push({
        level: 'error',
        message: 'Sync not configured',
        fix: 'forja sync --server <name> --remote-path <path>'  // ❌ Removed!
    });
}
```

**After (correct):**
```typescript
if (!syncConfig.selectedServer) {
    diagnostics.push({
        level: 'error',
        message: 'Sync not configured',
        fix: 'forja setup remote'  // ✅ Interactive setup
    });
}
```

## Rule of Thumb

**A `fix` field must point to a command that can create the missing prerequisites, not a command that requires them.** If in doubt, point to a setup command.
