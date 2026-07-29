---
name: consolidation-implementation-completeness
description: After command consolidation, verify all documented sub-actions are wired to core functions, pipeline types are extended not bypassed, and CLI parsing matches spec syntax
source: auto-skill
extracted_at: '2026-06-22T06:17:11.939Z'
---

# Consolidation Implementation Completeness

After consolidating commands into a unified surface, verify that the implementation is actually complete — not just structurally correct. This addresses issues that survive initial code review because they look correct at the routing level but fail at the execution level.

## When This Applies

- After command consolidation where old commands were mapped to new unified commands
- When a spec document defines sub-actions, modes, or flags that the new command must support
- When pipeline functions have typed action unions that may need extension

## Verification Dimensions

### 1. All Documented Sub-Actions Must Be Wired to Core Functions

A sub-action is "recognized" if the parser identifies it. It is "wired" if it actually calls the underlying core function. Recognition without wiring is a stub.

**Anti-pattern — recognized but not wired:**
```typescript
// handleDoctor recognizes restore/reset/clean-untracked sub-commands
else if (subArg === 'restore') { /* handled by runDoctor */ }
else if (subArg === 'reset') { /* handled by runDoctor */ }

// But runDoctor never receives these — they fall through to default 'check' behavior
```

**Anti-pattern — wired but stub implementation:**
```typescript
// doctor fix mode
if (doctorAction === 'fix') {
    changed.push('stale-configs-cleaned');  // Just a string, no actual cleanup!
    checks.push(check('fix-cleanup', 'ready', 'Stale configs cleaned'));
}
```

**Correct pattern — wired and implemented:**
```typescript
// handleDoctor parses and passes structured parameters
else if (subArg === 'restore') {
    restore = { repo: argv[2], paths: collectPositionalPaths(argv, 3) };
}

// runDoctor receives and dispatches to core functions
if (doctorAction === 'restore' && options.restore) {
    const result = await executeRemoteRestore({
        remotePath, repo: options.restore.repo, paths: options.restore.paths, runner,
    });
    // ... handle result
}

// fix mode actually performs cleanup
if (doctorAction === 'fix') {
    const configs = listProjectConfigs();
    for (const config of configs) {
        if (!fs.existsSync(config.workspace)) {
            fs.unlinkSync(config.filePath);  // Actual deletion
            removed++;
        }
    }
}
```

**How to check:**
1. For each sub-action in the spec, trace: parser → handler → core function → side effect
2. Look for comment-only branches (`/* handled by ... */`)
3. Look for `changed.push('string')` without corresponding actual operation
4. Verify fix/recovery modes actually perform the recovery, not just report it

### 2. Extend Pipeline Type Unions Rather Than Bypassing

When a new action needs to go through an existing pipeline, extend the pipeline's type union. Do NOT create a separate bypass route that skips the pipeline's preparation/sync/diagnostics flow.

**Anti-pattern — bypassing the pipeline:**
```typescript
// QMake action needs remote execution, but RemotePlanOptions.action doesn't include 'qmake'
// So the developer creates a direct bridge call that skips the prepared pipeline:
if (action === 'qmake') {
    const result = await executeRemoteBridge({ target, action: 'qmake', ... });
    // ❌ Bypasses executePreparedRemoteAction — no sync, no preparation, no diagnostics
}
```

**Correct pattern — extend the type union:**
```typescript
// Step 1: Extend the pipeline's action type
export interface RemotePlanOptions {
    action: 'build' | 'rebuild' | 'clean' | 'qmake' | 'run' | 'stop' | 'status';
    //                                              ^^^^^^^^ added
}

// Step 2: Use the pipeline for all actions uniformly
if (target?.runAt === 'remote') {
    const remoteAction = action === 'fresh' ? 'rebuild'
        : action === 'qmake' ? 'qmake'    // ← passes through pipeline
        : 'build';
    await executeRemoteBuild(workspace(), target.kind, remoteAction);
}
```

**How to check:**
1. Find all `if (action === 'x')` branches in command handlers that call a different function than the default path
2. For each bypass, ask: "Can the existing pipeline handle this action if we extend its type?"
3. Check if the bypassed pipeline provides preparation, sync, or diagnostics that the bypass misses
4. Verify the underlying execution function (e.g., `executePreparedRemoteAction`) already supports the action type

**Severity**: P0 when the bypass skips preparation/sync (stale remote files). P1 when it only skips progress notifications.

### 3. CLI Argument Parsing Must Match Documented Spec Syntax

The CLI parser must accept exactly the syntax shown in the spec document. If the spec says `forja doctor restore <repo> <paths...>`, the parser must accept positional arguments — not require `--repo` flag or `--` separator.

