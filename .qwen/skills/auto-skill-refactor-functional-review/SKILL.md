---
name: refactor-functional-review
description: Post-implementation review of a large refactoring to catch functional regressions and dead code
source: auto-skill
extracted_at: '2026-06-22T04:07:03.194Z'
---

# Refactor Functional Review

After a large refactoring that replaces old command surface with new implementations, systematically verify that no functionality was lost. Focus on execution path differences, dead code, and VSCode-specific integration that raw CLI replacements may miss.

## When This Applies

- A large refactoring replaced N old commands/files with M new ones
- New implementations call core primitives directly (as they should)
- You need to verify nothing was silently lost in the transition
- Especially important when old handlers had VSCode-specific integration beyond just calling core functions

## Review Dimensions

A comprehensive refactor review covers 4 dimensions:

1. **Architecture** — dependency direction, module boundaries, layer violations
2. **Functionality** — command coverage completeness, old→new mapping, feature gaps
3. **Stability** — error handling, edge cases, test coverage
4. **Faithfulness** — adherence to design docs, specs, and prior design decisions

## Process

### 1. Collect All Changes

```bash
git status                                    # staged + unstaged + untracked
git diff --stat HEAD                          # file-level change summary
git diff HEAD -- <key-file>                   # detailed diff per file
git show HEAD:<old-file>                      # read old version of replaced files
```

Focus on:
- Files that were **deleted** or **renamed** (functionality may have moved)
- Files that were **modified** (behavior may have changed)
- Files that were **added** (new implementations to verify)
- Registration entry points: `extension.ts`, `package.json`, CLI dispatcher

### 2. Map Old Execution Paths vs New

For each old command, trace the **full execution path** and compare with the new one:

| Layer | Old Path | New Path | Match? |
|-------|----------|----------|--------|
| Registration | `registerCommand('forja.qt.build', ...)` | `registerCommand('forja.build', ...)` | ✅ |
| Handler body | `buildManager.build()` | `runBuild()` → `runCliResult()` | ⚠️ |
| Execution | `vscode.tasks.executeTask()` | `cp.exec()` / `cp.spawn()` | ❌ |
| Output | VSCode terminal + problem matcher | Log file + popup message | ❌ |
| State mgmt | `setState('isBuilding', true/false)` | Not set | ❌ |

**Key insight**: Even when new commands correctly call core primitives (`createActionPlan`, `runCliResult`), they may bypass VSCode-specific integration layers (task system, terminal, problem matchers) that the old VSCode command handlers provided.

### 3. Check for VSCode-Specific Integration Losses

Old VSCode command handlers often do more than just call core functions. Check for:

| Integration Point | What to Look For | Where It Lives |
|------------------|-------------------|----------------|
| **VSCode Task system** | `vscode.tasks.executeTask()` | `buildManager.ts` |
| **Problem matchers** | Task `problemMatcher` config | Task creation code |
| **Terminal output** | `presentationOptions`, `TaskPanelKind` | Task creation code |
| **State flags** | `setState('isBuilding', ...)`, `setState('isRunning', ...)` | Command handlers |
| **Task end listeners** | `vscode.tasks.onDidEndTask` / `onDidEndTaskProcess` | `extension.ts` activate() |
| **Progress notifications** | `vscode.window.withProgress()` | Command handlers |
| **Pseudoterminal** | `vscode.Pseudoterminal`, `EventEmitter` | Remote run handlers |
| **Diagnostic collections** | `vscode.languages.createDiagnosticCollection()` | Remote command handlers |
| **QuickPick workflows** | Multi-step `showQuickPick` chains | Workbench, selectProject |

### 3b. Check for Conditional Routing Losses

When old handlers had **conditional branching** (e.g., local vs remote, different backends, feature flags), the new unified command handlers must replicate ALL branches — not just the primary one.

**Common pattern**: Old VSCode handlers check a config flag and route to different backends:
```typescript
// OLD: remote/vscode/commands.ts
if (command.kind === 'preparedAction') {
    const result = await executePreparedRemoteAction({ ... });
} else if (command.kind === 'bridgeAction') {
    const bridge = await executeRemoteBridge({ ... });
}
```

**What goes wrong**: New unified handlers only implement the local/primary path:
```typescript
// NEW: vscode/commands.ts — MISSING remote routing!
vscode.commands.registerCommand('forja.build', async () => {
    const buildManager = await import('../qt/build/buildManager');
    await buildManager.build();  // Always local, never checks runAt
});
```

**How to check**:
1. List all conditional branches in old deleted handlers (`if`, `switch`, ternary on config/state)
2. For each branch, verify the new handler has an equivalent check
3. Pay special attention to:
   - **Execution location** (`runAt: 'local' | 'remote'`, `executionLocation`)
   - **Target kind** (`kind: 'qt' | 'sdk'`) — already handled in this project
   - **Feature flags** or context keys (`forja.sdk.activated`)
   - **Mode-dependent behavior** (debug vs release, foreground vs detached)

**Severity**: This is typically **P0/Critical** because the feature silently degrades — users configure remote execution but VSCode commands always run locally.

### 3c. Check Wrapper/Adapter Parameter Passthrough

When new code wraps core functions (e.g., `executeRemotePlan` wrapping `executePreparedRemoteAction`), the wrapper may hardcode parameters that should be context-dependent.

**Common pattern**: A wrapper function provides a simpler interface but hardcodes values:
```typescript
// NEW: remote/core/plan.ts — wrapper function
export async function executeRemotePlan(options: RemotePlanOptions): Promise<RemotePlanResult> {
    const result = await executePreparedRemoteAction({
        workspace,
        remotePath,
        ignore: [],              // ❌ Hardcoded empty array
        owner: 'forja-cli',      // ❌ Hardcoded owner
        runner,
        uploader,
        // ...
    });
}
```

**What goes wrong**:
- VSCode callers need `owner: 'vscode'` but get `'forja-cli'`
- User-configured `ignore` patterns are lost
- Remote actions may sync files that should be ignored

**How to check**:
1. Find all wrapper/adapter functions that call core primitives
2. For each parameter passed to the core function, verify:
   - Is it hardcoded? Should it be configurable?
   - Does the caller context matter? (VSCode vs CLI vs test)
   - Are there user-configurable values that should be passed through?

**Fix pattern**: Add optional parameters to the wrapper with sensible defaults:
```typescript
export interface RemotePlanOptions {
    workspace: string;
    target: 'qt' | 'sdk';
    action: 'build' | 'rebuild' | 'clean' | 'run' | 'stop' | 'status';
    owner?: string;      // ← Added
    ignore?: string[];   // ← Added
}

export async function executeRemotePlan(options: RemotePlanOptions): Promise<RemotePlanResult> {
    const { owner = 'forja-cli', ignore = [] } = options;  // ← Defaults
    const result = await executePreparedRemoteAction({
        workspace,
        remotePath,
        ignore,        // ← Use parameter
        owner,         // ← Use parameter
        // ...
    });
}
```

**Severity**: **P0/Critical** when hardcoded values cause wrong behavior (e.g., wrong owner, missing ignore patterns).

### 3d. Check for Lost Standalone Utility Commands

When old code had many fine-grained commands and the new design consolidates into fewer commands, standalone utility commands may be silently dropped.

**Common pattern**: Old code has many specialized commands:
```typescript
// OLD: remote/vscode/commands.ts
const REMOTE_COMMANDS = [
    { id: 'forja.remote.test', kind: 'test' },
    { id: 'forja.remote.bootstrap', kind: 'bootstrap' },
    { id: 'forja.remote.transfer.status', kind: 'transferStatus' },
    { id: 'forja.remote.qt.ps', kind: 'bridgeAction', action: 'ps' },
    { id: 'forja.remote.workbench', kind: 'workbench' },
    // ... many more
];
```

**What goes wrong**: New consolidated design only implements the "main" commands (build, run, stop, clean) but drops utility commands that users rely on for diagnostics and management.

**How to check**:
1. List ALL command IDs from old deleted files (not just the main ones)
2. Categorize them:
   - **Core operations**: build, run, stop, clean, debug → must be in new design
   - **Diagnostic utilities**: test, doctor, status, ps → often dropped, must be restored
   - **Management utilities**: bootstrap, transfer status, workbench → often dropped, must be restored
   - **Mode variants**: detached run, foreground run → check if all variants are supported
3. For each dropped command, verify:
   - Is it still accessible via CLI? (If yes, lower priority)
   - Does it provide VSCode-specific UX? (If yes, must restore)
   - Is it referenced in workbench menus or status bar? (If yes, must restore)

