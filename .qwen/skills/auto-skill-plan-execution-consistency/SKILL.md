---
name: plan-execution-consistency
description: Plan/dry-run paths must make the same structural decisions as the real execution path — no silent divergence, and must return early before executing
source: auto-skill
extracted_at: '2026-06-23T21:00:00.000Z'
---

# Plan / Execution Consistency

When a command supports `--plan` (or `--dry-run`), the plan path must make the **same structural decisions** as the real execution path, AND **must return before executing anything**.

## Critical Bug Pattern: Missing Early Return

The most common `--plan` bug: the plan flag is passed to the action planner, but execution continues anyway.

```typescript
// BUG: --plan is passed to createActionPlan but execution continues!
const cliOptions = buildCliOptions(workspace, target, options.plan ?? false);
const planned = await createActionPlan(cliOptions);  // returns commands
// Missing: if (options.plan) return { plan: planned };
const executed = await runCliResult(planned, ...);   // EXECUTES ANYWAY!
```

Result: `forja build --plan` shows "Build succeeded" instead of showing the plan. `forja clean --plan` actually cleans. `forja run --plan` actually runs.

## Correct Pattern: Early Return After Plan

```typescript
const planned = await createActionPlan(cliOptions);
if (!planned.ok) {
    return { ok: false, diagnostics: planned.diagnostics, ... };
}

// CRITICAL: Return early for --plan BEFORE executing anything
if (options.plan) {
    return {
        ok: true,
        action: 'build',
        plan: { mode: 'dryRun', commands: planned.commands, shellCommand: planned.shellCommand },
    };
}

// Only reach here if NOT in plan mode
const executed = await runCliResult(planned, ...);
```

## Where to Check

Every command that supports `--plan` must have this pattern:
- `build.ts` — Qt and SDK paths
- `clean.ts` — Qt and SDK paths
- `run.ts` — Qt local path (remote path already handled)
- `setup.ts` — Phase 2 (remote configuration) must be skipped
- `doctor fix` — fix actions must be skipped

## Anti-pattern: Plan Path Diverges from Execution

```typescript
// Plan path: always defaults to 'qt' when no targets
if (options.remote) {
    const kinds = ['qt']; // default fallback
    willRun.push(`<bin> qt init ...`);
}

// Execution path: skips bridge when no targets
if (targetKinds.size === 0) {
    diagnostics.push({ code: 'init.remoteNoTargets', level: 'info', ... });
}
```

Result: plan says it will run qt init, but execution actually skips. Scripts that rely on plan output get wrong predictions.

## Correct Pattern: Shared Decision Logic

Extract the decision logic so both paths share it:

```typescript
function resolveRemoteTargetKinds(activeTarget, qtCandidates, sdkCandidates): string[] {
    const kinds = new Set<string>();
    if (activeTarget) { kinds.add(activeTarget.kind); }
    else {
        if (qtCandidates.length > 0) kinds.add('qt');
        if (sdkCandidates.length > 0) kinds.add('sdk');
    }
    return [...kinds];
}
```

## What must match

| Aspect | Plan must reflect |
|--------|-------------------|
| Target selection | Same kind resolution (qt/sdk/both/none) |
| Remote vs local | Same `mode: 'remote' \| 'local'` |
| Conditional branches | Same skip/error for missing config |
| willRun commands | Same commands that execution would run |
| Fallback behavior | No silent defaults that execution doesn't have |
| **Early return** | **Must return BEFORE any execution** |

## Anti-pattern: Plan Doesn't Simulate "Only Fill Missing" Logic

When execution only writes config values that are missing (idempotent "fill gaps" pattern), the plan must also check existing config before reporting what it would save:

```typescript
// Execution: only fills missing values
if (!qt.qtPath && toolchainDetected.qtPath) { qt.qtPath = toolchainDetected.qtPath; }

// BUG in plan: reports saving qtPath even when already configured
if (toolchainDetected.qt) { willSave.qtPath = toolchainDetected.qtPath; }
// Plan says "will save qtPath" but execution won't actually write it
```

**Fix:** Plan must load existing config and apply the same "only if missing" check:
```typescript
const existingQt = loadQtSettings(workspace);
if (toolchainDetected.qt && !existingQt.qtPath) { willSave.qtPath = toolchainDetected.qtPath; }
```

Similarly, plan mode must simulate diagnostics that execution generates for edge cases (ambiguous targets, already-initialized state). If execution reports "found 3 targets, not auto-selecting" with target names, plan must report the same.

## Checklist

- [ ] Does the command have a `--plan` / `--dry-run` path?
- [ ] **Is there an `if (options.plan) return` BEFORE any execution call?**
- [ ] Does the plan path use the SAME conditions as execution (not simplified defaults)?
- [ ] If execution skips when condition X, does plan also skip (not default)?
- [ ] If execution errors on missing config, does plan also error (not silently ignore)?
- [ ] Are willRun/willWrite arrays populated with the same logic as the real operations?
- [ ] Does the JSON output include a `plan: { mode: 'dryRun', commands, shellCommand }` field?
- [ ] If execution uses "only fill missing" pattern, does plan check existing config before reporting willSave?
- [ ] Does plan generate the same diagnostics (ambiguous, already-initialized) as execution?
