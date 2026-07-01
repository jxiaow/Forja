---
name: vscode-cli-unify
description: When VSCode and CLI have divergent implementations of the same feature, unify by routing both through the same core function — don't maintain parallel logic
source: auto-skill
extracted_at: '2026-07-01T11:37:20.696Z'
---

# VSCode/CLI Feature Unification

When VSCode and CLI implement the same feature independently (e.g., both have their own "stop" logic), they inevitably diverge in behavior, precision, and correctness. Unify by routing both through the same core function.

## When This Applies

- VSCode command handler has its own implementation of a feature that CLI also implements
- The two implementations use different strategies (e.g., name-based kill vs PID-based kill)
- One implementation is more correct/precise than the other
- State changes in one path are invisible to the other (e.g., VSCode stop doesn't clean up run state that CLI stop manages)

## The Problem Pattern

```
VSCode path:                        CLI path:
  forja.stop                          forja stop
  → resolveActiveTarget()             → runStop()
  → buildManager.stop()               → readRunState()
  → getRuntimeProcessName()           → terminateProcess(pid)  ← PID-based
  → _killApp(exeName)                 → clearRunState()
  → taskkill /IM name.exe  ← name-based
  → (no state cleanup)
```

Two implementations of "stop" that:
- Use different kill strategies (name vs PID)
- Don't share state (VSCode doesn't clean run state)
- Can step on each other (VSCode stop → stale run state → CLI stop tries dead PID)

## The Solution: Single Core Function

```
Unified path:
  runStop() in stop.ts
    ↙                    ↘
CLI dispatcher:          VSCode command:
  handleStop()             forja.stop
  → runStop()              → runStop()
  → outputStopResult()     → showInformationMessage(result.diagnostics[0])
```

## Process

### 1. Identify Divergent Implementations

```bash
# Find VSCode command handlers
grep -n "registerCommand.*forja\." src/vscode/commands.ts

# For each handler, check if it calls CLI core functions or has its own logic
# Look for: direct process management, state manipulation, shell commands
```

### 2. Determine Which Implementation Is More Correct

Compare on these axes:
- **Precision**: PID-based > name-based (avoids killing unrelated processes)
- **State management**: Cleans up state files > leaves stale state
- **Error handling**: Returns structured result > shows inline error
- **Edge cases**: Handles remote, SDK, unsupported targets > only handles happy path

### 3. Route Both Through the Core Function

**VSCode side**: Replace the divergent implementation with a call to the CLI core function. Map the result to VSCode UI:

```typescript
// Before: VSCode has its own stop logic
vscode.commands.registerCommand('forja.stop', async () => {
    const target = await resolveActiveTarget();
    if (target?.runAt === 'remote') { await executeRemoteAction(...); return; }
    if (target?.kind === 'sdk') { showWarning('...'); return; }
    buildManager.stop();  // ← divergent implementation
});

// After: VSCode calls the same core function
vscode.commands.registerCommand('forja.stop', async () => {
    const { runStop } = await import('../cli/commands/stop');
    const target = await resolveActiveTarget();
    // Keep VSCode-specific dispatch for cases needing progress UI
    if (target?.runAt === 'remote') {
        await executeRemoteActionWithProgress(...);
        return;
    }
    const result = await runStop(workspace());
    // Map result to VSCode notifications
    const msg = result.diagnostics?.[0]?.message;
    if (result.state === 'stopped') { showInformationMessage(msg); }
    else if (result.state === 'unsupported') { showWarningMessage(msg); }
    // ...
});
```

**CLI side**: Already calls the core function — no changes needed.

### 4. Remove the Old Divergent Code

- Delete the old function (e.g., `buildManager.stop()`, `stopCurrentTarget()`)
- Remove unused imports (`getRuntimeProcessName`, `cp`, etc.)
- Update callers that used the old function (e.g., debugger.ts)
- Update or delete tests that asserted on the old implementation

### 5. Verify No Remaining References

```bash
grep -rn "buildManager\.stop\|stopCurrentTarget\|_killApp" src/
```

## Rules

- **One implementation per feature** — if VSCode and CLI both need "stop", they call the same function
- **Prefer the more precise implementation** — PID-based > name-based, path-based > name-based
- **VSCode-specific concerns stay in VSCode** — progress UI, notification mapping, quick picks. The core function handles logic; VSCode handles presentation.
- **Don't leave wrapper functions** — if `buildManager.stop()` just calls `runStop()`, delete it and call `runStop()` directly
- **Update all callers** — if debugger.ts called `stopCurrentTarget()`, update it to call `runStop()` too

## Audit Checklist

When reviewing a feature that exists in both VSCode and CLI:

- [ ] Both paths identified and compared
- [ ] More correct implementation chosen as the core
- [ ] VSCode handler calls core function (not its own logic)
- [ ] Old divergent functions deleted
- [ ] Unused imports cleaned up
- [ ] All callers updated (including debugger, status bar, etc.)
- [ ] Tests updated to match new implementation
- [ ] No remaining references to deleted functions

## Real Example: Stop Command Unification

**Before**: VSCode `buildManager.stop()` used name-based kill (`taskkill /IM`), didn't clean run state. CLI `runStop()` used PID-based kill, cleaned run state.

**After**: Both call `runStop()`. `buildManager.stop()` and `stopCurrentTarget()` deleted. Debugger updated to call `runStop()`. `_killApp()` (name-based) replaced with `terminateExecutable()` (path-based).

Files changed: `stop.ts`, `vscode/commands.ts`, `debugger.ts`, `buildManager.ts`, `commandRunner.ts`, `qtCore.ts`, tests.