**Severity**:
- **P0/Critical** if diagnostic utilities are lost (users can't troubleshoot)
- **P1/Medium** if management utilities are lost (users lose convenience features)

### 4. Find Dead Code (Including Transitive)

After refactoring, old files may still exist but never be called:

```bash
# Check if old registration functions are still called
grep -r "registerQtCommands" src/
grep -r "registerRemoteCommands" src/

# Check if old command IDs are still referenced
grep -r "forja\.qt\." src/
grep -r "forja\.sdk\." src/
grep -r "forja\.remote\." src/
```

**Dead code indicators:**
- File exists but its export is never imported
- Registration function exists but is never called in `extension.ts`
- Old command IDs still appear in source but are never registered in `package.json`

**Transitive dead code**: After identifying directly orphaned files, trace their imports — files that are *only* imported by orphaned files are also dead code:

```bash
# If remote/vscode/commands.ts is dead, check what it imports
grep "from '\." src/remote/vscode/commands.ts
# → ./diagnostics, ./problemMatcher — check if anyone else imports them
grep -r "from.*remote/vscode/diagnostics" src/
grep -r "from.*remote/vscode/problemMatcher" src/
# If no other imports exist → those files are also dead
```

**⚠️ Bidirectional check before deleting transitive dead code**: Before deleting files identified as "transitive dead code," check whether the **new replacement code** needs the same utilities. In this refactoring, `problemMatcher.ts` and `diagnostics.ts` were only imported by the deleted `remote/vscode/commands.ts`, so they appeared dead. But the new `vscode/commands.ts` remote execution path needed the same diagnostic publishing functionality. **Rule**: If a transitively-orphaned file provides a general capability (error parsing, diagnostic publishing, path mapping), restore it rather than deleting it — the new code will likely need it too.

**Action**: Delete truly dead files entirely. Don't keep them "just in case." But restore utility files that the new execution path needs.

### 5. Check State Management Continuity

Many VSCode extensions rely on in-memory state flags for UI updates. When commands are replaced:

1. **List all `setState()` calls** in old command handlers
2. **Verify each one has an equivalent** in new command handlers or their callees
3. **Check task/event listeners** that reset state — these are easy to delete accidentally

Common state flags to verify:
- `isBuilding` / `isRunning` — set before execution, reset on completion
- `buildAction` — tracks whether current build is for run/debug
- `currentProject` — updated when user selects a project

### 6. Check Config Panel / Message Handler References

Config panels often reference command IDs in message handlers:

```bash
grep -n "executeCommand" src/ui/configPanel/messageHandler.ts
grep -n "executeCommand" src/sync/syncWatcher.ts
```

Verify each `executeCommand()` call uses a command ID that is still registered.

### 7. Verify Test Coverage Adaptation

Tests that assert on old command IDs, file names, or registration patterns must be updated:

```bash
# Check for stale test references
grep -r "forja\.qt\." src/test/
grep -r "unifiedStatusBar" src/test/
```

New tests should cover:
- New command IDs exist in `package.json`
- Old command IDs do NOT exist
- Core function round-trips (save → load activeTarget)
- CLI argument parsing for new command surface

**Post-deletion test check**: After deleting dead code files, run tests immediately. Tests may `readFileSync` deleted files to assert on their source content (e.g., checking that a file contains certain patterns). These tests must be deleted or updated:

```bash
# After deleting src/remote/vscode/commands.ts:
# → check if any test reads that path
grep -r "remote/vscode/commands" src/test/
# → delete or update the test that references it
```

### 8. Categorize Findings by Severity

| Severity | Criteria | Example |
|----------|----------|---------|
| 🔴 Critical | Feature completely broken or silently degraded | Build output not shown in terminal |
| 🟡 Medium | Feature partially working or degraded UX | Remote workbench menu missing |
| 🟢 Minor | Code quality issue, no user impact | Dead code file not deleted |

### 9. Verify Architecture Dependency Rules

After refactoring, new files may introduce dependency violations. Check import directions against the project's architecture rules (typically in `harness/project/rules/architecture-dependencies.md`):

```bash
# Check for forbidden import directions
# Example: sdk/ must NOT import from qt/
grep -r "from.*\.\./qt" src/sdk/
# Example: core/ must NOT import from qt/, sdk/, or ui/
grep -r "from.*\.\./qt\|from.*\.\./sdk\|from.*\.\./ui" src/core/
# Example: CLI files must NOT import vscode
grep -r "from.*vscode" src/cli/ src/core/ src/qt/shared/
```

**Common violations after refactoring:**
- Shared types imported across module boundaries (e.g., `sdk/` importing `CliResult` from `qt/cli/types`)
- CLI command files accidentally importing vscode-dependent modules
- New "shared" files that actually depend on one specific module

**Fix**: Extract shared types to `core/` or create module-local type definitions.

### 10. Check Code Quality Patterns

Refactoring often introduces code quality issues that don't cause failures but increase maintenance burden:

**Duplicate helpers**: When multiple new command files each define the same utility function:
```bash
# Check for duplicated helper functions across new files
grep -rn "function diag(" src/cli/commands/
# → If found in 5+ files, extract to shared types.ts
```

**Dynamic require() vs static import**: New files using `require()` instead of `import`:
```bash
grep -rn "require(" src/cli/commands/
# → Should use static import unless there's a documented reason for lazy loading
```

**Oversized files**: New files that are too large (>500 lines) may need splitting:
```bash
wc -l src/vscode/commands.ts
# → Consider separating registration from helper functions
```

**Unused variables**: Computed but unused values (dead code within live files):
```bash
# After compile, check for unused variable warnings
npx tsc --noEmit 2>&1 | grep "unused"
```

### 11. Assess Test Coverage Gaps

New code needs tests. After refactoring, check which new modules lack test coverage:

```bash
# List new source files
git diff --name-only HEAD | grep "^src/" | grep -v test
# List new test files
git diff --name-only HEAD | grep "test"
# Compare: which new source files have no corresponding test?
```

**Priority order for test coverage:**
1. Core command logic (build, run, stop, status) — highest risk if broken
2. Type conversion/validation (activeTarget, candidates) — already tested in this project
3. Output formatting (text/JSON) — lower risk but helps catch regressions
4. Edge cases (missing config, corrupt files, network failures)

### 11. Check for Async Initialization Race Conditions

When refactoring changes module initialization from synchronous (`await activateSdk()`) to asynchronous (fire-and-forget with `.catch()`), exported functions from that module may be called before initialization completes.

**Common pattern**: Module-level variables initialized in `activate()`:
```typescript
let builder: Builder | null = null;

export async function build(): Promise<void> {
    if (!builder) {
        vscode.window.showErrorMessage('Module not activated');
        return;
    }
    await builder.build();
}

// In extension.ts — ASYNC, no await!
activateSdk(context).catch(e => logger.error(e.message));
```

**What goes wrong**: If `build()` is called before `activateSdk()` completes, `builder` is null and the user sees "Module not activated" even though activation is in progress.

**Fix pattern**: Use a ready promise with `try/finally`:
```typescript
let _readyResolve: (() => void) | null = null;
const ready = new Promise<void>(resolve => { _readyResolve = resolve; });

export async function build(): Promise<void> {
    await ready;  // Wait for activation to complete (or fail)
    if (!builder) {
        vscode.window.showErrorMessage('Module not activated');
        return;
    }
    await builder.build();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        // ... initialization code ...
        builder = new Builder(...);
    } finally {
        _readyResolve!();  // Always resolve, even on error
    }
}
```

**Key rules**:
- Use `try/finally` to ensure the ready promise resolves even if activation throws
- Callers `await ready` before checking module state
- This converts "race condition" into "wait for initialization"

**How to check**:
1. Find module activation calls in `extension.ts` that are NOT awaited
2. Check if those modules export functions that depend on module-level state
3. If yes, add ready promise protection

### 12. Check for CLI String Forwarding Anti-Pattern

When new command handlers call old CLI entry points with reconstructed string argv arrays instead of calling core primitives directly.

**Anti-pattern**:
```typescript
// BAD: Forwarding through old CLI with string parameters
case 'transfer': {
    await runRemoteCli(['transfer', '--workspace', workspace, '--json', '--transferAction', 'run']);
}
```

**Correct pattern**:
```typescript
// GOOD: Call core function directly with structured parameters
const result = await executeRemoteTransfer({
    remotePath: actionRemotePath,
    transfer,
    deployServer,
    runner,
});
```

**How to check**:
```bash
# Look for old CLI entry calls in new command files
grep -rn "runRemoteCli\|runQtCli\|runSdkCli" src/cli/commands/
```

**Severity**: P0 — adds unnecessary indirection, makes error handling harder, violates call-core-primitives-directly principle.

### 13. Check for Empty Function Stubs

New functions that return empty/default values without actual implementation.

**Anti-pattern**:
```typescript
function listEnv(_workspace: string): ListResult {
    const env: EnvSummary = {};  // Always empty!
    return { ok: true, action: 'list', category: 'env', env };
}
```

**How to check**:
1. Look for functions that return objects with empty arrays/objects
2. Check if the function body actually computes anything
3. Verify the function is called and its result is used

**Fix**: Read from config or call detection functions:
```typescript
function listEnv(workspace: string): ListResult {
    const qt = loadQtSettings(workspace);
    const sdk = loadSdkSettings(workspace);
    const env: EnvSummary = {};
    if (qt.qtPath) { env.qt = [{ path: qt.qtPath }]; }
    if (qt.vsInstall) { env.vs = [{ path: qt.vsInstall }]; }
    // ...
}
```

**Severity**: P1 — feature appears to work but returns no useful data.

### 14. Check for Input Validation from File-Sourced Data

When reading values from config files or state files, validate them before using in shell commands or system calls. File contents may be corrupted or tampered with.

**Anti-pattern**:
```typescript
function terminateProcess(pid: number): boolean {
    // PID read from local state file — no validation!
    cp.execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    return true;
}
```

**Risk**: If the state file is corrupted or tampered with, `pid` could contain malicious values leading to command injection.

**Fix**: Validate input before use:
```typescript
function terminateProcess(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) { return false; }
    // Now safe to use in shell command
    cp.execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    return true;
}
```

**How to check**:
```bash
# Find shell commands using values from config/state files
grep -rn "execSync\|exec(" src/cli/commands/ | grep -v "test"
# Check if the values come from file reads without validation
```

**Severity**: P1 — security risk if file contents are untrusted.

### 15. Check for State Preservation in Sync Functions

When syncing state between two representations (e.g., activeTarget and domain config), preserve existing user-configured values rather than hardcoding defaults.

**Anti-pattern**:
```typescript
function _syncQtActiveTarget(workspace: string, relativeProject: string): void {
    const existing = loadActiveTarget(workspace);
    if (!existing || existing.kind === 'qt') {
        saveActiveTarget(workspace, {
            kind: 'qt',
            project: relativeProject,
            mode: state.mode || 'debug',
            arch: state.arch || 'x86',
            runAt: 'local',  // ❌ Hardcoded! Overwrites user's 'remote' setting
        });
    }
}
```

**Risk**: User configured `runAt: 'remote'` but selecting a new project resets it to `'local'`.

**Fix**: Preserve existing values when updating:
```typescript
function _syncQtActiveTarget(workspace: string, relativeProject: string): void {
    const existing = loadActiveTarget(workspace);
    if (!existing || existing.kind === 'qt') {
        saveActiveTarget(workspace, {
            kind: 'qt',
            project: relativeProject,
            mode: state.mode || existing?.mode || 'debug',
            arch: state.arch || existing?.arch || 'x86',
            runAt: existing?.runAt || 'local',  // ✅ Preserve existing
        });
    }
}
```

**How to check**:
1. Find functions that sync state between representations (e.g., `_sync*`, `*ToActiveTarget`)
2. Check if any fields are hardcoded instead of using existing values
3. Verify user-configured values are preserved across updates

**Severity**: P2 — user configuration unexpectedly reset.

### 16. Two-Round Review Methodology

For large refactorings, use a two-round review approach to catch both obvious and subtle issues:

**Round 1 — Breadth-first (architecture & coverage)**:
- Architecture: dependency direction, module boundaries, layer violations
- Functionality: command coverage completeness, old→new mapping
- Stability: error handling, type safety, edge cases
- Faithfulness: adherence to design docs and specs
- Fix critical issues found (P0/P1)

**Round 2 — Depth-first (layer-by-layer)**:
- Core layer: settingsIO, types, shared utilities
- Domain layers: qt, sdk, remote (each separately)
- UI layer: statusBar, configPanel, messageHandler
- Test layer: test coverage, stale references
- Config layer: package.json vs extension.ts registration consistency

**Why two rounds**: Round 1 catches structural issues. Round 2 catches subtle issues like state sync bugs, redundant logic, and configuration inconsistencies that only appear when examining specific layers in detail.

### 17. Check CLI Build/Packaging Scripts for vscode Dependency Leakage

When a project has both VSCode extension and standalone CLI packages, build scripts that copy directories may accidentally include files with vscode dependencies, causing CLI runtime errors.

**Anti-pattern**:
```javascript
// scripts/build-cli.js — copies entire directory
const dirs = [
    'cli',
    'qt/cli',
    'qt/build',  // ❌ Contains buildManager.ts, debugger.ts with vscode imports
    'remote/core'
];
```

**What goes wrong**: The `qt/build/` directory contains `buildManager.ts`, `debugger.ts`, `configGenerator.ts` which all import `vscode`. When the CLI package tries to load these files, it fails with `Cannot find module 'vscode'`.

**Correct pattern**: Copy only the files that don't depend on vscode:
```javascript
// scripts/build-cli.js — copy individual files
const dirs = [
    'cli',
    'qt/cli',
    // 'qt/build',  // ❌ Don't copy entire directory
    'remote/core'
];

// Only copy vscode-free files from qt/build/
const qtBuildFiles = ['qt/build/designer.js'];
```

**How to check**:
```bash
# Find all files in directories that will be copied to CLI package
grep -n "dirs = \[" scripts/build-cli.js
# For each directory, check if any files import vscode
for dir in qt/build sdk/shared; do
    grep -l "from.*vscode" src/$dir/*.ts 2>/dev/null
done
```

**Severity**: P0 — CLI package crashes at runtime when trying to use features that depend on vscode-leaked files.

### 18. Verify Documentation Consistency Across All Artifacts

When command surface changes, all documentation must be updated simultaneously. Check:

1. **README.md** — project overview, capability list
2. **docs/README-cli.md** — CLI user guide (copied into CLI package)
3. **skills/forja/SKILL.md** — AI skill instructions (copied into CLI package)
4. **docs/operations/command-consolidation/v2/*.md** — design docs

**Common inconsistencies**:
- README still lists old command categories (`Qt: status/init/env/...`)
- CLI guide still uses `forja qt status`, `forja remote status`
- SKILL.md examples still use `forja qt build`, `forja sync servers`
- SKILL.md documents wrong parameter names (`--vs-install` vs `--vs-dev-cmd`)

**How to check**:
```bash
# Search for old command patterns in all documentation
grep -rn "forja qt \|forja sdk \|forja remote " README.md docs/ skills/
# Search for old subcommand patterns
grep -rn "forja sync servers\|forja sync add-server" docs/ skills/
# Verify parameter names match implementation
grep -n "vs-install\|vs-dev-cmd" skills/forja/SKILL.md src/cli/commands/use.ts
```

**Severity**: P1 — users and AI agents following outdated documentation will use wrong commands.

### 19. Verify Config Resolution Consistency Across All Consumers

When multiple code paths read the same configuration (e.g., remote server), they must use the same resolver function, not different config sources.

**Anti-pattern**:
```typescript
// status.ts — uses resolveRemoteConfig (correct)
const resolved = resolveRemoteConfig(workspace);
const server = resolved.config?.server;

// status.ts buildRemoteStatusSummary — reads sync config directly (wrong!)
const sync = loadSyncSettings(workspace);
const server = sync.selectedServer ? getServerById(sync.selectedServer) : null;
// ❌ Different source! May show different server than readiness check
```

**What goes wrong**: User runs `forja use remote --server A`, then `forja status` shows:
- Readiness: server A (from resolveRemoteConfig)
- Summary: server B or empty (from sync.selectedServer)

**Fix pattern**: All consumers use the same resolver:
```typescript
function buildRemoteStatusSummary(workspace: string): RemoteStatusSummary {
    const remote = loadRemoteSettings(workspace);
    const sync = loadSyncSettings(workspace);
    // Prefer remote.selectedServer, fallback to sync.selectedServer
    const serverId = remote.selectedServer || sync.selectedServer;
    const server = serverId ? getServerById(serverId) : null;
    return {
        server: server ? { id: server.id, name: server.name, host: server.host } : undefined,
        // ...
    };
}
```

**How to check**:
```bash
# Find all places that read server config
grep -rn "selectedServer\|getServerById" src/cli/commands/ src/vscode/
# Verify they all use the same resolution logic
grep -rn "resolveRemoteConfig" src/
```

**Severity**: P1 — confusing UI where different parts of the same command show different data.

**Severity**: Process recommendation — ensures comprehensive coverage.

## Checklist

- [ ] All old execution paths traced and compared with new paths
- [ ] VSCode task system integration verified (terminal output, problem matchers)
- [ ] Conditional routing branches verified (local vs remote, target kind, feature flags)
- [ ] Wrapper/adapter functions pass through context-dependent parameters (owner, ignore, etc.)
- [ ] All standalone utility commands accounted for (test, bootstrap, transfer status, ps, workbench)
- [ ] State management flags (`isBuilding`, `isRunning`) verified in new handlers
- [ ] Task/event listeners verified (not accidentally deleted)
- [ ] Dead code files identified and marked for deletion
- [ ] All `executeCommand()` calls in UI code reference valid new command IDs
- [ ] Config panel / message handler references updated
- [ ] Tests updated to assert on new command surface
- [ ] All new commands registered in `package.json` contributes
- [ ] Internal commands hidden with `when: "false"` in commandPalette
- [ ] Findings categorized by severity (Critical / Medium / Minor)
- [ ] Fix priorities assigned (P0 = critical, P1 = medium, P2 = minor)
- [ ] Compile passes with no type errors
- [ ] All tests pass after fixes
- [ ] Architecture dependency rules verified (no forbidden import directions)
- [ ] Code quality patterns checked (no duplicate helpers, no unnecessary require(), no oversized files)
- [ ] Test coverage gaps identified and prioritized for new code
- [ ] Async initialization race conditions checked (un-awaited activate calls + exported functions)
- [ ] CLI string forwarding anti-pattern checked (no `runXxxCli(['...'])` in new commands)
- [ ] Empty function stubs checked (functions returning empty objects without implementation)
- [ ] Input validation checked for file-sourced data used in shell commands
- [ ] State preservation checked in sync functions (existing user values not overwritten)
- [ ] Module-active-but-no-config fallback checked (dual-state architectures)
- [ ] Dead exports checked within live files (exported but never imported)
- [ ] Inline logic duplication checked (same pattern in multiple places → extract shared function)
- [ ] Two-round review completed (Round 1: breadth-first, Round 2: depth-first by layer)
- [ ] Multi-line output uses OutputChannel, not showInformationMessage
- [ ] Command handlers have guard checks for target kind and execution location
- [ ] Dead imports checked in command files after extracting helpers
- [ ] Path resolution consistency verified (new commands use same resolve functions as old CLI)
- [ ] Argument parsing skips flag values, not just flags
- [ ] Fix-mode commands skip initial blocked checks that they resolve
- [ ] Artifact lookup uses __dirname-based root, not process.cwd()
- [ ] All findings fixed (not just high-priority ones) before declaring complete
- [ ] CLI override flags (--server, etc.) passed through to all resolution functions
- [ ] Backend support matrix verified (operations routed only to backends that support them)
- [ ] Dry-run/plan flags checked BEFORE all execution branches (not just local)
- [ ] Config domain isolation verified (independent features don't share write domains)
- [ ] Required/mutually-exclusive flags validated before defaulting
- [ ] Unknown positional arguments error instead of falling through to default action
- [ ] VSCode resources (OutputChannel, DiagnosticCollection) registered in context.subscriptions
- [ ] Command palette visibility tests cover internal/advanced commands
- [ ] CLI build/packaging scripts checked for vscode dependency leakage (directory copies vs individual files)
- [ ] Documentation consistency verified (README.md, SKILL.md, docs/ all use new command surface)
- [ ] Config resolution consistency verified (all consumers use same resolver, not different config sources)
- [ ] Numeric CLI parameters validated (e.g., port range 1-65535, not NaN)
- [ ] SKILL.md examples use v2 command names (no `forja qt status`, `forja sync servers` etc.)

## Fix Pattern: VSCode Command Routing

When fixing commands that lost VSCode integration or conditional routing, route based on active target state using **direct function imports** (not intermediate command IDs):

```typescript
// In vscode/commands.ts — for commands that have both VSCode-native and CLI paths
context.subscriptions.push(
    vscode.commands.registerCommand('forja.build', async (action?: string) => {
        const target = getActiveTarget(workspace());

        // Remote → call remote plan executor (SSH-based)
        if (target?.runAt === 'remote') {
            const { executeRemotePlan } = await import('../remote/core/plan');
            const result = await executeRemotePlan({
                workspace: workspace(),
                target: target.kind,
                action: action === 'fresh' ? 'rebuild' : (action || 'build'),
            });
            if (!result.ok) {
                vscode.window.showErrorMessage(result.diagnostics.map(d => d.message).join('\n'));
            }
            return;
        }

        // SDK → call exported function directly (no intermediate command ID)
        if (target?.kind === 'sdk') {
            const { buildSdk, rebuildSdk } = await import('../sdk/sdkExtension');
            if (action === 'fresh') { await rebuildSdk(); }
            else { await buildSdk(); }
            return;
        }

        // Qt local → delegate to buildManager (VSCode task system)
        const buildManager = await import('../qt/build/buildManager');
        try {
            await buildManager.build();
        } catch (e) {
            vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
        }
    })
);
```

**Key rules:**
- **Qt commands** → `buildManager.build()` / `buildManager.run()` / `buildManager.clean()` / `buildManager.stop()` — these use `vscode.tasks.executeTask()` with problem matchers and terminal output
- **SDK commands** → `buildSdk()` / `rebuildSdk()` / `cleanSdk()` — exported functions from `sdkExtension.ts`, internally use `SdkBuilder` with `vscode.tasks.executeTask()`
- **CLI-only commands** (status, init, list, doctor) → call CLI handler functions directly, these don't need VSCode task system
- **Sync** → `executeSyncChangedFiles()` from `syncWatcher.ts` — VSCode-integrated sync with progress and error handling
- **No intermediate command IDs** — don't register `forja.sdk.build` just for internal routing; export functions directly

### 17. Check for Module-Active-But-No-Config Fallback

When a dual-state architecture exists (UI module state vs unified config), command handlers may fail when the UI module is active but the unified config hasn't been initialized yet.

**Scenario**: The status bar can switch to SDK module via `activateSdkModuleIfNoQtProject()`, but the user hasn't run `forja init` or `forja use target` yet. The `activeTarget` config is null, but the SDK module is active.

**Anti-pattern**:
```typescript
vscode.commands.registerCommand('forja.build', async () => {
    const target = getActiveTarget(workspace());  // Returns null!
    // Falls through to Qt buildManager — wrong!
    const buildManager = await import('../qt/build/buildManager');
    await buildManager.build();
});
```

**Fix**: Check the UI module state as a fallback:
```typescript
vscode.commands.registerCommand('forja.build', async (action?: string) => {
    let target = getActiveTarget(workspace());

    // Fallback: if no activeTarget but SDK module is active, synthesize from SDK state
    if (!target) {
        const { getActiveModule } = await import('../ui/statusBar');
        if (getActiveModule() === 'sdk') {
            const { loadSdkSettings } = await import('../core/settingsIO');
            const sdkSettings = loadSdkSettings(workspace());
            if (sdkSettings.pinnedProject) {
                target = {
                    kind: 'sdk',
                    project: sdkSettings.pinnedProject,
                    mode: sdkSettings.mode || 'debug',
                    arch: sdkSettings.arch || (process.platform === 'win32' ? 'x86' : 'x64'),
                    runAt: 'local',
                };
            }
        }
    }

    // Now route based on target...
});
```

**How to check**:
1. Find all command handlers that call `getActiveTarget()` or `requireActiveTarget()`
2. Check if there's a UI module state (statusBar, etc.) that can be active independently
3. If yes, add a fallback that synthesizes target from module state
4. Verify the fallback produces the same routing as if the config had been properly initialized

**Severity**: P1 — user sees wrong behavior (Qt build instead of SDK build) with no error message.

### 18. Check for Dead Exports Within Live Files

Dead code detection usually focuses on orphaned files, but dead *exports* within live files are equally wasteful.

**Anti-pattern**:
```typescript
// In activeTarget.ts — exported but never imported anywhere
export function activeTargetEquals(a: ActiveTargetSettings, b: ActiveTargetSettings): boolean {
    return a.kind === b.kind && a.project === b.project && ...;
}
```

**How to check**:
```bash
# For each exported function, check if it's imported anywhere
grep -rn "activeTargetEquals" src/
# If only found in its own definition → dead export
```

**Fix**: Delete the dead export and its unused imports.

**Severity**: P3 — code quality issue, no user impact but increases maintenance burden.

### 19. Check for Inline Logic That Should Be Shared Functions

When the same logic pattern appears in multiple places (e.g., both in a CLI command and a VSCode message handler), extract it to a shared function to prevent divergence.

**Anti-pattern**: 20 lines of inline logic in `messageHandler.ts` that duplicates logic in `projectManager.selectProject()`:
```typescript
// In messageHandler.ts — inline .pro parsing + state sync
const path = await import('path');
const { parseProFile } = await import('../../qt/project/projectManager');
const { ensureLocalStateDir } = await import('../../qt/shared/localState');
const proPath = path.default.isAbsolute(String(msg.value))
    ? String(msg.value)
    : path.default.join(workspace, String(msg.value));
try {
    const info = parseProFile(proPath);
    info.projectDir = path.default.dirname(proPath);
    setState('currentProject', info);
    ensureLocalStateDir(workspace);
} catch { /* parse failure */ }
```

**Fix**: Extract to a shared function in the module that owns the logic:
```typescript
// In projectManager.ts
export function applyManualProjectSelection(workspace: string, proPath: string): ProjectInfo | null {
    if (!proPath) { setState('currentProject', null); return null; }
    const absolutePath = path.isAbsolute(proPath) ? proPath : path.join(workspace, proPath);
    try {
        const info = parseProFile(absolutePath);
        info.projectDir = path.dirname(absolutePath);
        setState('currentProject', info);
        ensureLocalStateDir(workspace);
        return info;
    } catch { return null; }
}

