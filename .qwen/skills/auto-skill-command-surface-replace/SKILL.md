---
name: command-surface-replace
description: Clean replacement of old command surface — delete old commands entirely, directly reuse core pipelines, unify backend dispatch
source: auto-skill
extracted_at: '2026-06-17T02:22:49.948Z'
---

# Command Surface Replace

When replacing an old command surface with a new one, perform a clean cut: delete old commands entirely rather than hiding them. Reference existing implementation patterns for quality.

## When This Applies

- Replacing N old CLI/VSCode commands with M new unified commands
- The new command surface is defined in a spec document
- Implementation of new commands is complete, old surface needs removal

## Process

### 1. Delete Old Command Contributions (package.json)

Remove old commands from `contributes.commands` entirely. Do NOT add `when: "false"` entries to hide them — that leaves dead weight.

```json
// WRONG: hiding old commands
{ "command": "forja.qt.build", "when": "false" }

// RIGHT: just delete the entry entirely
```

Also remove corresponding `commandPalette` menu entries and update `explorer/context` to point to new command IDs.

### 2. Delete Old CLI Routes (cli/index.ts)

Remove old subcommand routing entirely. The CLI entry should only route to new commands.

```typescript
// WRONG: keeping old routes as "compatibility fallback"
case 'qt': await runQtCli(subArgs); break;
case 'sdk': await runSdkCli(subArgs); break;

// RIGHT: only new commands
await runUnifiedCli(argv);
```

### 3. Delete Old VSCode Registrations (extension.ts)

Remove old command registration calls from activate():

```typescript
// WRONG: keeping old registrations
registerQtCommands(context, pageManager);
await activateSdk(context);
registerRemoteCommands(context);

// RIGHT: only new unified registration
registerUnifiedCommands(context);
```

### 4. Directly Reuse Existing Pipelines (Not Thin Wrappers)

New command handlers must **directly call existing pipeline functions**, not write thin shell wrappers that forward args to old CLI entry points, and certainly not rewrite the logic from scratch.

**Step-by-step approach:**

1. **Read the existing CLI implementation** for each command you're replacing (e.g., `qt/cli/index.ts`, `sdk/cli/index.ts`)
2. **Identify the pipeline**: e.g., `parseCliArgs` → `createActionPlan` → `runCliResult` → `compactResult`/`textOutput`
3. **Export any functions you need** from the original modules (e.g., add `export` to `compactResult`, `textOutput`)
4. **Write new commands as parameter translation layers**: translate v2 args into the existing `CliOptions` format, then feed them into the existing pipeline

```typescript
// WRONG: thin shell wrapper that just forwards to old CLI
async function runBuild(workspace: string) {
    const { runQtCli } = require('../../qt/cli/index');
    await runQtCli(['build', '--workspace', workspace, '--json']);
}

// WRONG: rewriting the logic from scratch
async function runBuild(workspace: string) {
    // ... 200 lines of custom build logic ...
}

// RIGHT: directly call the existing pipeline
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult } from '../../qt/shared/commandRunner';
import { compactResult, textOutput } from '../../qt/cli/index';

async function runBuild(workspace: string, target: ActiveTarget) {
    const cliOptions = buildQtCliOptions(workspace, target, 'build', false);
    const planned = await createActionPlan(cliOptions);
    const result = await runCliResult(planned, { streaming: !wantsJson });
    if (wantsJson) { console.log(JSON.stringify(compactResult(result), null, 2)); }
    else { console.log(textOutput(result)); }
}
```

**Key functions to reuse from existing code:**
- **`createActionPlan(options)`** — resolves config, scans projects, builds command plan
- **`runCliResult(planned, { streaming, detach })`** — executes commands with foreground/detach/streaming modes, log file writing, GBK decoding
- **`compactResult(result)`** — JSON output that omits empty/null/default fields, handles build failure output specially
- **`textOutput(result)`** — human-readable text with status, workspace, project, diagnostics, nextActions
- **`extractErrors(output)`** / **`summarizeWarnings(output)`** — compiler output parsing

