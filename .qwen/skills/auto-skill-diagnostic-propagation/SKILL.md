---
name: diagnostic-propagation
description: When calling functions that return diagnostics, always propagate failure diagnostics to the caller's array — never silently drop them on .ok === false
source: auto-skill
extracted_at: '2026-06-30T12:00:00.000Z'
---

# Diagnostic Propagation

When an orchestrator function calls sub-functions that return `{ ok, diagnostics }`, the caller MUST propagate diagnostics on failure. Checking `.ok` without propagating `.diagnostics` silently swallows error messages.

## Bug Pattern: Silent Diagnostic Drop

```typescript
// BUG: failure diagnostics are silently lost
const execResult = runUseExecution(workspace, false, true);
result.steps.executionSwitch = execResult.ok ? 'done' : 'failed';
// When execResult.ok === false, the actual error message is gone!
```

```typescript
// BUG: same pattern with runUseRemote
const remoteResult = runUseRemote(workspace, { server: serverId, remotePath });
if (remoteResult.ok) {
    result.steps.remoteConfig = 'done';
    diagnostics.push(diag('info', `Remote configured`));
}
// When remoteResult.ok === false: no step marked, no diagnostic recorded
```

## Correct Pattern: Always Propagate on Failure

```typescript
const execResult = runUseExecution(workspace, false, true);
result.steps.executionSwitch = execResult.ok ? 'done' : 'failed';
executionSwitched = execResult.ok;
if (!execResult.ok && execResult.diagnostics) {
    diagnostics.push(...(execResult.diagnostics as Diagnostic[]));
}
```

```typescript
const remoteResult = runUseRemote(workspace, { server: serverId, remotePath });
if (remoteResult.ok) {
    result.steps.remoteConfig = 'done';
    diagnostics.push(diag('info', `Remote configured`));
} else {
    result.steps.remoteConfig = 'failed';
    diagnostics.push(...(remoteResult.diagnostics as Diagnostic[]));
}
```

## Rules

1. **Every `.ok` check must handle both branches** — if the success branch pushes a diagnostic or marks a step, the failure branch must also mark the step and propagate diagnostics
2. **Step tracking + diagnostic propagation go together** — marking `step = 'failed'` without the diagnostic tells the user something failed but not why; propagating the diagnostic without marking the step shows the error but the step appears missing
3. **Cast diagnostics when needed** — sub-functions may return a broader diagnostic type; cast with `as Diagnostic[]` when pushing to the local array
4. **Orchestrator functions are the most common offenders** — `runSetup` calls `runInit`, `runUseRemote`, `runUseSync`, `runUseExecution`; each returns diagnostics that must be propagated

## Audit Checklist

When reviewing an orchestrator function that calls multiple sub-functions:

- [ ] For each sub-function call: is `.ok === false` handled with diagnostic propagation?
- [ ] For each step tracked in `result.steps`: is it marked `'failed'` (not just left unset) on failure?
- [ ] Are there any `if (result.ok) { ... }` blocks without an `else` that records the failure?
- [ ] Does the catch block for async operations mark all potentially-affected steps as `'failed'`?