// In messageHandler.ts — one-line call
const { applyManualProjectSelection } = await import('../../qt/project/projectManager');
applyManualProjectSelection(workspace, String(msg.value));
```

**How to check**:
1. Look for blocks of 10+ lines in message handlers that import and call multiple modules
2. Check if the same pattern exists elsewhere (e.g., in `selectProject()`)
3. If yes, extract to a shared function in the owning module

**Severity**: P2 — code duplication that may diverge over time.

### 20. Check for Multi-Line Output Truncation in VSCode Commands

When CLI commands produce multi-line text output (status reports, init results, doctor reports), VSCode command handlers must NOT use `showInformationMessage()` — it truncates multi-line text to a single toast notification.

**Anti-pattern**:
```typescript
vscode.commands.registerCommand('forja.status', async () => {
    const result = runStatus(workspace());
    const text = formatStatusText(result, locale);  // 20+ lines of text!
    vscode.window.showInformationMessage(text);      // ❌ Truncated to one line in toast
});
```

**Fix**: Use a dedicated OutputChannel for multi-line results:
```typescript
let _resultChannel: vscode.OutputChannel | null = null;

function showResultOutput(text: string): void {
    if (!_resultChannel) {
        _resultChannel = vscode.window.createOutputChannel('Forja Result');
    }
    _resultChannel.clear();
    _resultChannel.appendLine(text);
    _resultChannel.show(true);
}