### 5. Unify Multiple Backend Dispatch

When the new commands must route to multiple backends (e.g., Qt local, SDK local, Remote), **extract each backend's core into a reusable plan module** and create a unified dispatch layer.

**Pattern: `createPlan → executePlan → output`**

```
ActiveTarget + v2 args
      │
      ▼
createPlan(target, action, workspace)  ← routes by kind × runAt
      │
      ├── Qt local:    createActionPlan()        (existing)
      ├── SDK local:   createSdkPlan()           (extracted from sdk/cli)
      └── Remote:      executeRemotePlan()       (extracted from remote/core)
      │
      ▼
executePlan(plan)  ← routes by execution mode
      │
      ├── Local:     runCliResult()   (existing, shared by Qt/SDK)
      └── Remote:    executePreparedRemoteAction()  (existing)
      │
      ▼
compactResult() / textOutput()  (shared output formatting)
```

**Step-by-step:**

1. **Identify what each backend's CLI does internally** — read the full implementation
2. **Extract core functions into `shared/plan.ts`** for each backend:
   - SDK: extract `buildCommand`, `executeAsync`, `extractErrors` into `sdk/shared/plan.ts`
   - Remote: wrap `executePreparedRemoteAction` with type-safe options in `remote/core/plan.ts`
3. **Command layer becomes pure dispatch** — no `require()` thin wrappers, just:
   ```typescript
   if (target.runAt === 'remote') {
       return executeRemotePlan({ workspace, target, action });
   }
   if (target.kind === 'sdk') {
       const plan = createSdkPlan({ action, workspace, project, mode, arch });
       const result = await executeSdkAsync(plan.shellCommand, workspace);
       // ... format output
   }
   // Qt local
   const planned = await createActionPlan(cliOptions);
   const result = await runCliResult(planned, { streaming, detach });
   ```

**Key principle:** The command layer should never call old CLI entry points (`runQtCli`, `runSdkCli`, `runRemoteCli`) with string arguments. It should call the extracted core functions directly.

**For commands that don't fit the pipeline pattern** (e.g., `stop`), call the underlying primitives directly:
```typescript
// WRONG: calling old CLI
await runQtCli(['stop', '--workspace', workspace]);

// RIGHT: calling core primitives
const state = readRunState(workspace);
const status = resolveRunProcessStatus(state);
if (status.running && state) { terminateProcess(state.pid); }
```

### 6. Use Meaningful Directory Names

Name implementation directories by what they contain, not by their relationship to old code:

```
// WRONG: internal labels
src/cli/unified/

// RIGHT: descriptive names
src/cli/commands/
```

### 7. Verify Output Format Against Spec Documents

After implementing all commands, **audit every command's output against its spec document**. Check field-by-field:

1. **Read each spec's Result interface** — extract the exact field list with types
2. **Read each spec's diagnostic code table** — extract all `code` values and their trigger conditions
3. **Read each spec's `ok` determination rule** — some commands define explicit rules (e.g., `stop` is idempotent: no running process → `ok: true`)
4. **Compare implementation vs spec** for each command:

```typescript
// WRONG: missing required fields, no diagnostic codes
{ ok: false, action: 'build', diagnostics: [{ level: 'error', message: '...' }] }

// RIGHT: all spec fields present, diagnostic has code
{
    ok: false,
    action: 'build',
    buildAction: 'default',        // spec-required field
    workspace: '/path/to/ws',      // from envelope
    activeTarget: { ... },         // spec-required field
    diagnostics: [{
        code: 'build.targetNotSelected',  // spec-required code
        level: 'error',
        message: '...',
    }],
    nextActions: ['forja list', 'forja use target --project <path>'],
}
```

**Common gaps to check:**
- `Diagnostic` objects must have `code` field (not just `level` + `message`)
- `activeTarget` must be included in execution command results (build/run/stop/clean)
- Action-specific fields (e.g., `buildAction`, `runAction`, `state` for stop)
- `ok` rule correctness (e.g., idempotent operations like `stop` should return `ok: true` even when nothing was running)

### 8. Update Tests to Match New Surface

