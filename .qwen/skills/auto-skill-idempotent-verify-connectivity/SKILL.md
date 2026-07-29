---
name: idempotent-verify-connectivity
description: Idempotent operations must verify connectivity/state on the fast path — never blindly skip all steps just because config already exists
source: auto-skill
extracted_at: '2026-07-01T02:54:21.198Z'
---

# Idempotent: Verify, Don't Blindly Skip

When an operation detects that configuration already exists (the "already configured" fast path), it must still **verify** that the underlying resources are reachable and functional — not skip all steps and report success.

## Anti-pattern

```typescript
// WRONG: already configured → skip everything, report success
const alreadyConfigured = existingRemote.selectedServer === serverId
    && existingRemote.remotePaths[serverId] === remotePath
    && activeTarget?.runAt === 'remote';

if (alreadyConfigured) {
    result.steps.forjaDeploy = 'skipped';
    result.steps.remoteInit = 'skipped';
    result.steps.executionSwitch = 'skipped';
    // Remote machine could be offline, forja could be deleted — but we report "all done"
}
```

## Correct pattern

```typescript
if (alreadyConfigured) {
    // Verify SSH connectivity even when already configured
    let sshReachable = false;
    try {
        const runner = createSshRunner(server, password);
        const checkResult = await runner.run('echo OK', 10000);
        sshReachable = checkResult.stdout.trim() === 'OK';
    } catch {
        sshReachable = false;
    }

    if (sshReachable) {
        // Safe to skip — remote is reachable
        result.steps.forjaDeploy = 'skipped';
        result.steps.remoteInit = 'skipped';
        result.steps.executionSwitch = 'skipped';
    } else {
        // Remote unreachable — mark failed so user knows
        diagnostics.push(diag('warning', T('setupSshUnreachable')));
        result.steps.forjaDeploy = 'failed';
        result.steps.remoteInit = 'failed';
        result.steps.executionSwitch = 'failed';
    }
}
```

## Why

- Config says "configured" but the remote machine may be offline, reformatted, or the deployed binary deleted
- Blindly skipping creates **false positive** results — `ok: true` with all steps "skipped" looks like success
- A lightweight check (SSH echo, HTTP ping, file existence) catches stale config without full re-deployment

## Rules

1. **Idempotent ≠ trust-config** — check the actual resource, not just local config
2. **Lightweight probe is enough** — `echo OK`, `test -f`, `HEAD /health` — don't re-run the full operation
3. **Probe failure → mark failed, not skipped** — `skipped` means "not needed"; `failed` means "needed but couldn't verify"
4. **Probe failure should not block the entire operation** — use `warning` level if the operation can still partially succeed, `error` if it can't

## Related: `result.ok` must reflect step status

```typescript
// WRONG: ok only checks error-level diagnostics
const hasErrors = diagnostics.some(d => d.level === 'error');
if (hasFailedSteps || hasErrors) { result.ok = false; }

// WRONG: nextAction ignores failed steps
if (!hasErrors) { result.nextAction = 'forja build'; }  // build will fail if remoteInit failed!

// RIGHT: nextAction considers both diagnostics AND step status
if (hasFailedSteps || hasErrors) {
    result.ok = false;
    // Don't suggest build when prerequisite steps failed
} else {
    result.nextAction = 'forja build';
}
```

## When to apply

- Setup/init commands with idempotent "already configured" fast paths
- Deployment commands checking "already deployed"
- Connection/health check commands
- Any command that caches state and skips work based on cached state