vscode.commands.registerCommand('forja.status', async () => {
    const result = runStatus(workspace());
    const text = formatStatusText(result, locale);
    showResultOutput(text);  // ✅ Full output in Output panel
});
```

**How to check**:
```bash
# Find command handlers that format multi-line text and show it via toast
grep -n "showInformationMessage.*format\|showInformationMessage.*text\|showInformationMessage.*result" src/vscode/commands.ts
```

**Rule of thumb**: If the formatted text contains `\n` or is likely >2 lines, use OutputChannel instead of `showInformationMessage`.

**Severity**: P1 — user sees truncated/incomplete output, defeating the purpose of the command.

### 21. Check for Missing Guard Checks in Command Handlers

When a command only makes sense for certain target kinds or execution locations, the handler must validate before executing. Missing guards cause silent wrong behavior.

**Anti-pattern**:
```typescript
// forja.debug — no guard checks!
vscode.commands.registerCommand('forja.debug', async () => {
    const { startDebug } = await import('../qt/build/debugger');
    await startDebug();  // ❌ Runs even for SDK or remote targets
});
```

**Fix**: Add guard checks for target kind and execution location:
```typescript
vscode.commands.registerCommand('forja.debug', async () => {
    const target = getActiveTarget(workspace());
    if (target?.kind === 'sdk') {
        vscode.window.showWarningMessage('SDK target does not support debug.');
        return;
    }
    if (target?.runAt === 'remote') {
        vscode.window.showWarningMessage('Remote target does not support debug.');
        return;
    }
    const { startDebug } = await import('../qt/build/debugger');
    await startDebug();
});
```

**How to check**: For each command handler, ask:
1. Does this command make sense for ALL target kinds (qt, sdk)?
2. Does this command make sense for ALL execution locations (local, remote)?
3. If not, are there guard checks that reject inapplicable combinations?

**Commands that typically need guards**: `debug` (Qt local only), `stop` (not SDK), `run` (not SDK), `run --detach` (remote only).

**Severity**: P2 — wrong behavior with confusing error messages from underlying systems.

### 22. Check for Dead Imports in Command Files

Beyond dead exports (section 18), command files may accumulate unused imports after refactoring — especially when logic is extracted to helper modules.

**Anti-pattern**:
```typescript
vscode.commands.registerCommand('forja.showSyncTab', async () => {
    const { ConfigPageManager } = await import('../ui/configPanel/configPagePanel');  // ❌ Never used
    vscode.commands.executeCommand('forja.config.openPage', 'sync');
});
```

**How to check**:
```bash
# After extracting helpers to separate files, check for stale imports
npx tsc --noEmit 2>&1 | grep "unused"
# Also manually check dynamic imports in command handlers
grep -n "await import(" src/vscode/commands.ts | while read line; do
    # Verify each imported symbol is actually used in the handler body
done
```

**Severity**: P3 — code quality issue, no user impact.

### 23. Check for Path Resolution Consistency

When new command implementations replace old ones, they must use the same path resolution functions — especially for staged workspace mode where the action path differs from the configured remotePath.

**Anti-pattern**:
```typescript
// NEW: doctor restore/reset/clean-untracked — uses raw remotePath
const remotePath = resolved.config.remotePath;  // ❌ Wrong for staged mode!
const result = await executeRemoteRestore({ remotePath, ... });
```

**What goes wrong**: In staged workspace mode, the action path should be `remoteWorkspace` (or the primary repo path within it), not the sync `remotePath`. The old CLI uses `resolveRemoteActionPath()` which handles this correctly.

**Fix**: Use the same path resolution function as the old CLI:
```typescript
import { resolveRemoteActionPath } from '../../remote/core/config';
const remotePath = resolveRemoteActionPath(workspace, resolved.config.remotePath);  // ✅
```

**Key path resolution functions**:
- `resolveRemoteActionPath(workspace, remotePath)` — returns `remoteWorkspace` for staged mode, `remotePath` otherwise
- `resolveRemotePrimaryActionPath(workspace, remotePath)` — returns the primary repo path within staged workspace

**How to check**:
```bash
# Find all uses of remotePath in new command files
grep -rn "resolved\.config\.remotePath\|config\.remotePath" src/cli/commands/
# Verify each one uses the appropriate resolve function
# Compare with old CLI to see which function it uses for the same action
grep -rn "resolveRemoteActionPath\|resolveRemotePrimaryActionPath" src/remote/cli/
```

**Severity**: High — destructive operations (restore, reset, clean) may operate in the wrong directory.

### 24. Check for Argument Parsing Correctness

When collecting positional arguments from argv, the parser must skip not just flags but also their values. Otherwise, flag values get treated as positional arguments.

**Anti-pattern**:
```typescript
function collectPositionalPaths(argv: string[], startIdx: number): string[] {
    const paths: string[] = [];
    for (let i = startIdx; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { continue; }  // ❌ Skips flag but not its value!
        paths.push(argv[i]);
    }
    return paths;
}
// Input: ["repo", "file.cpp", "--workspace", "C:\\x", "--json"]
// Result: ["repo", "file.cpp", "C:\\x"]  ← "C:\\x" is a workspace path, not a restore path!
```

**Fix**: Track which flags consume values and skip the next token:
```typescript
function collectPositionalPaths(argv: string[], startIdx: number): string[] {
    const VALUE_FLAGS = new Set(['--workspace', '--server', '--config']);
    const paths: string[] = [];
    for (let i = startIdx; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            if (VALUE_FLAGS.has(argv[i]) && i + 1 < argv.length) { i++; }
            continue;
        }
        paths.push(argv[i]);
    }
    return paths;
}
```

**How to check**:
1. Find all functions that collect positional arguments from argv
2. Check if they skip flag values (not just flags)
3. Test with commands that have valued flags: `--workspace <path>`, `--server <id>`, etc.

**Severity**: Medium — can cause operations to target wrong files/paths.

### 25. Check for Fix-Mode Check Persistence

When a "fix" command resolves a blocked check, the initial blocked check should not be added to the results. Otherwise, `hasBlocked` stays true and the command returns `ok: false` even after successful fix.

**Anti-pattern**:
```typescript
// Initial check: remote-forja not configured → blocked
if (!remote.remoteForjaBin) {
    checks.push(check('remote-forja', 'blocked', '...'));  // ❌ Added before fix runs
    diagnostics.push(diag('doctor.remoteForjaMissing', 'error', '...'));
}

// Later: fix mode deploys remote forja → success
if (doctorAction === 'fix') {
    const result = await executeRemoteBootstrap(...);
    if (result.ok) {
        checks.push(check('remote-forja', 'ready', 'Deployed'));  // ✅ New ready check
    }
}

// Result: checks has BOTH blocked AND ready → hasBlocked = true → ok: false!
```

**Fix**: Skip the initial blocked check when in fix mode:
```typescript
if (!remote.remoteForjaBin) {
    if (doctorAction !== 'fix') {  // ✅ Only add blocked check when not fixing
        checks.push(check('remote-forja', 'blocked', '...'));
        diagnostics.push(diag('doctor.remoteForjaMissing', 'error', '...'));
    }
}
```

**How to check**:
1. Find "fix" command implementations that resolve blocked checks
2. Check if the initial blocked checks are conditionally skipped in fix mode
3. Verify the result's `ok` field reflects the post-fix state, not the pre-fix state

**Severity**: High — fix command reports failure even when fix succeeded.

### 26. Check for Package-Root vs CWD for Artifact Lookup

When looking up packaged artifacts (CLI bundles, bootstrap packages), use the module's location (`__dirname`) rather than `process.cwd()`. In installed CLI scenarios, cwd is the user's project directory, not the package root.

**Anti-pattern**:
```typescript
const artifact = findBootstrapArtifact();  // ❌ Defaults to process.cwd()
```

**Fix**:
```typescript
const artifactRoot = findPackageRoot(__dirname) || path.resolve(__dirname, '..', '..', '..');
const artifact = findBootstrapArtifact(artifactRoot);  // ✅ From module location
```

**How to check**:
```bash
# Find artifact lookup calls
grep -rn "findBootstrapArtifact\|findPackageRoot" src/cli/commands/
# Verify they use __dirname-based root, not cwd
```

**Severity**: Medium — bootstrap fails when CLI is invoked from a project workspace.

### 27. Check for CLI Override Passthrough to Resolution Functions

When a command accepts CLI flags that override configuration (e.g., `--server <id>` to temporarily use a different server), the override must be passed through to ALL resolution functions — not just used for a shallow existence check.

**Anti-pattern**:
```typescript
// CLI accepts --server override
const result = await runDoctor(workspace, {
    server: extractFlag(argv, '--server'),  // User provides --server myServer
});