Tests that assert on old command IDs, old registration patterns, or old routing must be updated or deleted. Don't leave tests that check for the existence of deleted commands.

```typescript
// WRONG: test still checks for deleted command
assert.ok(commands.includes('forja.syncChangedFiles'));

// RIGHT: test checks for new command
assert.ok(commands.includes('forja.sync'));
```

## Key Principles

- **Clean cut over compatibility**: When the spec says "old commands not preserved", delete them. Don't hide, don't keep as fallback.
- **Quality through reference**: Study existing well-written code in the same codebase before writing new handlers.
- **Meaningful names**: Directory and file names should describe purpose, not migration status.
- **Tests follow code**: When commands are deleted, their tests must be updated or removed in the same change.

### 9. Update All VSCode UI References to Old Commands

After replacing commands, **search the entire codebase** for remaining references to old command IDs. These hide in unexpected places:

- **Status bar items** (`unifiedStatusBar.ts`) — `_runItem.command`, `_debugItem.command`, `_projectModeItem.command`
- **Quick pick action handlers** — `executeCommand('forja.qt.build')` in action dispatch switches
- **Sync watcher** (`syncWatcher.ts`) — `_statusItem.command` for sync status bar
- **Config panel** (`messageHandler.ts`) — `executeCommand('forja.qt.selectProject')` in message handlers
- **File watchers** (`priWatcher.ts`) — `executeCommand('forja.qt.qmake')` in notification callbacks
- **Tree views** (`configNavTree.ts`) — `command: 'forja.config.openPage'` in tree item constructors

```bash
# Search for ALL old command references
grep -r "forja\.qt\." src/
grep -r "forja\.sdk\." src/
grep -r "forja\.remote\." src/
grep -r "forja\.sync" src/
grep -r "forja\.show" src/
```

### 10. Preserve Context Menu Argument Semantics

When replacing a context menu command (e.g., `.ui` file right-click), the new command **must accept the same arguments** as the old one. If the new unified command doesn't accept URI arguments, create a **separate command** for the context menu:

```typescript
// WRONG: new command ignores URI, breaks "Open with Designer" functionality
{ "command": "forja.run", "when": "resourceExtname == .ui" }

// RIGHT: separate command that accepts URI
{ "command": "forja.openDesigner", "when": "resourceExtname == .ui" }

// In unifiedCommands.ts:
vscode.commands.registerCommand('forja.openDesigner', async (uri?: vscode.Uri) => {
    // ... handle URI argument
});
```

### 11. CLI Functions Return Result Objects (No Side Effects)

CLI core functions (build, run, clean, etc.) should **return result objects** without writing to `process.exitCode` or `console.log`. The CLI entry point handles output formatting and exit code. VSCode commands consume result objects directly.

**Three-layer separation:**

```
CLI core function (build.ts, run.ts, clean.ts)
    │
    │ Returns: BuildResult | RunResult | CleanResult
    │ No side effects: no process.exitCode, no console.log
    │
    ▼
CLI entry point (index.ts handleBuild, handleRun, handleClean)
    │
    │ Calls: outputBuildResult(result, wantsJson)
    │ Sets: process.exitCode = result.ok ? 0 : 1
    │
    ▼
VSCode command handler (commands.ts)
    │
    │ Consumes: result.ok, result.diagnostics
    │ Shows: vscode.window.showErrorMessage(result.diagnostics?.[0]?.message)
    │ No process.exitCode checks
```

**Pattern:**

