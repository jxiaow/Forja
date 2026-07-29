---
name: write-after-verify
description: Don't commit state changes (config writes, flag flips) before the triggering operation succeeds — write after verify, or rollback on failure
source: auto-skill
extracted_at: '2026-06-23T20:45:00.000Z'
---

# Write After Verify

When an operation has a side effect that depends on a remote or async action succeeding, **do not write the local state change before the action completes**. Either write after success, or rollback on failure.

## Anti-pattern

```typescript
// WRONG: state committed before operation
activeTarget = { ...activeTarget, runAt: 'remote' };
saveActiveTarget(workspace, activeTarget);   // local state now says "remote"

const bridgeResult = await executeRemoteBridge({ ... });  // might fail
if (!bridgeResult.ok) {
    // Too late — activeTarget already says remote
    // Subsequent build/run/status will try remote and fail
}
```

## Correct pattern

```typescript
// Execute operation FIRST
const bridgeResult = await executeRemoteBridge({ ... });

if (!bridgeResult.ok) {
    // State untouched — no partial-write
    diagnostics.push({ level: 'error', message: 'Remote init failed' });
    return result;
}

// Only commit state AFTER success
activeTarget = { ...activeTarget, runAt: 'remote' };
saveActiveTarget(workspace, activeTarget);
```

## When this applies

- **Remote bridge operations**: Don't flip `runAt: 'remote'` until bridge succeeds
- **Multi-step config writes**: If step 2 fails, step 1's write should not leave a dangling reference
- **External service calls**: Don't update local cache/flags until the service call returns success
- **Build/deploy pipelines**: Don't mark "deployed" until the deploy command exits 0

## Relationship to config-state-sync

The `config-state-sync` skill covers writing to ALL config layers. This skill covers the **ordering**: domain config first, router (activeTarget) last — and only after the triggering operation succeeds.

## Checklist

- [ ] Does this code path call a remote/async service AND write local state? → service call first, state write after
- [ ] If the service call fails, is the local state still consistent? → verify by reading the code path
- [ ] Multiple config writes in one operation? → domain configs first, router/activeTarget last