// In runDoctor — uses options.server for existence check only
const server = serverId ? getServerById(serverId) : null;  // ✅ Checks correct server
checks.push(check('remote', 'ready', `Server: ${server.name}`));

// But then calls resolveRemoteConfig WITHOUT the override!
const resolved = resolveRemoteConfig(workspace);  // ❌ Uses sync.selectedServer, not options.server!
// Bootstrap targets the WRONG server!
```

**Fix**: Pass the override to all resolution functions:
```typescript
// In resolveRemoteConfig — accept optional override
export function resolveRemoteConfig(workspace: string, serverOverride?: string): ResolveRemoteConfigResult {
    const serverId = serverOverride || sync.selectedServer;  // ✅ Use override if provided
    // ...
}

// In runDoctor — pass override through
const resolved = resolveRemoteConfig(workspace, options.server);  // ✅
```

**How to check**:
1. Find all CLI flags that override configuration (e.g., `--server`, `--workspace`)
2. Trace where the override value is used
3. Find all resolution/config functions called in the same command
4. Verify each one accepts and uses the override parameter
5. Pay special attention to functions that read from settings files — they may ignore the override

**Severity**: High — user explicitly overrides a setting but the command silently uses the configured value instead.

### 28. Check for Backend Support Matrix in Command Routing

When a command routes to different backends (e.g., Qt vs SDK), verify that each backend actually supports the requested operation. Not all operations are available on all backends.

**Anti-pattern**:
```typescript
// forja.ps — routes based on activeTarget.kind
const target = getActiveTarget(ws);
const bridgeTarget = target?.kind ?? 'qt';  // SDK target → routes to 'sdk'
const result = await executeRemoteBridge({
    target: bridgeTarget,  // ❌ Remote CLI only supports 'qt' for ps!
    action: 'ps',
    // ...
});
```

**What goes wrong**: The remote CLI's support matrix only allows certain operations for certain targets:
- `ps` → Qt only
- `build/rebuild/clean` → Qt and SDK
- `restore/reset/clean-untracked` → Qt and SDK
- `run/stop` → Qt only

Routing to an unsupported backend causes the command to fail with a confusing error from the remote side.

**Fix**: Hardcode the target for operations that only support one backend:
```typescript
// forja.ps — Qt only, don't route based on activeTarget
const result = await executeRemoteBridge({
    target: 'qt',  // ✅ ps is Qt-only
    action: 'ps',
    // ...
});
```

**How to check**:
1. Find all commands that route to different backends based on `activeTarget.kind`
2. For each operation, check the remote CLI's support table (usually in the bridge or parser code)
3. Verify the routing doesn't send operations to unsupported backends
4. If an operation is backend-specific, hardcode the target rather than routing dynamically

**How to find the support matrix**:
```bash
# Check remote CLI parser for target validation
grep -n "ps\|target.*qt\|target.*sdk" src/remote/cli/index.ts
# Check bridge types for supported targets
grep -n "RemoteBridgeTarget" src/remote/core/bridge.ts
```

**Severity**: Medium — command fails with confusing error when SDK target is active.

### 29. Check for Dry-Run/Plan Flag Bypass in Execution Branches

When commands support a `--plan` or `--dry-run` flag, the plan check must happen BEFORE every execution branch — not just the local/primary one. Otherwise, remote or alternate-backend branches execute real operations despite `--plan`.

**Anti-pattern**:
```typescript
// build.ts — remote branch executes BEFORE plan check!
if (target.runAt === 'remote') {
    const result = await executeRemotePlan({ ... });  // ❌ Actually executes SSH build!
    return { ... };
}

// Plan check only applies to local path below
if (options.plan) {
    return { plan: { mode: 'dryRun', ... } };
}
```

**Fix**: Check `--plan` BEFORE every execution branch:
```typescript
// --plan: return dry-run info without executing (check BEFORE remote branch)
if (options.plan && target.runAt === 'remote') {
    return {
        ok: true,
        plan: { mode: 'dryRun', commands: [`ssh <server> "cd <remotePath> && forja build"`] },
    };
}

if (target.runAt === 'remote') {
    const result = await executeRemotePlan({ ... });  // ✅ Only reached when not --plan
    return { ... };
}
```

**How to check**:
1. Find all commands that accept `--plan` or `--dry-run`
2. For each execution branch (local, remote, SDK, etc.), verify the plan check happens first
3. Test with `forja build --plan` when `runAt: 'remote'` — should NOT establish SSH connection

**Severity**: High — dry-run silently executes real operations, violating user expectation of safety.

### 30. Check for Config Domain Isolation Between Independent Features

When two features (e.g., sync and remote execution) are documented as independent, they must use separate config domains. Sharing a config domain causes cross-feature overwrite.

**Anti-pattern**:
```typescript
// forja use remote — writes to SYNC config!
export function runUseRemote(workspace: string, args: UseRemoteArgs): UseResult {
    const sync = loadSyncSettings(workspace);  // ❌ Wrong domain!
    sync.selectedServer = resolved.server.id;
    saveSyncSettings(workspace, sync);
}
```

**What goes wrong**: User configures remote execution server via `forja use remote --server X`. Later, `forja use sync --server Y` overwrites the same `sync.selectedServer` field. Now remote execution targets the wrong server.

**Fix**: Use separate config domains:
```typescript
// RemoteSettings gets its own selectedServer and remotePaths
export interface RemoteSettings {
    // ... existing fields ...
    selectedServer: string;
    remotePaths: Record<string, string>;
}

// forja use remote — writes to REMOTE config
export function runUseRemote(workspace: string, args: UseRemoteArgs): UseResult {
    const remote = loadRemoteSettings(workspace);  // ✅ Correct domain
    remote.selectedServer = resolved.server.id;
    saveRemoteSettings(workspace, remote);
}

// Resolution reads from both, with priority
export function resolveRemoteConfig(workspace: string): ResolveRemoteConfigResult {
    const remote = loadRemoteSettings(workspace);
    const sync = loadSyncSettings(workspace);
    const serverId = remote.selectedServer || sync.selectedServer;  // ✅ Priority
    const remotePath = remote.remotePaths[serverId] || sync.remotePaths[serverId] || '';
}
```

**How to check**:
1. Find all `load*Settings()` / `save*Settings()` calls in command handlers
2. Verify each handler writes to the correct domain (not a shared one)
3. Check resolution functions for priority/fallback logic when reading from multiple domains

**Severity**: High — independent features silently overwrite each other's configuration.

### 31. Check for Required Flag Validation in Command Dispatch

When a command requires exactly one of several mutually exclusive flags, validate before defaulting. Silent defaults can unexpectedly change user state.

**Anti-pattern**:
```typescript
export function runUseExecution(workspace: string, local: boolean, remote: boolean): UseResult {
    const runAt = remote ? 'remote' : 'local';  // ❌ No flags → silently defaults to 'local'
    // Both --local --remote → silently picks 'remote'
}
```

**Fix**: Validate before proceeding:
```typescript
export function runUseExecution(workspace: string, local: boolean, remote: boolean): UseResult {
    if (local && remote) {
        return { ok: false, diagnostics: [{ message: 'Cannot specify both --local and --remote' }] };
    }
    if (!local && !remote) {
        return { ok: false, diagnostics: [{ message: 'Must specify --local or --remote' }] };
    }
    const runAt = remote ? 'remote' : 'local';
}
```

**How to check**:
1. Find all command handlers that accept boolean flags for mode selection
2. Check if they validate mutual exclusion and required presence
3. Test with no flags, both flags, and each flag individually

**Severity**: Medium-High — user accidentally changes active target without explicit intent.

### 32. Check for Unknown Positional Arguments Silently Ignored

When a command accepts positional arguments for sub-actions (e.g., `forja build fresh`, `forja run designer`), unknown positional args must error rather than fall through to the default action. Commands with side effects (build, run) should never silently execute the default when the user misspells a sub-action.

**Anti-pattern**:
```typescript
async function handleBuild(argv: string[]): Promise<void> {
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    let buildAction: BuildAction = 'default';
    if (subArg === 'fresh') { buildAction = 'fresh'; }
    else if (subArg === 'qmake') { buildAction = 'qmake'; }
    // else if (subArg === 'rcc') { ... }
    // ❌ Unknown subArg silently falls through to 'default' build!
    // `forja build qamke` (typo) → runs a full build!
}
```

**Fix**: Error on unknown positional args:
```typescript
if (subArg === 'fresh') { buildAction = 'fresh'; }
else if (subArg === 'qmake') { buildAction = 'qmake'; }
else if (subArg === 'rcc') { buildAction = 'rcc'; }
else if (subArg !== '') {
    console.log(JSON.stringify({
        ok: false,
        diagnostics: [{ message: `Unknown build action: ${subArg}. Valid: fresh, qmake, rcc` }],
    }));
    process.exitCode = 1;
    return;
}
```

**How to check**:
1. Find all command handlers that parse positional sub-actions
2. Check if there's a final `else` branch that errors on unknown values
3. Test with misspelled sub-actions: `forja build qamke`, `forja run desginer`

**Severity**: Medium — typo in sub-action causes unintended side effect (build, run).

### 33. Check for VSCode Resource Lifecycle Registration

VSCode resources like OutputChannel, DiagnosticCollection, FileSystemWatcher, and StatusBarItems must be registered in `context.subscriptions` for disposal. Module-global resources created lazily are especially prone to leaks.

**Anti-pattern**:
```typescript
let _resultChannel: vscode.OutputChannel | null = null;