```typescript
// CLI core function — returns result, no side effects
export async function runBuild(workspace: string, action: BuildAction, options: {...}): Promise<BuildResult> {
    const targetResult = requireActiveTarget(workspace);
    if ('error' in targetResult) {
        return {
            ok: false,
            action: 'build',
            buildAction: action,
            diagnostics: [diag('build.targetNotSelected', 'error', targetResult.error)],
            nextActions: targetResult.nextActions,
        };
    }
    // ... execution logic ...
    return { ok: executed.ok, action: 'build', ... };
}

// Output formatter — exported separately, called by entry point
export function outputBuildResult(result: BuildResult, wantsJson: boolean): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(`Build ${result.ok ? 'succeeded' : 'failed'}`);
        // ... format text output ...
    }
}

// CLI entry point — handles output and exit code
async function handleBuild(argv: string[], workspace: string, wantsJson: boolean): Promise<void> {
    const result = await runBuild(workspace, buildAction, { plan: hasFlag(argv, '--plan'), json: wantsJson });
    outputBuildResult(result, wantsJson);
    if (!result.ok) { process.exitCode = 1; }
}

// VSCode command — consumes result directly
vscode.commands.registerCommand('forja.build', async (action?: string) => {
    const result = await runBuild(workspace(), buildAction, { json: true });
    if (result.ok) {
        vscode.window.showInformationMessage('Build succeeded');
    } else {
        const msg = result.diagnostics?.[0]?.message || 'Build failed';
        vscode.window.showErrorMessage(msg);
    }
});
```

**Why this pattern:**
- CLI functions are testable without mocking console/exitCode
- VSCode commands get structured error messages, not just exit codes
- No global state pollution between commands in extension host
- CLI entry point remains a thin dispatch layer

**Legacy pattern to avoid:**
```typescript
// WRONG: CLI function sets process.exitCode and writes to console
export async function runBuild(...): Promise<void> {
    // ... execution ...
    console.log(`Build ${ok ? 'succeeded' : 'failed'}`);
    process.exitCode = ok ? 0 : 1;
}

// WRONG: VSCode command checks process.exitCode
await runBuild(workspace(), action, { json: true });
if (process.exitCode === 1) {
    vscode.window.showErrorMessage('Build failed');
}
```

### 12. Avoid PowerShell for UTF-8 File Manipulation

PowerShell's `Get-Content`/`Set-Content` can corrupt UTF-8 files with non-ASCII characters (Chinese, Japanese, etc.). Use direct file editing tools or Node.js scripts instead:

```powershell
# WRONG: corrupts Chinese strings
(Get-Content 'file.ts') -replace 'old', 'new' | Set-Content 'file.ts'

# RIGHT: use Node.js or direct edit tools
node -e "const fs=require('fs'); let c=fs.readFileSync('file.ts','utf8'); c=c.replace(/old/g,'new'); fs.writeFileSync('file.ts',c,'utf8')"
```

### 13. Avoid Duplicate VSCode Command Registration

When both a status bar module and a unified command module register the same command ID, VSCode throws at activation. Use a **private prefix** (`_`) for internal UI commands:

```typescript
// WRONG: both modules register 'forja.list'
// unifiedStatusBar.ts:
vscode.commands.registerCommand('forja.list', () => showUnifiedActions());
// unifiedCommands.ts:
vscode.commands.registerCommand('forja.list', async () => { ... });

// RIGHT: internal command uses private prefix
// unifiedStatusBar.ts:
vscode.commands.registerCommand('forja._showActions', () => showUnifiedActions());
_projectModeItem.command = 'forja._showActions';  // status bar clicks internal command
// unifiedCommands.ts:
vscode.commands.registerCommand('forja.list', async () => { ... });  // public command
```

### 14. Parameterize Sub-Actions Through Command Arguments

When the status bar presents multiple sub-actions (QMake, RCC, Rebuild, custom commands), pass the sub-action as a **command argument** rather than mapping everything to the same plain command:

```typescript
// WRONG: all sub-actions map to plain forja.build
else if (selected.action === 'qt:qmake') { vscode.commands.executeCommand('forja.build'); }
else if (selected.action === 'qt:rcc') { vscode.commands.executeCommand('forja.build'); }
else if (selected.action === 'sdk:rebuild') { vscode.commands.executeCommand('forja.build'); }

// RIGHT: pass sub-action as argument
else if (selected.action === 'qt:qmake') { vscode.commands.executeCommand('forja.build', 'qmake'); }
else if (selected.action === 'qt:rcc') { vscode.commands.executeCommand('forja.build', 'rcc'); }
else if (selected.action === 'sdk:rebuild') { vscode.commands.executeCommand('forja.build', 'fresh'); }

// Handler accepts optional parameter:
vscode.commands.registerCommand('forja.build', async (action?: string) => {
    const buildAction = (action || 'default') as BuildAction;
    await runBuild(workspace(), buildAction, { json: true });
});
```

