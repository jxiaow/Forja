---
name: early-return-guard
description: Early return guards must check ALL work the function does, not just the primary concern — missing a secondary concern causes silent data loss
source: auto-skill
extracted_at: '2026-07-04T09:12:40.275Z'
---

# Early Return Guards Must Cover All Work

## Bug Pattern

A function has an early return guard that checks the **primary** concern but misses **secondary** work the function also does. When the primary concern is absent but secondary work is needed, the function returns early and silently skips the secondary work.

```typescript
// BUG: early return only checks Qt-specific work, misses mode/arch saving
function saveQtConfig(ctx, existing, qtCandidates) {
    if (qtCandidates.length === 0 && !existing.qtPath && !ctx.reset) return true;
    // ↑ Returns early when no Qt candidates, even if mode/arch need saving!

    // mode/arch saving is below — never reached for SDK-only projects
    if ((ctx.reset || !qt.mode) && ctx.mode) { qt.mode = ctx.mode; changed = true; }
    if ((ctx.reset || !qt.arch) && ctx.arch) { qt.arch = ctx.arch; changed = true; }
}
```

Result: SDK-only projects never get mode/arch saved. Downstream `needsMode` check finds empty mode → returns `needs-input` even though user provided `--mode`.

## Correct Pattern

The early return guard must check **every type of work** the function does:

```typescript
function saveQtConfig(ctx, existing, qtCandidates) {
    const hasQtWork = qtCandidates.length > 0 || existing.qtPath || ctx.reset;
    const hasModeArchWork = (ctx.reset || !existing.mode) && ctx.mode
                         || (ctx.reset || !existing.arch) && ctx.arch;
    const hasQmakeWork = !!ctx.qmakeTarget;

    // Only return early when NO work is needed
    if (!hasQtWork && !hasModeArchWork && !hasQmakeWork) return true;

    // Gate Qt-specific work on Qt conditions
    if (hasQtWork) {
        if ((ctx.reset || !qt.qtPath) && ctx.toolchain.qtPath) { ... }
        if ((ctx.reset || !qt.vsInstall) && ctx.toolchain.vsInstall) { ... }
    }
    // Mode/arch/qmake saving is OUTSIDE the Qt gate — always runs
    if ((ctx.reset || !qt.mode) && ctx.mode) { ... }
    if ((ctx.reset || !qt.arch) && ctx.arch) { ... }
    if (ctx.qmakeTarget) { ... }
}
```

## Rules

1. **List ALL work the function does** before writing the early return guard
2. **Each type of work gets its own condition** in the guard
3. **Gate primary work on primary conditions**, but leave secondary work ungated
4. **Test with primary absent + secondary present** — this is the scenario that catches the bug

## Common Variants

| Function | Primary work | Secondary work missed |
|----------|-------------|----------------------|
| `saveQtConfig` | Save Qt/VS/jom paths | Save mode/arch/qmake target |
| `saveSdkConfig` | Save VS path | Save mode/arch |
| `validateInput` | Check required fields | Check field format |
| `processOrder` | Process items | Update inventory |

## Audit Checklist

- [ ] Does the early return guard check ALL types of work, not just the primary?
- [ ] Is secondary work gated independently of primary work conditions?
- [ ] Is there a test case where primary is absent but secondary is present?
- [ ] Would removing the early return entirely cause incorrect behavior? (If no, the guard may be unnecessary)
