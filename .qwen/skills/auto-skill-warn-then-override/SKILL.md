---
name: warn-then-override
description: When code warns "please select manually" but then auto-selects anyway — the warning and the behavior must be consistent
source: auto-skill
extracted_at: '2026-07-07T09:06:52.119Z'
---

# Warning Must Match Behavior (No Warn-Then-Override)

## Anti-pattern

Code detects a problem, prints a warning telling the user to take manual action, but then proceeds to auto-do something else — contradicting the warning.

```typescript
if (mismatch) {
    console.log('⚠ Not matched — please select manually');
    // ← vsCandidates not modified, falls through to auto-select
}
// Later: auto-selects the only candidate, ignoring the warning
```

The user sees "please select manually" but the system already chose for them. The warning is meaningless.

## Root Cause

The warning branch logs a message but doesn't change the control flow. The subsequent auto-select logic doesn't know a mismatch was detected, so it proceeds normally.

## Fix

When the warning says "manual action required", the code must **actually require manual action**:

### Option A: Force interactive selection
```typescript
if (mismatch && interactive) {
    console.log('⚠ Not matched — please select manually');
    forceInteractive = true; // bypass auto-select even with 1 candidate
}
// Later: if (forceInteractive || candidates.length > 1) { prompt user }
```

### Option B: Clear candidates to prevent auto-select
```typescript
if (mismatch) {
    console.log('⚠ Not matched');
    candidates = []; // prevent length===1 auto-select
    mismatchFlag = true;
}
// Later: if (mismatchFlag && allCandidates.length > 0) { prompt with all }
```

## Checklist

- [ ] Every warning/hint that says "manual" / "please select" / "run X" actually stops auto-behavior
- [ ] The control flow after the warning is different from the normal path
- [ ] Test: when the warning fires, does the user actually see a prompt?
- [ ] Both interactive and non-interactive paths are consistent with the warning

## Real Example

Qt path contains `msvc2019` but only VS 2022 is detected:
- **Before**: Warning "Qt requires VS 2019, please select manually" → auto-selects VS 2022 (only candidate)
- **After**: Warning → forces interactive selection, showing VS 2022 as the only option but requiring explicit confirmation
