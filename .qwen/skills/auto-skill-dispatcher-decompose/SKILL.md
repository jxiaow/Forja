---
name: dispatcher-decompose
description: Split monolithic dispatcher functions into standalone action functions — handler does switch, not the core
source: auto-skill
extracted_at: '2026-06-29T12:21:27.264Z'
---

# Dispatcher Decompose Pattern

When a command has multiple sub-actions (plan/status/reset/transfer/run), do NOT implement them as one monolithic function with a giant switch and shared validation guards. Instead, export each action as a standalone function.

## Anti-Pattern

```typescript
// BAD: Monolithic dispatcher
export async function runSync(workspace: string, syncAction: SyncAction, options: Options) {
    // Validation guard — grows with each new action that doesn't need validation
    if (syncAction !== 'reset' && syncAction !== 'transfer' && syncAction !== 'status') {
        // ... validate server, remote path, etc.
    }

    switch (syncAction) {
        case 'plan': { /* 30 lines */ }
        case 'reset': { /* 10 lines */ }
        case 'transfer': { /* 50 lines */ }
        case 'status': { /* 15 lines */ }
        default: { /* run — 20 lines */ }
    }
}
```

Problems:
- Validation guard is a negative condition that grows with each exception (`!== 'reset' && !== 'transfer' && !== 'status'`)
- All actions share one try/catch, one return type, one error path
- Handler can't call individual actions without going through the dispatcher
- Adding a new action means modifying the guard AND the switch
- Double-work when handler needs to call plan then run (plan computed twice)

## Correct Pattern

```typescript
// GOOD: Standalone action functions
export async function runSyncPlan(workspace: string, options: Options): Promise<SyncResult> {
    const validation = validateSyncConfig(workspace, options);
    if ('error' in validation) return validation.error;
    // ... plan logic
}

export async function runSyncExecute(workspace: string, options: Options): Promise<SyncResult> {
    const validation = validateSyncConfig(workspace, options);
    if ('error' in validation) return validation.error;
    // ... execute logic
}

export function runSyncReset(workspace: string): SyncResult {
    // No validation needed — just clear state
}

export function runSyncStatus(workspace: string, options: Options): SyncResult {
    // No validation needed — just read config
}

// Shared validation extracted as helper
function validateSyncConfig(workspace: string, options: Options) {
    // Returns { resolved: ... } or { error: SyncResult }
}
```

Handler does the switch:

```typescript
// In handleSync (index.ts):
switch (syncAction) {
    case 'plan': {
        const result = await runSyncPlan(workspace, syncOptions);
        outputResult(result, wantsJson, fmt);
        return;
    }
    case 'run': {
        // Plan-first-confirm: call plan, then execute directly (no double-plan)
        if (!wantsJson && !hasFlag(argv, '--yes')) {
            const plan = await runSyncPlan(workspace, syncOptions);
            // ... show plan, confirm
        }
        const result = await runSyncExecute(workspace, syncOptions);
        outputResult(result, wantsJson, fmt);
        return;
    }
    // ... other cases
}
```

## Benefits

1. **Each function validates only what it needs** — no negative guard conditions
2. **Handler can compose actions** — plan → confirm → execute without double computation
3. **Easy to add new actions** — just export a new function, add a case to handler
4. **Clear error handling** — each function has its own try/catch if needed
5. **Testable in isolation** — each action function can be tested independently

## When to Apply

- Command has 3+ sub-actions with different validation requirements
- Handler needs to call actions in sequence (e.g., plan then execute)
- The shared validation guard has 3+ exclusion conditions

## When NOT to Apply

- Command has only 1-2 actions (not worth the overhead)
- All actions share identical validation and error handling (one function is fine)
