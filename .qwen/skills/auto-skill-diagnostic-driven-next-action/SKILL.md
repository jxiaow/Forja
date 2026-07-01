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

### 3. Derive nextAction inline — prioritize error/warning over info, never suggest build when errors exist

```typescript
// Don't use a separate function — inline at the end of runStatus/runCommand
const errorWarningFix = diagnostics.find(d => (d.level === 'error' || d.level === 'warning') && d.fix);
const infoFix = diagnostics.find(d => d.level === 'info' && d.fix);
const hasErrors = diagnostics.some(d => d.level === 'error');
result.nextAction = errorWarningFix?.fix || infoFix?.fix || (hasErrors ? undefined : 'forja build');
```

**Why inline, not a separate function:** The logic is 3 lines. A separate `deriveNextAction` function adds indirection for no benefit. More importantly, the priority logic (error/warning > info) must be explicit — a simple "first with fix wins" loop would let an `info` diagnostic's fix override an `error` diagnostic's fix if the info was pushed first.

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

## Fix field mapping examples

| Scenario | fix | hint (human) |
|----------|-----|---------------|
| No target, no config | `forja setup` | "Not initialized" |
| Target missing | `forja list targets` | "File may have been deleted" |
| Qt path invalid | `forja list env qt` | "Reconfigure with forja use" |
| VS missing | `forja list env vs` | "Install Visual Studio" |
| make missing | _(no fix — system dependency)_ | "Install build-essential or equivalent" |
| jom missing (optional) | `forja list env qt` | "Optional, recommended for faster builds" |
| Sync server deleted | `forja list servers` | "Server was deleted" |
| Remote not configured | `forja list servers` | "No server configured" |
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
