---
name: diagnostic-driven-next-action
description: CLI commands should derive nextAction from diagnostic fix fields — single actionable command, not an ambiguous array of options
source: auto-skill
extracted_at: '2026-06-30T01:44:18.870Z'
---

# Diagnostic-Driven Next Action

CLI command results should provide a single `nextAction: string` (not `nextActions: string[]`) derived from diagnostic `fix` fields. This eliminates ambiguity for AI consumers and simplifies the output contract.

## Why

The original `nextActions: string[]` had three problems:
1. **Ambiguous semantics** — mixed sequential workflows (`list → use`) with alternatives (`build | configure remote`) in the same array
2. **Unexecutable placeholders** — commands like `forja use target --project <path>` can't be executed by AI
3. **Redundancy with diagnostic hints** — both `nextActions` and diagnostic `hint` conveyed the same fix information

## Pattern

### 1. Add `fix` field to Diagnostic

```typescript
interface Diagnostic {
    level: DiagnosticLevel;
    message: string;
    hint?: string;    // human-readable explanation
    fix?: string;     // actionable command for AI/nextAction
    params?: Record<string, string>;
}
```

Note: `code` field was removed — diagnostics are identified by `level` + `message`, not by a code string.

### 2. Each diagnostic carries its own fix

```typescript
diagnostics.push({
    level: 'error',
    message: T('qtNotFound'),
    hint: T('qtReconfigure'),        // "Qt installation may have changed, reconfigure with forja use"
    fix: 'forja list env qt',         // directly executable scan command
});
```

### 3. Derive nextAction inline — check operational state first, then structural state, then diagnostic fixes

```typescript
// Priority 1: Operational state overrides diagnostics
if (result.runtime?.running) {
    result.nextAction = 'forja stop';
} else if (!activeTarget && readiness.toolchain === 'unknown') {
    // Priority 2: Structural state — workspace not initialized
    // No single nextAction; AI should ask user (local vs remote setup)
    result.nextAction = undefined;
} else {
    // Priority 3: Diagnostic fixes — first diagnostic with a fix field
    const firstFix = diagnostics.find(d => d.fix)?.fix;
    const hasErrors = diagnostics.some(d => d.level === 'error');
    result.nextAction = firstFix || (hasErrors ? undefined : 'forja build');
}
```

**Why operational state comes first:** A running process is the most important contextual fact. If a process is running, suggesting `forja build` (the default "all good" action) could fail or conflict. The running state must be checked BEFORE falling through to diagnostic-based derivation.

**Why structural state (uninitialized) comes before diagnostic fixes:** When the workspace is not initialized, the "targets found" info diagnostic has `fix: 'forja list targets'` which would win over the "not initialized" warning (which has no `fix`). But `list targets` is wrong guidance when nothing is configured — the user needs `setup` first. By checking the structural state (`!activeTarget && readiness.toolchain === 'unknown'`) before diagnostic fixes, we avoid this ordering bug.

**Why `nextAction = undefined` for uninitialized:** The user may want local setup (`forja setup`) or remote setup (`forja setup remote`). A single `nextAction` can't capture this choice. Setting it to `undefined` lets:
- **AI mode**: the AI sees `readiness.toolchain === 'unknown'` and asks the user which setup they want
- **Text mode**: the formatter detects the same condition and shows both options

**`choices` field for AI mode when nextAction is ambiguous:** When nextAction is undefined because the user must choose between multiple valid paths, include a `choices` array in the JSON output so the AI knows what to offer:

```typescript
interface StatusResult extends ForjaJsonResult {
    nextAction?: string;
    choices?: Array<{ label: string; command: string; description: string }>;
}

// When uninitialized:
result.nextAction = undefined;
result.choices = [
    { label: 'forja setup', command: 'forja setup', description: T('statusSetupLocal') },
    { label: 'forja setup remote', command: 'forja setup remote', description: T('statusSetupRemote') },
];
```

The AI agent sees `choices` and presents them to the user. Text mode uses the same condition to render both options inline.

**Diagnostic noise reduction — don't show non-actionable info when workspace is uninitialized:** When the workspace has no config at all, informational diagnostics like "found N targets" are noise — the user can't act on them until they run setup first. Gate such diagnostics behind a `hasAnyConfig` check:

```typescript
// BUG: shows target count even when nothing is configured
if (qtCount > 0 || sdkCount > 0) {
    diagnostics.push({ level: 'info', message: 'found N targets', fix: 'forja list targets' });
}

// CORRECT: only show when user can actually act on it
if (hasAnyConfig && (qtCount > 0 || sdkCount > 0)) {
    diagnostics.push({ level: 'info', message: 'found N targets', fix: 'forja list targets' });
}
```

**Text mode fallback for uninitialized:**
```typescript
if (result.nextAction) {
    lines.push(T('next'));
    lines.push(`  ${result.nextAction}`);
} else if (!result.activeTarget && result.readiness?.toolchain === 'unknown') {
    lines.push(T('next'));
    lines.push(`  forja setup          (${T('statusSetupLocal')})`);
    lines.push(`  forja setup remote   (${T('statusSetupRemote')})`);
}
```

