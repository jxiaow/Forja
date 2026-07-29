---
name: shell-to-nodejs-precision
description: When shell-level operations lack precision (e.g. kill by name), move the logic to Node.js where full context (path, PID, state) is available — including VSCode paths
source: auto-skill
extracted_at: '2026-07-01T10:06:10.389Z'
---

# Shell-to-Node.js Precision Migration

## Problem
Shell commands embedded in build/run chains often lack precision because they only have access to limited context (e.g. process name). This can cause:
- Killing wrong processes with the same name but different paths
- Inability to verify full executable path before acting
- Platform-specific escaping nightmares for complex queries

## Pattern
Move the imprecise shell-level operation to a Node.js function that runs **before** the shell command chain, where full context is available:

1. **Identify the shell operation** that lacks precision (e.g. `taskkill /IM name.exe`, `pkill -x name`)
2. **Create a Node.js function** that performs the same operation with full context (e.g. `findExecutablePids(exePath)` + `taskkill /F /T /PID <pid>`)
3. **Call the Node.js function** at the execution engine level (e.g. `runCliResult`) before the command chain runs
4. **Remove the shell-level command** from the command chain (e.g. remove `killCmd` from `commands` array)
5. **Keep the shell command in dry-run/plan output** only if it's still useful for documentation — otherwise remove it entirely

## Example: Process Kill
```
Before: commands = [killCmd(exeName), ...buildCmds, runCmd]
  → killCmd uses taskkill /IM name.exe — kills ALL processes with that name

After: Node.js pre-kill via terminateExecutable(exePath) before command chain
  → findExecutablePids(exePath) matches by full path (PowerShell CIM on Win, /proc/pid/exe on Linux)
  → commands = [...buildCmds, runCmd] — no shell kill needed
```

## Key Considerations
- The Node.js function should use the **same termination mechanism** (taskkill/SIGTERM) — only the matching logic changes
- `findExecutablePids` already does path-aware matching on both platforms — reuse it
- If the shell command was also used for `stop` action, keep the shell version for stop (it has different semantics)
- Dry-run output changes: the kill command no longer appears in `--plan` output. This is acceptable since the kill is an implementation detail, not a user-visible build step
- Ensure the pre-kill only fires for the right actions (e.g. `run` needs pre-kill, `build` alone should NOT kill the running app)

## When to Apply
- Process kill by name → kill by path/PID
- File existence checks that need cross-platform logic
- Environment setup that varies by runtime context
- Any shell one-liner that requires complex escaping to do path-aware matching

## VSCode Path Must Also Be Unified
When VSCode has its **own** implementation of the same operation (e.g. `buildManager.stop()` using name-based kill alongside CLI's `runStop()` using PID-based kill), both paths must be unified:

1. **Identify divergent implementations** — CLI uses precise Node.js logic, VSCode uses shell-based shortcut
2. **Replace VSCode's implementation** with a direct call to the shared function (e.g. `runStop(workspace())`)
3. **Delete the VSCode-only function** (e.g. `buildManager.stop()`, `stopCurrentTarget()`)
4. **Update all callers** — including debugger pre-launch, which may also use the old function
5. **Update source-code tests** — tests that assert on the old function's presence in source must be updated

### Example: Stop Unification
```
Before:
  CLI:  runStop() → readRunState → terminateProcess(PID) → clearRunState
  VSCode: buildManager.stop() → getRuntimeProcessName() → _killApp(name) // no state cleanup

After:
  CLI:  runStop() → readRunState → terminateProcess(PID) → clearRunState
  VSCode: runStop(workspace()) → same path, same precision, same state cleanup
  debugger: runStop(workspace()) → same path
  buildManager.stop() → DELETED
```

**Why this matters:** Divergent implementations step on each other — VSCode stop leaves stale run state, CLI stop then tries to kill an already-dead PID. Unification eliminates the class of bugs entirely.
