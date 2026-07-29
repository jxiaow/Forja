---
name: sequential-step-gating
description: In multi-step pipelines with sequential dependencies, later steps must check that all prerequisite steps succeeded before executing — not just check their own preconditions
source: auto-skill
extracted_at: '2026-07-01T06:03:04.762Z'
---

# Sequential Step Gating

When a pipeline has sequential steps where each depends on the previous (A → B → C), a failure in step A must prevent step B and C from executing — even if B's own preconditions appear met.

## Bug Pattern: Later Step Ignores Earlier Failure

```typescript
// Step A: deploy
const deployFailed = result.steps.forjaDeploy === 'failed';

// Step B: remote init (correctly gated on deploy)
if (!deployFailed) {
    const bridgeResult = await executeRemoteBridge({ ... });
    if (!bridgeResult.ok) { remoteInitOk = false; }
    result.steps.remoteInit = remoteInitOk ? 'done' : 'failed';
}

// Step C: execution switch — BUG: doesn't check deploy or init status!
if (activeTarget && activeTarget.runAt !== 'remote') {
    const execResult = runUseExecution(workspace, false, true);
    // Switches to remote even though remoteInit failed!
}
```

Result: execution mode switches to `remote` even though remote init never completed. Subsequent `forja build` tries to build on an uninitialized remote.

## Correct Pattern: Gate on All Prerequisites

```typescript
// Track prerequisite outcomes at the right scope
const deployFailed = result.steps.forjaDeploy === 'failed';
let remoteInitOk = true;

if (!deployFailed) {
    // ... run remote init ...
} else {
    remoteInitOk = false;  // Must set in else branch too!
}

// Gate step C on ALL prerequisites, not just its own
if (deployFailed || !remoteInitOk) {
    result.steps.executionSwitch = 'skipped';
} else if (activeTarget && activeTarget.runAt !== 'remote') {
    const execResult = runUseExecution(workspace, false, true);
    result.steps.executionSwitch = execResult.ok ? 'done' : 'failed';
}
```

## Rules

1. **Each step must check ALL prior steps' outcomes** — not just its own preconditions. If step B depends on step A, and step C depends on step B, then step C must also implicitly depend on step A.
2. **Track boolean flags at the right scope** — `remoteInitOk` declared inside an `if (!deployFailed)` block is invisible to the execution switch. Declare it before the conditional so all branches can set it.
3. **Set flags in both success and failure branches** — `remoteInitOk = false` must be set in the `else` (deploy failed) branch too, not just when the bridge call fails.
4. **Skipped steps must be explicitly marked** — when gating prevents a step from running, set `result.steps[key] = 'skipped'` so the user sees it was intentionally not executed.
5. **`nextAction` must respect gating** — if step C was skipped due to earlier failure, `nextAction` should not suggest running the command that depends on step C.

## Common Pipeline Patterns to Audit

| Pipeline | Dependencies | Gate check |
|----------|-------------|------------|
| deploy → init → switch | Each depends on all prior | switch checks deploy + init |
| connect → upload → verify | Upload needs connection | Verify checks upload happened |
| validate → save → notify | Save needs validation | Notify checks save succeeded |
| resolve → configure → activate | Configure needs resolution | Activate checks configure done |

## Audit Checklist

- [ ] For each step in the pipeline: does it check outcomes of ALL prior steps, not just the immediately preceding one?
- [ ] Are prerequisite-tracking variables declared at a scope visible to all dependent steps?
- [ ] Are failure branches setting tracking flags (not just success branches)?
- [ ] Are skipped steps explicitly marked as `'skipped'` in `result.steps`?
- [ ] Does `nextAction` / `result.ok` reflect the gated state correctly?