function showResultOutput(text: string): void {
    if (!_resultChannel) {
        _resultChannel = vscode.window.createOutputChannel('Forja Result');
        // ❌ Not registered for disposal!
    }
    _resultChannel.appendLine(text);
}
```

**Fix**: Create and register in the activation function:
```typescript
export function registerCommands(context: vscode.ExtensionContext): void {
    const resultChannel = vscode.window.createOutputChannel('Forja Result');
    context.subscriptions.push(resultChannel);  // ✅ Registered for disposal

    // Use resultChannel directly in command handlers
    vscode.commands.registerCommand('forja.status', () => {
        resultChannel.clear();
        resultChannel.appendLine(text);
        resultChannel.show(true);
    });
}
```

**How to check**:
```bash
# Find createOutputChannel / createDiagnosticCollection / createStatusBarItem calls
grep -rn "createOutputChannel\|createDiagnosticCollection\|createStatusBarItem\|createFileSystemWatcher" src/vscode/
# Verify each one is pushed to context.subscriptions
```

**Severity**: Medium — resource leak across extension lifecycle reloads.

### 34. Check for Command Palette Visibility Tests

Tests that verify "only v2 commands" should check both command existence AND command palette visibility. A command that exists in `contributes.commands` but isn't hidden in `commandPalette` will appear in the command palette, leaking internal commands to users.

**Anti-pattern**:
```typescript
test('package contributes only v2 commands', () => {
    const commands = pkg.contributes.commands.map(c => c.command);
    assert.ok(commands.includes('forja.remoteWorkbench'));  // ✅ Exists
    // ❌ But doesn't check if it's hidden from command palette!
});
```

**Fix**: Also verify visibility:
```typescript
test('package contributes only v2 commands', () => {
    const commands = pkg.contributes.commands.map(c => c.command);
    assert.ok(commands.includes('forja.remoteWorkbench'));

    const palette = pkg.contributes.menus.commandPalette || [];
    const hiddenCommands = palette.filter(p => p.when === 'false').map(p => p.command);
    assert.ok(hiddenCommands.includes('forja.remoteWorkbench'));  // ✅ Hidden
});
```

**Severity**: Medium — internal commands visible in command palette confuse users.

## Key Principles

- **Execution path matters more than function calls**: Even if new code calls the right core functions, it may skip VSCode-specific integration that old handlers provided
- **Conditional routing is invisible**: Old handlers may branch on `runAt`, `executionLocation`, or feature flags. New unified handlers must replicate ALL branches, not just the primary one. This is the #1 source of silent feature loss.
- **Wrapper parameters are invisible**: When new code wraps core functions, hardcoded parameters (owner, ignore, context flags) may be wrong for different callers. Always make context-dependent values configurable.
- **Utility commands are easy to forget**: When consolidating many commands into fewer, standalone diagnostic/management utilities (test, bootstrap, ps, workbench) get silently dropped. List ALL old command IDs and categorize them.
- **State management is invisible**: `setState()` calls and task listeners are easy to overlook but critical for UI correctness
- **Dead code is confusing**: Old files that exist but are never called create maintenance burden and confuse future readers
- **Review in execution order**: Start from user action (click/keypress) → command registration → handler body → core function → output. Don't just check that core functions are called.
- **VSCode commands ≠ CLI commands**: VSCode command handlers must provide VSCode-native UX (task system, terminal, progress, quickpick). CLI handlers can use raw process execution. Don't mix them.
- **CLI-complete ≠ VSCode-complete**: Even if the CLI side correctly handles all cases (remote, local, different targets), the VSCode command layer is a separate registration point that must independently implement the same routing logic.
- **Compile and test after fixes**: Always verify with `npm run compile` and `npm test` after making fixes to catch type errors and regressions.
- **Fix ALL findings**: When review surfaces issues at any priority level (P0–P3), fix all of them — including "nice to have" items like dead code removal. Do not leave low-priority issues unfixed.
- **Path resolution must match old CLI**: New command implementations must use the same path resolution functions as the old CLI they replace — especially for staged workspace mode where action paths differ from configured paths.
- **Argument parsers must skip flag values**: When collecting positional arguments, skip not just flags but also their values. Otherwise `--workspace C:\x` causes `C:\x` to be treated as a positional argument.
- **Fix-mode must not report pre-fix state**: When a fix command resolves a blocked check, the initial blocked check should not appear in results. The `ok` field must reflect post-fix state.
- **Artifact lookup uses module location, not cwd**: Packaged CLI artifacts should be found relative to `__dirname`, not `process.cwd()`, because installed CLIs run from the user's project directory.
- **CLI overrides must flow through to resolution**: When a command accepts `--server <id>` or similar overrides, pass them to ALL resolution functions — not just the initial existence check. Otherwise the command silently uses the configured value.
- **Not all backends support all operations**: Before routing dynamically based on `activeTarget.kind`, verify the target backend actually supports the requested operation. If an operation is backend-specific (e.g., `ps` is Qt-only), hardcode the target.
- **Dry-run must be checked before every branch**: A `--plan` flag that only gates the local execution path is a bug — remote and SDK branches will still execute real operations. Check the flag BEFORE all execution branches.
- **Independent features need separate config domains**: When two features are documented as independent (e.g., sync and remote execution), they must write to separate config files. Sharing a config domain causes silent cross-feature overwrite.
- **Required flags must be validated**: Commands that accept mutually exclusive flags (`--local` / `--remote`) must error when neither or both are provided. Silent defaults can unexpectedly change user state.
- **Unknown sub-actions must error**: Commands with side effects (build, run) should never silently execute the default action when the user provides an unknown sub-action. Typos like `forja build qamke` should error, not trigger a full build.
- **VSCode resources must be disposed**: OutputChannel, DiagnosticCollection, and other VSCode resources must be registered in `context.subscriptions`. Module-global lazy-created resources are especially prone to leaks.
- **Tests must verify visibility, not just existence**: A command that exists in `contributes.commands` but isn't hidden in `commandPalette` will appear to users. Tests should verify both.
- **Numeric CLI parameters must be validated**: `parseInt()` on user input can produce `NaN`. Validate range (1-65535 for ports) and reject non-numeric values before saving to config.
- **Docs and skills synced after command surface changes**: After renaming/restructuring commands, update README.md, skills/*/SKILL.md, and skills/*/README.md to match the new command surface. Tests that assert on doc section headers must also be updated.
- **Config readers must use consistent resolution**: When multiple code paths (CLI commands, VSCode handlers, status summaries) need to resolve the same config (e.g., remote server), they must all call the same resolution function (`resolveRemoteConfig`). Otherwise, one path may read from `remoteSettings` while another reads from `syncSettings`, causing inconsistent behavior.
- **CLI package build scripts must include all modules**: When building standalone CLI packages, verify the build script includes all required directories. Missing modules (e.g., `qt/build/designer.js`) cause runtime `Cannot find module` errors in the published package.
- **Dependent flags must validate prerequisites**: When a flag depends on another flag being set first (e.g., `--remote-path` requires `--server`), validate the dependency exists before writing config. Otherwise the command silently succeeds without saving anything.

### 35. Check for Config Reader Consistency

When multiple code paths need to resolve the same configuration (e.g., remote server, remote path), they must all use the same resolution function. Otherwise, different paths may read from different config sources, causing inconsistent behavior.

**Anti-pattern**:
```typescript
// executeRemotePlan — reads from syncSettings
const serverId = syncSettings.selectedServer;  // ❌ Uses sync config
const remotePath = syncSettings.remotePaths[serverId];

// resolveRemoteConfig — reads from remoteSettings (after refactor)
const serverId = remoteSettings.selectedServer || syncSettings.selectedServer;  // ✅ Priority

// status summary — reads from syncSettings only
const server = sync.selectedServer ? getServerById(sync.selectedServer) : null;  // ❌ Ignores remote config
```

**What goes wrong**: User configures remote execution via `forja use remote --server X`. But `executeRemotePlan` and `status` still read from `syncSettings.selectedServer`, so they target the wrong server.

**Fix**: All readers must use the same resolution function:
```typescript
// All code paths use resolveRemoteConfig
const resolved = resolveRemoteConfig(workspace);
if (!resolved.config) { /* handle error */ }
const server = resolved.config.server;
const remotePath = resolved.config.remotePath;
```

**How to check**:
```bash
# Find all places that read server/path config
grep -rn "selectedServer\|remotePaths\[" src/cli/commands/ src/vscode/
# Verify each one uses resolveRemoteConfig or the same priority logic
```

**Severity**: High — different parts of the system target different servers/paths.

### 36. Check for CLI Package Module Completeness

When building standalone CLI packages, the build script must include all required modules. Missing modules cause runtime errors in the published package even though the VSCode extension works fine.

**Anti-pattern**:
```javascript
// scripts/build-cli.js — missing qt/build directory
const dirs = [
    'cli', 'cli/commands',
    'qt/cli', 'qt/shared', 'qt/env',
    // ❌ Missing 'qt/build' — designer.js lives here!
];
```

**What goes wrong**: VSCode extension works because it has access to all source files. But the standalone CLI package fails with `Cannot find module '../../qt/build/designer'` when user runs `forja run designer app.ui`.

**Fix**: Include all directories that CLI commands import from:
```javascript
const dirs = [
    'cli', 'cli/commands',
    'qt/cli', 'qt/shared', 'qt/env',
    'qt/build',  // ✅ Include designer.js
    // ...
];
```

**How to check**:
```bash
# Find all imports in CLI command files
grep -rn "from '\.\./\.\./" src/cli/commands/ | grep -v "core\|types"
# Verify each imported directory is in the build script's dirs list
```

**Severity**: High — published CLI package is broken for affected commands.

### 37. Check for Dependent Flag Validation

When a flag's effect depends on another flag being set, validate the dependency before writing config. Otherwise the command silently succeeds without saving anything.

**Anti-pattern**:
```typescript
export function runUseRemote(workspace: string, args: UseRemoteArgs): UseResult {
    if (args.server) {
        remote.selectedServer = resolved.server.id;
        changed.push('remote.selectedServer');
    }
    if (args.remotePath && remote.selectedServer) {
        remote.remotePaths[remote.selectedServer] = args.remotePath;
        changed.push('remote.remotePath');
    }
    // ❌ If no --server but --remote-path provided, silently succeeds with changed: []
}
```

**What goes wrong**: User runs `forja use remote --remote-path /x` without `--server`. The command returns `ok: true` but nothing is saved because `remote.selectedServer` is empty.

**Fix**: Validate the dependency:
```typescript
if (args.remotePath && !remote.selectedServer && !args.server) {
    return {
        ok: false,
        diagnostics: [{ message: 'No server configured. Use --server <id> first.' }],
        nextActions: ['forja use remote --server <id> --remote-path <path>'],
    };
}
```

**How to check**:
1. Find all command handlers that accept multiple related flags
2. Check if any flag's effect depends on another flag being set
3. Verify the dependency is validated before writing config

**Severity**: Medium — command appears to succeed but doesn't save the intended config.

### 19. Iterative Multi-Round Review Methodology

For large refactorings with many files changed, use an iterative multi-round approach where each round focuses on different aspects and ALL issues are fixed before moving to the next round.

**Round structure**:
1. **Round 1**: Architecture + functionality coverage (broad scan)
2. **Round 2-3**: Deep dive into specific layers (CLI, VSCode, remote, etc.)
3. **Round 4+**: Edge cases, parameter validation, documentation sync
4. **Final round**: Full regression test + documentation review

**Key rules**:
- Fix ALL issues found in each round before starting the next
- Each round should verify compilation and tests pass
- Track cumulative fixes across all rounds
- Don't declare "ready to merge" until all rounds are complete

**Why iterative**: Early rounds catch structural issues. Later rounds catch subtle issues that only become visible after the structural issues are fixed. For example:
- Round 1: "Command X is missing" → implement it
- Round 2: "Command X's parameters don't match spec" → fix parameter names
- Round 3: "Command X's nextActions reference old commands" → add mapping

**How to track**:
```markdown
## Round N Review
### Findings
| Priority | Issue | Fix |
|----------|-------|-----|
| High | ... | ... |

