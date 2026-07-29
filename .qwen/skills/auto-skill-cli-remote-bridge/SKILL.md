---
name: cli-remote-bridge
description: When a CLI command has a --remote flag, implement actual bridge execution via executeRemoteBridge — not just local config updates
source: auto-skill
extracted_at: '2026-06-23T19:30:00.000Z'
---

# CLI Command Remote Bridge Execution

When a CLI command supports `--remote` (or dispatches to remote based on `activeTarget.runAt === 'remote'`), it must actually execute the operation on the remote via bridge — not just update local config and return a "configured" diagnostic.

## Pattern

### 1. Make the function async

Bridge execution is async (SSH). Change the function signature:

```typescript
// Before: sync, only touches local config
export function runInit(workspace: string, options: { remote?: boolean }): InitResult { ... }

// After: async, can call bridge
export async function runInit(workspace: string, options: { remote?: boolean }): Promise<InitResult> { ... }
```

Update ALL callers to `await` the result (CLI handler in `commands/index.ts`, VSCode command in `vscode/commands.ts`).

### 2. Local validation first, then bridge

Always validate local config (server exists, remotePath configured, etc.) BEFORE creating SSH connections. This avoids expensive SSH failures for trivial config errors.

```typescript
// 1. Validate server
const server = getServerById(serverId);
if (!server) { /* error diagnostic */ }

// 2. Validate remotePath
const remotePath = remote.remotePaths[serverId] || sync.remotePaths[serverId];
if (!remotePath) { /* error diagnostic */ }

// 3. Execute bridge FIRST

// 4. Only update local config AFTER bridge succeeds (see "Write after verify" below)
const runner = createSshRunner(server, password);
const bridgeResult = await executeRemoteBridge({ ... });
```

### 3. Use executeRemoteBridge directly for lightweight operations

For operations like `init` that don't need workspace sync/lock/overlay, call `executeRemoteBridge` directly — NOT `executePreparedRemoteAction` (which does full workspace preparation).

**Important**: The bridge constructs remote commands using the **unified CLI format** — top-level commands like `forja build`, `forja status`, `forja init`. There is NO `qt`/`sdk` subcommand prefix. The `target` field (`'qt' | 'sdk'`) is used for internal routing and diagnostics only, NOT for command construction.

```typescript
// bridge.ts constructs: forja <action> --workspace <remotePath> [args]
// NOT: forja <target> <action> --workspace <remotePath> [args]
const remoteArgs = [options.action, '--workspace', options.remotePath, ...options.args];
```

```typescript
import { executeRemoteBridge, RemoteBridgeTarget } from '../../remote/core/bridge';
import { createSshRunner } from '../../remote/core/shell';

const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
const runner = createSshRunner(server, password);

const bridgeResult = await executeRemoteBridge({
    target: kind,           // 'qt' | 'sdk' — internal routing only
    action: 'init',         // bridge action
    args: [],
    json: true,             // always request JSON from remote
    remotePath,
    runner,
    remoteForjaBin: remote.remoteForjaBin || undefined,
});
```

### 4. Handle "binary not found" specifically

Exit code 127 (command not found) or 126 (not executable) means the remote Forja binary isn't installed. Provide a specific hint pointing to `forja doctor fix --remote`:

```typescript
if (!bridgeResult.ok) {
    const notFound = bridgeResult.exitCode === 127 || bridgeResult.exitCode === 126;
    diagnostics.push({
        code: 'init.remoteBridgeFailed',
        level: 'error',
        message: `Remote ${kind} init failed: ${bridgeResult.diagnostics.map(d => d.message).join('; ')}`,
        hint: notFound
            ? 'Remote Forja binary not found. Use `forja doctor fix --remote` to install.'
            : undefined,
    });
}
```

### 5. Iterate over detected target kinds

When the command operates on multiple target kinds (qt + sdk), run the bridge for each:

```typescript
const targetKinds = new Set<RemoteBridgeTarget>();
if (activeTarget) {
    targetKinds.add(activeTarget.kind);
} else {
    if (qtCandidates.length > 0) { targetKinds.add('qt'); }
    if (sdkCandidates.length > 0) { targetKinds.add('sdk'); }
    // No targets → skip bridge with info diagnostic, don't default to 'qt'
}

if (targetKinds.size === 0) {
    diagnostics.push({
        code: 'init.remoteNoTargets',
        level: 'info',
        message: 'No local targets detected; skipping remote bridge init.',
    });
} else {
    let allBridgesOk = true;
    for (const kind of targetKinds) {
        const bridgeResult = await executeRemoteBridge({ target: kind, ... });
        if (!bridgeResult.ok) { allBridgesOk = false; }
        // handle result
    }

    // Only switch activeTarget to remote after ALL bridges succeed
    if (allBridgesOk && activeTarget && activeTarget.runAt !== 'remote') {
        activeTarget = { ...activeTarget, runAt: 'remote' };
        saveActiveTarget(workspace, activeTarget);
    }
}
```

### 6. Static imports over dynamic require

Replace `require()` inside the function body with top-level `import` statements:

```typescript
// Bad: dynamic require inside function body
const { loadRemoteSettings } = require('../../core/settingsIO');
const { getServerById } = require('../../core/serverStore');

// Good: static imports at top of file
import { loadRemoteSettings, loadSyncSettings } from '../../core/settingsIO';
import { getServerById } from '../../core/serverStore';
```

### 7. Pass `--project` for target-aware remote commands

The remote forja has its own independent config. It does NOT share the local active target. When executing `build`, `run`, `clean`, etc. on the remote, the remote forja needs to know which project to operate on.

**Solution**: Pass the local active target's project path as `--project` to the remote command. The remote `forja build` accepts `--project <path>` to override its own active target.

```typescript
// In pipeline.ts — before executing remote actions
const extraArgs: string[] = [];
if (options.activeProject && ['build', 'rebuild', 'clean', 'run', 'qmake'].includes(options.action)) {
    extraArgs.push('--project', options.activeProject);
}

// Pass to bridge
const remote = await executeRemoteBridge({
    target: action.target,
    action: action.action,
    args: [...extraArgs, ...action.args],  // --project first, then original args
    ...
});
```

**Also**: Skip the readiness check (`forja status`) when `activeProject` is set, because the remote forja may not have an active target configured yet:

```typescript
if (!stagedMode && !options.activeProject) {
    const readinessFailure = await runTargetReadiness(...);
    if (readinessFailure) { return readinessFailure; }
}
```

**In the CLI command** (e.g., `build.ts`): Accept `--project` flag and use it to construct the target directly instead of calling `requireActiveTarget()`:

```typescript
export async function runBuild(workspace: string, buildAction: BuildAction, 
    options: { plan?: boolean; json?: boolean; project?: string } = {}): Promise<BuildResult> {
    
    if (options.project) {
        // Construct target from --project path (kind inferred from extension)
        const ext = path.extname(options.project).toLowerCase();
        const kind = ext === '.pro' ? 'qt' : 'sdk';
        targetResult = { target: { kind, project: options.project, ... } };
    } else {
        targetResult = requireActiveTarget(workspace);
    }
}
```

## Checklist

- [ ] Function is `async` and returns `Promise<Result>`
- [ ] All callers `await` the result
- [ ] Local validation runs before any SSH connection
- [ ] Bridge uses `executeRemoteBridge` directly (not prepared action) for lightweight ops
- [ ] Exit 127/126 produces a hint pointing to `forja doctor fix --remote`
- [ ] `remoteForjaBin` is passed from settings (falls back to `$HOME/.forja/bin/forja`)
- [ ] `--project` passed for target-aware commands (build/run/clean) when activeProject is available
- [ ] Readiness check skipped when activeProject is set
- [ ] Doc updated in all three locations (md, v2-en HTML, v2-zh HTML)