### 15. No Intermediate Command IDs for Internal Module Calls

After command consolidation, if module A needs to invoke functionality owned by module B, **export functions directly** — do NOT register intermediate command IDs (e.g., `forja.sdk.build`) just for internal routing.

**Anti-pattern:**
```typescript
// sdkExtension.ts — registers intermediate commands
vscode.commands.registerCommand('forja.sdk.build', () => sdkBuilder.build());
vscode.commands.registerCommand('forja.sdk.rebuild', () => sdkBuilder.rebuild());
vscode.commands.registerCommand('forja.sdk.clean', () => sdkBuilder.clean());

// vscode/commands.ts — calls through executeCommand (unnecessary indirection)
if (target?.kind === 'sdk') {
    await vscode.commands.executeCommand('forja.sdk.build');
}
```

**Correct pattern:**
```typescript
// sdkExtension.ts — export functions, no command registration
export async function buildSdk(): Promise<void> {
    if (!sdkBuilder) { vscode.window.showErrorMessage('SDK not activated'); return; }
    await sdkBuilder.build();
}
export async function rebuildSdk(): Promise<void> { ... }
export async function cleanSdk(): Promise<void> { ... }

// vscode/commands.ts — direct import, same pattern as Qt
if (target?.kind === 'sdk') {
    const { buildSdk, rebuildSdk } = await import('../sdk/sdkExtension');
    if (action === 'fresh') { await rebuildSdk(); }
    else { await buildSdk(); }
}
```

**Rules:**
- `package.json` contributes.commands should ONLY contain user-facing commands
- `executeCommand` is for invoking user-facing commands or VSCode built-in commands
- Internal module-to-module calls use direct function imports
- If the callee needs module-level state (e.g., `sdkBuilder` instance), expose it via module-level variable initialized during activation, with null-guard in exported functions
- Both Qt and SDK should follow the same routing pattern in `vscode/commands.ts`: direct import → call function

**Implementation for class-based modules:**
```typescript
// Module-level instance (set during activation)
let sdkBuilder: SdkBuilder | null = null;

// Exported function with null-guard
export async function buildSdk(): Promise<void> {
    if (!sdkBuilder) {
        vscode.window.showErrorMessage('SDK module not activated');
        return;
    }
    await sdkBuilder.build();
}

// In activateSdk():
sdkBuilder = new SdkBuilder(stateManager, configService);
```

## Checklist

- [ ] Old commands removed from `package.json` contributes.commands (not hidden with `when: "false"`)
- [ ] Old `commandPalette` menu entries deleted
- [ ] Old CLI routes deleted from dispatcher
- [ ] Old VSCode registration calls removed from extension.ts
- [ ] New command handlers directly call core pipeline functions (not old CLI entry points)
- [ ] Multiple backends unified via extracted plan modules (createPlan → executePlan → output)
- [ ] Output format audited against spec documents (all Result fields, diagnostic codes, ok rules)
- [ ] All VSCode UI references to old commands updated (status bar, watchers, config panel, tree views)
- [ ] Context menu commands preserve argument semantics (URI, etc.)
- [ ] CLI core functions return result objects (no process.exitCode/console.log side effects)
- [ ] CLI entry point handles output formatting and exit code
- [ ] VSCode commands consume result objects directly (no process.exitCode checks)
- [ ] No duplicate command ID registrations (internal UI commands use `_` prefix)
- [ ] Sub-actions passed as command arguments (not mapped to same plain command)
- [ ] No intermediate command IDs for internal module-to-module calls (use direct function exports)
- [ ] Directory names are meaningful (not "unified", "legacy", "v2")
- [ ] Tests updated to assert on new commands only
- [ ] `npm run compile` passes
- [ ] `npm test` passes with no failures