### Verification
- [ ] TypeScript compiles
- [ ] Tests pass (X/Y)
```

### 20. Parameter Name Consistency with Design Spec

When implementing commands, parameter names must match the design specification exactly. Mismatches cause commands to silently fail or require different syntax than documented.

**Anti-pattern**:
```typescript
// Design spec says: --local, --remote
// Implementation uses: --local-name, --remote-name
const result = runUseRemoteRepo(workspace, {
    localName: extractFlag(argv, '--local-name'),  // ❌ Wrong name
    remoteName: extractFlag(argv, '--remote-name'), // ❌ Wrong name
});
```

**What goes wrong**: Users following the documentation use `--local` but the command expects `--local-name`. The command returns "missing args" error even though the user provided the correct flags.

**Fix**: Match parameter names exactly to spec:
```typescript
const result = runUseRemoteRepo(workspace, {
    localName: extractFlag(argv, '--local'),   // ✅ Matches spec
    remoteName: extractFlag(argv, '--remote'), // ✅ Matches spec
});
```

**How to check**:
1. Read the design spec document for each command
2. List all parameter names from the spec
3. Verify implementation extracts flags with those exact names
4. Pay special attention to:
   - Short vs long names (`--local` vs `--local-name`)
   - Hyphenated vs camelCase (`--deploy-server` vs `--deployServer`)
   - Spec says `--server` but implementation uses `--deploy-server`

**Severity**: High — documented commands don't work as specified.

### 21. nextActions Mapping from Old to New Commands

When old code returns `nextActions` with old command names, they must be mapped to new command names before being returned to users.

**Anti-pattern**:
```typescript
// Old qtCore.ts returns: ['forja qt status --json']
// New build.ts passes it through unchanged:
return {
    ok: false,
    nextActions: planned.nextActions,  // ❌ Still says "forja qt status"
};
```

**What goes wrong**: Users see error messages suggesting old commands that no longer exist. They try `forja qt status` and get "unknown command" error.

**Fix**: Map old command names to new ones:
```typescript
function mapNextActions(actions: string[]): string[] {
    return actions.map(a => {
        if (a.startsWith('forja qt ')) {
            const rest = a.slice('forja qt '.length);
            if (rest.startsWith('status')) return 'forja status --json';
            if (rest.startsWith('build')) return 'forja build --json';
            if (rest.startsWith('env')) return 'forja list env --json';
            // ... etc
        }
        return a;
    });
}

return {
    ok: false,
    nextActions: mapNextActions(planned.nextActions),  // ✅ Mapped
};
```

**How to check**:
1. Find all places where `nextActions` are passed through from old code
2. Check if any old code returns `nextActions` with old command names
3. Add mapping function if needed
4. Verify mapped commands actually exist in the new command surface

**Severity**: Medium — error messages suggest non-existent commands.

### 22. Unified Config Resolution Across All Callers

When multiple callers need to resolve the same configuration (e.g., remote server), they should all use the same resolver function, not each read from different sources.

**Anti-pattern**:
```typescript
// status.ts reads from sync config
const server = syncConfig.selectedServer ? getServerById(syncConfig.selectedServer) : null;

// doctor.ts reads from sync config with override
const serverId = options.server || sync.selectedServer;

// plan.ts reads from sync config
const serverId = syncSettings.selectedServer;

// But use remote writes to remote config!
remote.selectedServer = resolved.server.id;
```

**What goes wrong**: User configures remote execution with `forja use remote --server A`, but status/doctor/plan still read from sync config and show server B (or no server).

**Fix**: All callers should use the same resolver that checks both sources:
```typescript
// remote/core/config.ts — unified resolver
export function resolveRemoteConfig(workspace: string, serverOverride?: string): ResolveRemoteConfigResult {
    const remote = loadRemoteSettings(workspace);
    const sync = loadSyncSettings(workspace);
    // Prefer remote, fallback to sync for backward compatibility
    const serverId = serverOverride || remote.selectedServer || sync.selectedServer;
    // ...
}

// All callers use the same resolver
const resolved = resolveRemoteConfig(workspace);
```

**How to check**:
1. Find all places that read config for the same purpose (e.g., remote server)
2. Check if they all use the same source
3. If not, create a unified resolver function
4. Update all callers to use the unified resolver

**Severity**: High — configuration appears to be ignored or inconsistent.

### 23. Silent Success on Missing Implementation

When a subcommand or action is not implemented, it should return an error, not silently succeed with `ok: true, changed: []`.

**Anti-pattern**:
```typescript
// No 'workspace' branch in the switch
case 'remote': {
    if (remoteSubCmd === 'repo') { ... }
    if (remoteSubCmd === 'forja-bin') { ... }
    // workspace falls through to default:
    const result = runUseRemote(workspace, { ... });  // ❌ Wrong handler
    return result;  // Returns ok: true but didn't do what user asked
}
```

**What goes wrong**: User runs `forja use remote workspace set --mode staged` and gets `ok: true` but nothing is saved. The command silently did the wrong thing.

**Fix**: Explicitly handle or reject unimplemented subcommands:
```typescript
case 'remote': {
    if (remoteSubCmd === 'workspace') {
        // Either implement it:
        const result = runUseRemoteWorkspace(workspace, { ... });
        return result;
        // Or reject it:
        // return { ok: false, diagnostics: [{ message: 'workspace not yet implemented' }] };
    }
    if (remoteSubCmd === 'repo') { ... }
    // ...
}
```

**How to check**:
1. List all subcommands documented for each command
2. Verify each subcommand has an explicit handler
3. Check that unhandled subcommands return errors, not silent success
4. Pay special attention to "default" or "fallthrough" cases

**Severity**: High — command appears to work but doesn't save intended config.

### 24. Input Validation for Domain-Specific Values

When accepting values that have domain-specific constraints (e.g., repo names, port numbers, action names), validate them before saving.

**Examples**:
- **Repo names**: Must not contain path separators, `..`, or start with `.`
- **Port numbers**: Must be integers between 1 and 65535
- **Build actions**: Must be valid for the target type (qt: build/clean/qmake, sdk: build/rebuild/clean)
- **Transfer artifacts**: Must have at least one artifact specified

**Anti-pattern**:
```typescript
// No validation — accepts "../danger" as repo name
const repo: RemoteRepoSettings = {
    localName: args.localName,  // Could be "../danger"!
    remoteName: args.remoteName,
    role: args.role,
};
```

**Fix**: Validate before saving:
```typescript
const REPO_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

function isValidRepoName(name: string): boolean {
    return REPO_NAME_PATTERN.test(name) && name !== '..' && !name.includes('/');
}

if (!isValidRepoName(args.localName)) {
    return {
        ok: false,
        diagnostics: [{ message: `Invalid repo name: ${args.localName}` }],
    };
}
```

**How to check**:
1. Find all places that accept user input for domain-specific values
2. Check if validation exists for each value type
3. Add validation for:
   - Names that will be used in file paths
   - Numbers that will be used in network calls
   - Enum values that must match a known set
   - Arrays that must be non-empty

**Severity**: Medium to High — invalid values can cause security issues or silent failures.

### 25. Documentation Sync with Implementation

When implementation changes, all related documentation must be updated:
- CLI help text
- README files
- Skill files (SKILL.md)
- Design spec documents
- HTML documentation (if bilingual)

**Anti-pattern**:
```markdown
<!-- README says -->
forja use sdk --vs-install "C:/Program Files/..."

<!-- But implementation expects -->
forja use sdk --vs-dev-cmd "C:/Program Files/..."
```

**What goes wrong**: Users copy commands from documentation and get errors. AI agents following skill files use wrong parameters.

**How to check**:
1. After changing parameter names or command syntax, search all documentation files
2. Update all occurrences to match new syntax
3. Verify examples in documentation actually work
4. Pay special attention to:
   - README files that ship with the package
   - Skill files that guide AI agents
   - HTML documentation that users browse

**Severity**: High — documentation is the primary interface for users and AI agents.

### 26. Stale Command String References After Migration

After command surface consolidation, old command strings often remain scattered across modules in user-facing text that isn't caught by type checking.

**Where stale strings hide**:
1. **nextActions arrays** — suggestions returned to users/agents
2. **Error messages** — diagnostic text shown when commands fail
3. **Help text** — CLI `--help` output and usage examples
4. **Warning/diagnostic messages** — inline guidance text
5. **Test assertions** — test cases checking for specific command strings
6. **Translation layers** — `mapNextActions()` functions that convert old→new

**Anti-pattern**:
```typescript
// In qt/shared/qtCore.ts after migration
nextActions: ['forja qt status --json']  // ❌ Old command no longer exists

// In remote/core/status.ts
nextActions: ['forja remote bootstrap']  // ❌ Old command no longer exists

// In sync/cli.ts
nextActions: ['forja sync use --server <id>']  // ❌ Old command no longer exists
```

**What goes wrong**: Users and AI agents follow suggestions that fail with "unknown command". The feature appears to work but guidance is broken.

**How to check**:
```bash
# Search for old command prefixes across all modules
grep -rn "forja qt " src/ --include="*.ts" | grep -v "test"
grep -rn "forja sdk " src/ --include="*.ts" | grep -v "test"
grep -rn "forja remote " src/ --include="*.ts" | grep -v "test"
grep -rn "forja sync use" src/ --include="*.ts" | grep -v "test"

# Then check test files
grep -rn "forja qt " src/test/ --include="*.ts"
grep -rn "forja sdk " src/test/ --include="*.ts"
```

**Translation layer consistency**: When multiple files have `mapNextActions()` functions that convert old→new commands, they must all use the same mapping logic. Check:
```bash
# Find all translation functions
grep -rn "mapNextActions" src/cli/commands/
# Verify each handles the same cases (toolchain flags → use qt, project flags → use target)
```

**Fix pattern**: Systematic replacement across all modules:
1. Define the mapping rules (old → new)
2. Launch parallel agents to scan each module (qt/, sdk/, remote/, sync/)
3. Replace all occurrences in source files
4. Update test assertions to match new commands
5. Verify with grep that no stale references remain

**Severity**: High — breaks user/agent guidance, makes features appear broken even when they work.

### 27. Lock Leak in Async/Finally When Return Bypasses try Block

When a function acquires a resource (lock, connection, file handle) and uses `try/finally` to ensure release, a `return` statement placed **before** the `try` block will bypass the `finally` cleanup, leaking the resource.

**Anti-pattern**:
```typescript
async function executePreparedAction(options) {
    // Step 1: Acquire lock (inside prepareRemoteWorkspace)
    const prepared = await prepareRemoteWorkspace({ releaseAfterPrepare: false });
    if (!prepared.ok) { return prepared; }  // Lock released inside prepare — OK

    // Step 2: Readiness check — BEFORE try block
    if (stagedMode) {
        const readinessFailure = await runTargetReadiness(...);
        if (readinessFailure && !isRecoverable(readinessFailure)) {
            return readinessFailure;  // ❌ Lock acquired but NEVER released!
        }
    }

    // Step 3: Action execution with lock release in finally
    try {
        // ... execute actions ...
    } finally {
        await releaseLock(prepared.lock.lockId);  // Only reached if Step 2 didn't return
    }
}
```

**What goes wrong**: The readiness check in Step 2 returns early, bypassing the `try/finally` in Step 3. The lock acquired by `prepareRemoteWorkspace` is never released. All subsequent remote operations are blocked by the stale lock.

**Correct pattern**: Move the readiness check **inside** the `try` block:
```typescript
async function executePreparedAction(options) {
    const prepared = await prepareRemoteWorkspace({ releaseAfterPrepare: false });
    if (!prepared.ok) { return prepared; }

    try {
        // Readiness check INSIDE try — finally will always release lock
        if (stagedMode) {
            const readinessFailure = await runTargetReadiness(...);
            if (readinessFailure && !isRecoverable(readinessFailure)) {
                // Merge readiness failure into base result
                base.ok = false;
                base.failedStage = 'targetReadiness';
                return base;  // ✅ finally will release lock
            }
        }
        // ... execute actions ...
    } finally {
        await releaseLock(prepared.lock.lockId);  // ✅ Always reached
    }
}
```

**How to check**:
```bash
# Find functions with try/finally that release resources
grep -rn "finally" src/remote/core/pipeline.ts
# Check if any return statements exist between resource acquisition and try block
# Look for the pattern: acquire → check → return → try → finally(release)
```

**Rule of thumb**: When a function acquires a resource and delegates release to `finally`, ALL code paths between acquisition and the `try` block must be moved inside the `try`, or must have their own explicit release before returning.

**Severity**: Critical — causes stale locks that block all subsequent operations.

### 28. Cross-Platform Conditional Toolchain Detection

When a project supports multiple platforms (Windows/POSIX), toolchain requirements differ per platform. Status/diagnostic functions must use platform-conditional logic, not assume a single toolchain is always required.

**Anti-pattern**:
```typescript
function buildToolchainSummary(workspace, target) {
    if (target.kind === 'sdk') {
        const sdk = loadSdkSettings(workspace);
        if (sdk.vsInstall) { summary.vs = { path: sdk.vsInstall }; }
        // ❌ On POSIX, SDK uses make — VS is irrelevant
    }
}

