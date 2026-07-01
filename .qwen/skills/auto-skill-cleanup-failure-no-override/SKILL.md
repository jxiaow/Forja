---
name: cleanup-failure-no-override
description: Cleanup/teardown failures (lock release, temp file deletion, cache invalidation) should warn but never override a successful operation result
source: auto-skill
extracted_at: '2026-07-01T09:01:36.502Z'
---

# Cleanup Failure Must Not Override Operation Success

When an operation succeeds but a subsequent cleanup/teardown step fails (lock release, temp file deletion, cache invalidation, etc.), the cleanup failure should be recorded as a **warning** — it must NOT flip `ok: true` to `ok: false`.

## The Bug Pattern

```typescript
try {
    // Main operation succeeds
    result = { ok: true, action: 'build', /* ... */ };
    return result;
} finally {
    // Cleanup step
    const release = await releaseLock(lockId);
    if (!release.ok) {
        result.ok = false;              // BUG: overrides success!
        result.failedStage = 'releaseLock';
        result.nextAction = '手动检查或 unlock 远端 lock';
    }
}
```

Result: A successful build is reported as failed because a lock couldn't be released. The user sees "build failed" when the build actually succeeded.

## The Correct Pattern

```typescript
try {
    result = { ok: true, action: 'build', /* ... */ };
    return result;
} finally {
    const release = await releaseLock(lockId);
    if (!release.ok) {
        // Record as warning, don't override ok
        diagnostics.push({ level: 'warning', message: '锁释放失败，远端可能残留锁文件' });
        if (!result.ok) {
            // Only set failedStage and nextAction if the operation itself already failed
            result.failedStage = result.failedStage || 'releaseLock';
            result.nextAction = result.nextAction || '手动检查或 unlock 远端 lock';
        }
        // When result.ok === true: warning diagnostic is sufficient,
        // do NOT set nextAction — a successful operation should not suggest manual intervention
    }
}
```

## Rules

1. **Cleanup failures are warnings, not errors** — the main operation's result (`ok`, `exitCode`) must not be changed by cleanup failures
2. **Always record the cleanup failure** — push a warning-level diagnostic so the user knows about the issue
3. **Only set `failedStage` and `nextAction` if the operation already failed** — if the operation succeeded, the warning diagnostic is sufficient; do NOT set `nextAction` (a successful build should not suggest manual intervention)
4. **Common cleanup steps that follow this rule**:
   - Lock release (remote operations)
   - Temp file/directory deletion
   - Cache invalidation
   - Connection close / session cleanup
   - PID file removal

## Audit Checklist

When reviewing `finally` blocks or cleanup code:

- [ ] Does the cleanup failure path set `result.ok = false`? → Change to warning
- [ ] Is the cleanup failure recorded as a diagnostic? → Must be present
- [ ] Are `failedStage` and `nextAction` only set when `result.ok === false`? → Must be inside `if (!result.ok)` block
- [ ] When operation succeeds: is only a warning diagnostic added (no nextAction)? → Correct
- [ ] Are there multiple cleanup steps? → Each must independently follow this rule