**Anti-pattern — parser requires different syntax than spec:**
```typescript
// Spec says: forja doctor restore <repo> <paths...>
// But implementation requires: forja doctor restore --repo <repo> -- <paths...>
const repo = extractFlag(argv, '--repo');  // ❌ Spec doesn't show --repo flag
const paths = extractPathsAfterDashDash(argv);  // ❌ Spec doesn't show -- separator
```

**Correct pattern — match spec syntax:**
```typescript
// Spec: forja doctor restore <repo> <paths...> [--force] [--workspace <path>] [--json]
const repo = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
const paths = collectPositionalPaths(argv, 3);  // Collect all non-flag args starting at index 3

function collectPositionalPaths(argv: string[], startIdx: number): string[] {
    const paths: string[] = [];
    for (let i = startIdx; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { continue; }  // Skip flags
        paths.push(argv[i]);
    }
    return paths;
}
```

**How to check:**
1. For each command with positional arguments in the spec, verify the parser extracts them positionally
2. Check that flags (`--force`, `--recursive`) are not confused with positional args
3. Verify error messages show the correct syntax from the spec
4. Test: `forja doctor restore myrepo file.cpp` should work without `--` or `--repo`

### 4. Fix/Recovery Modes Must Cover All Documented Scenarios

When a command has a `fix` or `--remote` mode, it must handle ALL scenarios documented for that mode — not just the local/common ones.

**Anti-pattern — fix mode only handles local:**
```typescript
// Spec says: forja doctor fix --remote covers old bootstrap behavior
// But implementation only cleans local stale configs:
if (doctorAction === 'fix') {
    // Cleanup stale configs... (local only)
    // ❌ No remote bootstrap when --remote is passed
}
```

**Correct pattern — fix mode branches on context:**
```typescript
if (doctorAction === 'fix') {
    // Local cleanup
    const stale = scanStaleConfigs();
    if (!options.plan) { executeCleanup(stale); }

    // Remote fix when --remote
    if (options.remote) {
        const artifact = findBootstrapArtifact();
        const result = await executeRemoteBootstrap({ artifact, runner, uploader });
        // ... handle result
    }
}
```

**How to check:**
1. Read the spec's "absorbed commands" table — each old command mapped to `fix` must have equivalent behavior
2. Check that `--remote` flag triggers remote-specific fix operations
3. Verify `--plan` mode outputs what WOULD be done without doing it
4. Cross-reference: old `forja remote test --bootstrap` → new `forja doctor fix --remote`

### 5. Wrapper Functions Must Pass Through All Context-Dependent Parameters

When a wrapper function (e.g., `executeRemoteActionWithProgress`) wraps a core function (e.g., `executeRemotePlan`), it must accept and forward ALL parameters that callers may need to pass.

**Anti-pattern — wrapper hardcodes args:**
```typescript
// Wrapper doesn't accept args parameter
export async function executeRemoteActionWithProgress(
    workspace: string, kind: string, action: string, label: string
): Promise<void> {
    const result = await executeRemotePlan({
        workspace, target: kind, action,
        // ❌ args defaults to [] — caller can't pass --detach!
    });
}
```

**Correct pattern — wrapper accepts optional params:**
```typescript
export async function executeRemoteActionWithProgress(
    workspace: string, kind: string, action: string, label: string,
    args?: string[],  // ← Added
): Promise<void> {
    const result = await executeRemotePlan({
        workspace, target: kind, action,
        args,  // ← Forwarded
    });
}

// Caller can now pass context-dependent args
await executeRemoteActionWithProgress(ws, kind, 'run', 'Run Detached', ['--detach']);
```

**How to check:**
1. Find wrapper functions that call core pipeline functions
2. Compare the wrapper's parameters with the core function's options interface
3. Any option in the core interface that the wrapper doesn't expose is a potential passthrough bug
4. Check all callers: do any need to pass values that the wrapper doesn't accept?

## Checklist

- [ ] Every sub-action in the spec has a complete trace: parser → handler → core function → side effect
- [ ] No comment-only branches (`/* handled by ... */`) in command dispatchers
- [ ] No `changed.push('string')` without corresponding actual operation
- [ ] Pipeline type unions extended for new actions (not bypassed with separate routes)
- [ ] CLI argument parsing matches spec syntax (positional args, not flags for positional params)
- [ ] Fix/recovery modes cover all documented scenarios (local + remote + plan)
- [ ] Wrapper functions expose all context-dependent parameters from core function options
- [ ] `--plan` mode outputs what would be done without executing
- [ ] Error messages show the correct syntax from the spec
- [ ] `tsc --noEmit` passes
- [ ] All spec verification points pass