function assessToolchainReadiness(summary, target) {
    // SDK
    if (!summary.vs?.path) { return 'missing'; }  // ❌ Always requires VS
    if (process.platform !== 'win32' && !summary.make) { return 'missing'; }
    // ❌ summary.make is never set for SDK → always fails on POSIX
}
```

**What goes wrong**: On Linux/macOS, SDK Makefile projects are always reported as "missing VS" even though they don't need VS. Additionally, `summary.make` is never populated for SDK, so the make check always fails.

**Correct pattern**:
```typescript
function buildToolchainSummary(workspace, target) {
    if (target.kind === 'sdk') {
        if (process.platform === 'win32') {
            if (sdk.vsInstall) { summary.vs = { path: sdk.vsInstall }; }
        } else {
            summary.make = true;  // POSIX SDK uses make
        }
    }
}

function assessToolchainReadiness(summary, target) {
    if (target.kind === 'sdk') {
        if (process.platform === 'win32') {
            if (!summary.vs?.path) { return 'missing'; }
        } else {
            if (!summary.make) { return 'missing'; }
        }
    }
}
```

**How to check**:
```bash
# Find all toolchain readiness checks
grep -rn "summary.vs\|summary.make\|summary.qt" src/cli/commands/status.ts
# Verify each check is wrapped in platform-conditional logic
grep -B2 "summary.vs" src/cli/commands/status.ts | grep "platform"
```

**Rule**: For every toolchain requirement, ask "is this required on all platforms?" If not, wrap in `process.platform === 'win32'` / `!== 'win32'` checks. Also verify that `buildToolchainSummary` populates every field that `assessToolchainReadiness` reads.

**Severity**: High — entire platform's projects are reported as broken.

### 29. Silent Action Degradation in Else Branches

When a command supports multiple sub-actions (build, fresh, qmake, rcc) and routes to different backends (local, remote), unmapped action+backend combinations may silently degrade to a default action instead of reporting an error.

**Anti-pattern**:
```typescript
// Remote dispatch
if (target.runAt === 'remote') {
    const remoteAction = buildAction === 'fresh' ? 'rebuild'
        : buildAction === 'qmake' ? 'qmake'
        : 'build';  // ❌ rcc silently becomes build!
    await executeRemotePlan({ action: remoteAction, ... });
}
```

**What goes wrong**: User runs `forja build rcc` on a remote target. The rcc action is silently mapped to `build` — the remote executes a full build instead of compiling resources. No error, no warning.

**Correct pattern**: Explicitly reject unsupported combinations:
```typescript
// Reject unsupported action+backend before routing
if (buildAction === 'rcc' && target.runAt === 'remote') {
    return {
        ok: false,
        diagnostics: [diag('build.rccNotSupportedRemote', 'error', 'RCC is not supported on remote targets')],
        nextActions: ['forja build rcc (local only)'],
    };
}

// Then route with confidence that all remaining actions are valid
if (target.runAt === 'remote') {
    const remoteAction = buildAction === 'fresh' ? 'rebuild'
        : buildAction === 'qmake' ? 'qmake'
        : 'build';
    await executeRemotePlan({ action: remoteAction, ... });
}
```

**How to check**:
1. Find all action-mapping ternary/switch chains
2. Identify the "else/default" branch — what actions fall through to it?
3. Verify each falling-through action is intentionally mapped to the default
4. If any action should NOT be mapped, add explicit rejection before the routing

```bash
# Find action mapping chains
grep -rn "=== 'fresh' ?\|=== 'qmake' ?" src/cli/commands/ src/vscode/
# Check what actions fall through to the default
```

**Severity**: Medium — user gets wrong behavior with no indication.

### 30. Restoring Lost Logic to Shared Modules During Consolidation

When consolidating duplicate logic from multiple entry points (CLI, VSCode, SDK) into a shared module, logic that exists in one entry point but not others must be extracted into the shared module — not silently dropped.

**Anti-pattern**:
```typescript
// OLD: sdk/cli/index.ts — has solution platform parsing
function resolveSolutionPlatform(projectPath, config, arch) {
    const platforms = readSolutionPlatforms(projectPath, config);
    // ... reads .sln file to find actual platform names ...
}
function buildCommand(options) {
    const platform = resolveSolutionPlatform(options.project, config, options.arch);
    commands.push(`msbuild /p:Platform=${platform}`);
}

// NEW: sdk/shared/plan.ts — consolidated but lost platform parsing
function buildCommand(options) {
    const platform = options.arch === 'x64' ? 'x64' : 'Win32';  // ❌ Hardcoded!
    commands.push(`msbuild /p:Platform=${platform}`);
}
```

**What goes wrong**: `.sln` files that declare `x86` instead of `Win32` fail to build because the shared plan hardcodes the platform mapping. The old CLI path handled this correctly but the logic wasn't carried over.

**Correct pattern**: Extract the full logic into the shared module:
```typescript
// NEW: sdk/shared/plan.ts — full logic restored
function readSolutionPlatforms(projectPath, configuration) {
    const content = fs.readFileSync(projectPath, 'utf-8');
    // Parse GlobalSection(SolutionConfigurationPlatforms) ...
}

function resolveSolutionPlatform(projectPath, configuration, arch) {
    const platforms = readSolutionPlatforms(projectPath, configuration);
    if (platforms.length === 0) { return arch === 'x64' ? 'x64' : 'Win32'; }
    const preferred = arch === 'x64' ? ['x64'] : ['x86', 'Win32'];
    for (const candidate of preferred) {
        const found = platforms.find(p => p.toLowerCase() === candidate.toLowerCase());
        if (found) { return found; }
    }
    return fallback;
}
```

**How to check**:
1. Identify all entry points being consolidated (CLI, VSCode, SDK builder)
2. For each, list the non-trivial helper functions they call
3. Compare helper function lists — which entry point has the most logic?
4. Verify ALL unique logic from ALL entry points is in the shared module

```bash
# Compare helper functions across entry points
grep -n "^function " src/sdk/cli/index.ts
grep -n "^function " src/sdk/shared/plan.ts
grep -n "^function " src/sdk/modules/sdkBuilder.ts
```

**Rule**: The shared module must be a **superset** of all entry points' logic, not just a copy of the simplest one. When in doubt, copy more logic rather than less.

**Severity**: Medium-High — subtle build failures for edge-case configurations.

### 18. VSCode Command Guard Ordering

When a VSCode command handler has multiple conditional branches (SDK check, remote dispatch, local execution), the **order of guards matters**. Restriction checks must come BEFORE dispatch branches.

**Anti-pattern** — restriction check AFTER remote dispatch:
```typescript
vscode.commands.registerCommand('forja.run', async () => {
    const target = getActiveTarget(workspace());

    // Remote dispatch — SDK guard hasn't run yet!
    if (target?.runAt === 'remote') {
        startForegroundRemoteRun(context, workspace());  // ❌ Runs Qt remote even for SDK target
        return;
    }

    // SDK check — too late, remote already dispatched
    if (target?.kind === 'sdk') {
        vscode.window.showWarningMessage('SDK does not support run');
        return;
    }
    // ... local Qt run
});
```

**What goes wrong**: An SDK target with `runAt: 'remote'` bypasses the SDK restriction check and executes a remote Qt run instead of being rejected. The CLI side correctly rejects SDK targets, creating CLI/VSCode behavior inconsistency.

**Correct pattern** — restriction checks BEFORE dispatch:
```typescript
vscode.commands.registerCommand('forja.run', async () => {
    const target = getActiveTarget(workspace());

    // SDK check FIRST — applies to all execution locations
    if (target?.kind === 'sdk') {
        vscode.window.showWarningMessage('SDK does not support run');
        return;
    }

    // Remote dispatch — SDK already filtered out
    if (target?.runAt === 'remote') {
        startForegroundRemoteRun(context, workspace());  // ✅ Only Qt reaches here
        return;
    }
    // ... local Qt run
});
```

**How to check**:
1. Find all VSCode command handlers with multiple conditional branches
2. List the branches: SDK check, remote dispatch, local execution, action-specific handling
3. Verify the order: **restrictions → dispatch → execution**
4. Test mentally: what happens with each combination of (kind: qt|sdk) × (runAt: local|remote)?

**Rule**: Guards that reject execution (SDK doesn't support X, action not supported on remote) must come before dispatch branches that route execution.

**Severity**: High — silent wrong behavior (runs Qt when SDK was selected).

### 19. Multi-Command Consistency Auditing

When a bug is found in one command's handling of a cross-cutting concern (platform detection, config resolution, path handling), the same bug likely exists in other commands. After fixing one, audit ALL related commands.

**Common cross-cutting concerns that must be consistent across commands**:

| Concern | Commands That Must Agree |
|---------|-------------------------|
| Platform-specific tool requirements | status, init, doctor, list env |
| Config resolution (which server/path to use) | status, doctor, build, run, clean, sync |
| Absolute vs relative path handling | status, doctor, build, run, clean |
| Error severity (error vs warning) | status, doctor |
| Next actions suggestions | status, doctor, build, run, clean |

**Example — platform-specific checks**:
```
Round 15: Fixed status.ts to check make on POSIX instead of VS
Round 17: Found init.ts still reports VS missing on POSIX → fix
Round 17: Found doctor.ts still checks VS on POSIX → fix
Round 18: Found list env doesn't show make on POSIX → fix
```

Four commands, same underlying concern, fixed across 4 rounds.

**How to audit**:
1. When fixing a cross-cutting bug in command A, grep for the same pattern in all other commands:
```bash
# If you fixed platform branching in status.ts:
grep -rn "process.platform" src/cli/commands/*.ts
# Check if init.ts, doctor.ts, list.ts have the same pattern
```

2. For config resolution bugs, check all commands that read the same config:
```bash
# If you fixed server resolution in plan.ts:
grep -rn "selectedServer\|remotePaths" src/cli/commands/*.ts src/remote/core/*.ts
```

3. For path handling bugs, check all commands that join workspace + project:
```bash
# If you fixed absolute path handling in doctor.ts:
grep -rn "path.join(workspace" src/cli/commands/*.ts
```

**Rule**: Never fix a cross-cutting concern in just one file. Always grep for the pattern across all files and fix all occurrences in the same commit.

**Severity**: Medium — inconsistent user experience, some commands work correctly while others give wrong results for the same input.
