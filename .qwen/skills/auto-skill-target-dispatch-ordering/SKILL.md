---
name: target-dispatch-ordering
description: CLI and VSCode command handlers must check target kind (Qt/SDK) BEFORE checking run location (local/remote) to ensure consistent rejection
source: auto-skill
extracted_at: '2026-06-23T16:30:00.000Z'
---

# Target Dispatch Ordering

When a command handler dispatches based on both target kind (Qt/SDK) and run location (local/remote), the **target kind check must come first**. This ensures CLI and VSCode paths reject the same operations consistently.

## The Pattern

Command handlers like `build`, `run`, `clean` have two dimensions:
1. **Target kind**: Qt vs SDK
2. **Run location**: local vs remote

The dispatch order must be:
1. Check target kind restrictions first (SDK doesn't support rcc/qmake/run)
2. Then check run location (remote vs local)
3. Finally dispatch to the appropriate backend

## Correct Order

```typescript
// forja.run handler
const target = getActiveTarget(workspace());

// 1. SDK rejection FIRST (before remote check)
if (target?.kind === 'sdk') {
    vscode.window.showWarningMessage('SDK target does not support run. Use Build instead.');
    return;
}

// 2. Remote dispatch SECOND
if (target?.runAt === 'remote') {
    startForegroundRemoteRun(context, workspace());
    return;
}

// 3. Local dispatch LAST
const buildManager = await import('../qt/build/buildManager');
await buildManager.run();
```

## Wrong Order (Bug)

```typescript
// WRONG: Remote check before SDK rejection
const target = getActiveTarget(workspace());

// This runs first — SDK + remote would start Qt run on remote!
if (target?.runAt === 'remote') {
    startForegroundRemoteRun(context, workspace());  // BUG: runs Qt on remote
    return;
}

// This never runs for remote targets
if (target?.kind === 'sdk') {
    vscode.window.showWarningMessage('SDK target does not support run');
    return;
}
```

## Affected Commands

| Command | SDK Restriction | Why |
|---------|-----------------|-----|
| `build rcc` | SDK doesn't support rcc | rcc is Qt-specific (resource compiler) |
| `build qmake` | SDK doesn't support qmake | qmake is Qt-specific |
| `run` | SDK doesn't support run | SDK builds executables differently |
| `debug` | SDK doesn't support debug | Debug config is Qt-specific |

## CLI vs VSCode Consistency

Both paths must reject the same operations:

```typescript
// CLI path (build.ts)
if ((buildAction === 'qmake' || buildAction === 'rcc') && target.kind === 'sdk') {
    return { ok: false, diagnostics: [{ code: 'build.actionUnsupported', ... }] };
}
if (buildAction === 'rcc' && target.runAt === 'remote') {
    return { ok: false, diagnostics: [{ code: 'build.rccNotSupportedRemote', ... }] };
}

// VSCode path (commands.ts) — must match
if (target?.kind === 'sdk') {
    if (action === 'qmake' || action === 'rcc') {
        vscode.window.showErrorMessage(`SDK target does not support '${action}' action`);
        return;
    }
}
```

## Remote-Specific Restrictions

Some operations are not supported on remote targets regardless of kind:

| Operation | Remote Support | Reason |
|-----------|----------------|--------|
| `build rcc` | No | RCC requires local Qt installation |
| `run designer` | No | Qt Designer is GUI application |

```typescript
// Remote rcc rejection
if (buildAction === 'rcc' && target.runAt === 'remote') {
    return { ok: false, diagnostics: [{ code: 'build.rccNotSupportedRemote', ... }] };
}
```

## Checklist

- [ ] Does the handler check target kind BEFORE run location?
- [ ] Does CLI reject the same operations as VSCode?
- [ ] Are remote-specific restrictions (rcc, designer) checked?
- [ ] Are error messages consistent between CLI and VSCode?
- [ ] Is the SDK fallback (synthesize target from SDK state) applied consistently across build/run/clean?
