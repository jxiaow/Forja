---
name: multi-step-orchestrator-review
description: Review checklist for multi-step orchestrator functions — initialization consistency, stale state, duplicated logic, type precision, and bulk-set safety
source: auto-skill
extracted_at: '2026-07-01T06:28:13.524Z'
---

# Multi-Step Orchestrator Review

Review patterns specific to functions that orchestrate multiple sequential steps with shared state (e.g., `runSetup`, `runSetupRemote`, deployment pipelines, migration scripts).

## 1. Initialization Consistency Across Early-Return Paths

When a function has multiple early-return paths, each must initialize shared state (like `result.steps`) the same way. Use a single bulk-initialization helper rather than manual per-key assignment.

**Bug pattern:**
```typescript
// Path A: uses helper
skipAllSteps(result);

// Path B: manually assigns — easy to miss a key or set wrong value
result.steps.localConfig = 'failed';
for (const key of REMOTE_STEP_KEYS) {
    if (key !== 'localConfig') result.steps[key] = 'skipped';  // duplicates skipAllSteps logic
}
```

**Fix:** Always use the helper, then override specific keys:
```typescript
skipAllSteps(result);
result.steps.localConfig = 'failed';
```

## 2. Bulk-Set Must Not Overwrite Already-Set Values

A bulk-initialization function (like `skipAllSteps`) must check if a value is already set before writing. Otherwise it clobbers values set by earlier code.

**Bug pattern:**
```typescript
result.steps.localConfig = 'done';  // set during Phase 1
// ...later...
skipAllSteps(result);  // overwrites localConfig to 'skipped'!
```

**Fix:**
```typescript
function skipAllSteps(result: SetupRemoteResult): void {
    for (const key of REMOTE_STEP_KEYS) {
        if (!result.steps[key]) {  // only set if not already set
            result.steps[key] = 'skipped';
        }
    }
}
```

## 3. Re-Read State After Mutation

If a function reads state (e.g., `loadActiveTarget()`), then calls a sub-function that mutates that state, the final result must use the **re-read** value — not the stale original.

**Bug pattern:**
```typescript
const activeTarget = loadActiveTarget(workspace);  // read once
// ...later...
runUseExecution(workspace, false, true);  // mutates activeTarget
// ...later...
result.remote = {
    executionMode: activeTarget?.runAt === 'remote' ? 'remote' : 'local',  // STALE!
};
```

**Fix:**
```typescript
const finalActiveTarget = loadActiveTarget(workspace);  // re-read after mutation
result.remote = {
    executionMode: finalActiveTarget?.runAt === 'remote' ? 'remote' : 'local',
};
```

## 4. Extract Duplicated Filtering/Validation Logic

When the same filtering logic appears in 2+ code paths (e.g., `runSetup` and `runSetupRemote` both filter local questions the same way), extract to a shared function. This prevents drift when the logic needs updating.

**Detection:** Grep for similar `.filter()` chains or `if/else` ladders that check the same fields.

## 5. Type Precision on Step Key Constants

Use `as const` + mapped types instead of `Record<string, ...>` for step keys. This catches typos at compile time.

```typescript
const STEP_KEYS = ['step1', 'step2', 'step3'] as const;
type StepKey = typeof STEP_KEYS[number];
type StepStatus = 'done' | 'skipped' | 'failed';

// In result type:
steps: Partial<Record<StepKey, StepStatus>>;  // precise, not Record<string, ...>
```

## 6. Formatter Edge Cases: Mutually Exclusive Sections

When a formatter uses `if/else if` for sections (e.g., show questions OR show remote info), add a test that provides BOTH to verify priority is correct.

```typescript
// Formatter: if (needs-input) { show questions } else if (remote) { show remote }
// Test: provide both status='needs-input' AND remote={...} → questions should win
```

## 7. Validate Inputs Before Any State Mutation

All input validation (flag parsing, project matching, option checking) must happen BEFORE any config writes. If validation fails after state has been mutated, the function returns `ok: false` but the side effects remain.

**Bug pattern:**
```typescript
// Save toolchain defaults (state mutation)
saveQtSettings(workspace, qt);

// THEN validate project flag — too late, config already modified!
if (options.project) {
    const match = candidates.find(c => c.project === options.project);
    if (!match) {
        return { ok: false, ... };  // returns error but qt settings already saved
    }
}
```

**Fix:** Move all validation before any save calls.

## 8. Error Results Must Preserve Context

Error result builders (like `initWriteFailed`) should accept and preserve runtime context (detected counts, partial state) instead of zeroing everything out. A caller debugging a failure needs to know what was found, not just that it failed.

**Bug pattern:**
```typescript
function initWriteFailed(e: unknown): InitResult {
    return {
        ok: false,
        detected: { qtTargets: 0, sdkTargets: 0, toolchain: {} },  // zeros out real data!
    };
}
```

**Fix:**
```typescript
function initWriteFailed(e: unknown, detected?: InitResult['detected']): InitResult {
    return {
        ok: false,
        detected: detected ?? { qtTargets: 0, sdkTargets: 0, toolchain: {} },
    };
}
```

## 9. Interactive Prompt Inputs Need Validation

Interactive prompts that parse user input (parseInt, etc.) must validate the parsed result. Invalid input silently becoming NaN and propagating to config is worse than rejecting it immediately.

```typescript
const portStr = await prompt('Port', '22');
const port = parseInt(portStr || '22', 10);
if (isNaN(port)) {
    diagnostics.push(diag('error', `Invalid port: ${portStr}`));
    return null;
}
```

## Audit Checklist

- [ ] All early-return paths use the same step initialization helper
- [ ] Bulk-set helpers don't overwrite already-set values
- [ ] State is re-read after any sub-function that mutates it
- [ ] Duplicated filtering/validation logic is extracted to shared functions
- [ ] Step keys use precise types (not `Record<string, ...>`)
- [ ] Formatter `if/else if` chains have tests for mutually exclusive inputs
- [ ] All input validation happens before any state mutation
- [ ] Error result builders preserve runtime context (don't zero out useful data)
- [ ] Interactive prompt inputs are validated after parsing