**Why `hasErrors ? undefined : 'forja build'`:** When errors exist but none have a `fix` (e.g., system dependency missing), falling back to `'forja build'` misleads the user into running a command that will fail. Setting `nextAction` to `undefined` omits the "Next:" section entirely — the user sees the error and its hint, which is the correct guidance.

### 4. Result uses single nextAction

```typescript
interface StatusResult extends ForjaJsonResult {
    nextAction?: string;  // NOT nextActions: string[]
}
```

## Rules

- `fix` must be a **directly executable** command (no `<placeholder>` values)
- When the fix requires user input (like a path), use a scan/list command instead (`forja list env qt` not `forja use qt --qt-path <path>`)
- `hint` remains for human-readable context; `fix` is for machine execution
- nextAction selection prioritizes error/warning fixes over info — don't rely on push order
- When no diagnostic has a `fix`, fall back to the default "all good" action
- **Every diagnostic that represents an actionable problem SHOULD have a `fix`** — but only when a forja command can actually help. System dependency issues (missing make, missing build-essential) should NOT have `fix` because no forja command installs system packages. The `hint` field carries the actual guidance in those cases.
- **`fix` must point to the correct command for the specific problem** — don't reuse a generic fix across different diagnostics (e.g., remote path missing needs `forja list servers`, not `forja use sync`)
- **`fix` must actually solve the problem, not just diagnose it** — `forja doctor` re-checks but doesn't fix. If the real solution is a system action (install package, edit config file), don't set `fix` at all; let `hint` carry the guidance. A `fix` that just re-runs diagnostics is misleading — the user expects the suggested command to resolve the issue.
- **Early returns must set `nextAction` explicitly** — `deriveNextAction` only runs on the main path; early returns (workspace not found, config corrupted) bypass it and need their own `nextAction`
- **nextAction should be the natural next step, not push optional features** — after local setup succeeds, `forja build` (verify it works) is correct; `forja setup remote` (optional remote config) is wrong. The user chose to do local setup; don't redirect them to a different workflow they didn't ask for
- **`fix` must point to a command that can create missing prerequisites, not one that requires them** — when configuration is missing (server, sync, remote path), point to the setup command that interactively creates it (`forja setup remote`), not to a command that needs the configuration to already exist (`forja sync`, `forja server`). A `fix` that will fail again due to the same missing config is worse than useless — it erodes trust in the guidance system.

### Anti-pattern: Circular fix references

```typescript
// BUG: sync not configured, but fix points to sync (which will fail again)
if (!project.enabled) {
    return { ok: false, error: 'sync not configured', nextAction: 'forja sync' };
}

// BUG: server not found, but fix points to server list (can't create from there)
if (!server) {
    return { ok: false, error: 'server not found', nextAction: 'forja server' };
}

// CORRECT: point to setup command that can create the missing config
if (!project.enabled) {
    return { ok: false, error: 'sync not configured', nextAction: 'forja setup remote' };
}
```

**Why `forja setup remote` over `forja server add`:** Setup commands provide interactive guidance and handle the full configuration chain (server → sync → remote path → deployment). Management commands like `forja server add` require flags and don't configure dependent settings. When the user is missing infrastructure, they need the wizard, not the scalpel.

**Exception:** When the user is already IN the setup flow and made a syntax error (e.g., `forja server update` without an ID), pointing to the management command (`forja server`) is correct — they need to retry with correct syntax, not restart the whole setup.

## Fix field mapping examples

| Scenario | fix | hint (human) |
|----------|-----|---------------|
| Not initialized (no config) | _(no fix — AI asks user)_ | "Not initialized, no config found" |
| No target, config exists | `forja list targets` | "Found N targets, none selected" |
| Target file missing | `forja list targets` | "File may have been deleted" |
| Qt path invalid | `forja list env qt` | "Reconfigure with forja use" |
| VS missing | `forja list env vs` | "Install Visual Studio" |
| make missing | _(no fix — system dependency)_ | "Install build-essential or equivalent" |
| jom missing (optional) | `forja list env qt` | "Optional, recommended for faster builds" |
| Sync server deleted | `forja setup remote` | "Server was deleted, reconfigure remote" |
| Remote not configured | `forja setup remote` | "No server configured" |
| Sync not enabled (remote mode) | `forja setup remote` | "Sync not configured for remote builds" |
| Local mode, no sync | _(no diagnostic — local doesn't need sync)_ | _(no diagnostic shown)_ |
| All good | _(default: `forja build`)_ | _(no diagnostics)_ |

## nextActions Validity Audit

When adding or modifying nextActions, verify every entry:

1. **Must be a valid command** — all subcommands, categories, and flags must exist. E.g., `forja list remote-repos` is invalid if `remote-repos` was merged into `remote`.
2. **No explanatory text** — `forja build rcc (local only)` is invalid because `(local only)` is not part of the command. Use just `forja build rcc`.
3. **No stale placeholders** — use consistent placeholder names (e.g., `--username <name>` not `--username <user>` in some places).
4. **Dynamic values must be real** — when nextActions reference server names or IDs, use the actual values from context, not hardcoded placeholders.

## When to apply

- Any CLI command that produces diagnostics and suggests next steps
- When refactoring from `nextActions: string[]` to cleaner single-action output
- When AI agents need to consume CLI output and act on it
