---
name: cli-ux-quality
description: CLI commands must enforce required arguments, provide contextually complete nextActions, and avoid duplicate diagnostics
source: auto-skill
extracted_at: '2026-06-24T08:20:34.775Z'
---

# CLI UX Quality

Beyond correct parsing and output formatting, CLI commands must meet UX quality standards for argument validation, next actions, and diagnostic output.

## 1. Required arguments must error, not silently default

When a command requires a positional argument (like a category, subcommand, or ID), omitting it must produce an error — never silently fall back to a default.

**Anti-pattern:**
```typescript
// forja list (no category) → silently shows targets
const category = argv[1] || 'targets';  // user didn't ask for targets
```

**Correct:**
```typescript
// forja list (no category) → error with usage
if (!categoryArg) {
    outputResult({
        ok: false,
        diagnostics: [{ level: 'error',
            message: 'Category required. Usage: forja list <targets|servers|...>' }],
        nextActions: ['forja list targets', 'forja list servers', ...],
    }, wantsJson);
    process.exitCode = 1;
    return;
}
```

**Also applies to subcommands:** `forja server` (no subcommand) must show help — but `exitCode = 0` since displaying help is not an error. Only set `exitCode = 1` for actual failures (missing required args, invalid values, etc.).

## 2. nextActions must be contextually complete

`nextActions` should guide the user to the most useful next step **given the current state**, not just list a fixed set of commands.

### Conditional suggestions based on state

```typescript
// list servers: different next actions depending on whether servers exist
if (servers.length === 0) {
    nextActions.push('forja server add --name <name> ...');
} else {
    nextActions.push('forja use remote --server <id> --remote-path <path>');
    nextActions.push('forja use sync --server <id> --remote-path <path>');
}
```

### Include all relevant dimensions

When `status` shows readiness, nextActions should cover all dimensions (target, toolchain, remote, sync) — not just the first problem found. If everything is OK, still suggest remote configuration options if available.

### Never leave nextActions empty

Every error result must have at least one actionable suggestion. Empty `nextActions: []` is a bug.

### nextActions must match the current process state

When a command starts a process, nextActions should reflect whether the process is still running or already exited:

```typescript
// Process still running (detached/background) → show stop/status
nextActions: ['forja stop', 'forja status --process']

// Process already exited on its own → no point suggesting stop or status
nextActions: []  // or just ['forja run'] if re-run makes sense
```

Detection: `executed.runtimeExitCode !== undefined` means the process already exited. Don't suggest `forja stop` for a dead process — it's confusing.

## 3. List-level diagnostics must not duplicate per-item

When listing items (targets, servers, etc.), global conditions (like "Qt not configured") must appear **once** at the list level, not repeated for every item.

**Anti-pattern:**
```typescript
// In collectTargetCandidates — adds same warning to EVERY candidate
for (const pro of proFiles) {
    if (!qtConfig.qtPath) {
        diags.push({ message: 'Qt path not configured' });  // × N candidates
    }
}
```

**Correct:**
```typescript
// In listTargets — add global diagnostics once at list level
function listTargets(workspace) {
    const targets = collectTargetCandidates(workspace);  // no per-candidate toolchain diags
    const diagnostics = [];
    if (!qt.qtPath) {
        diagnostics.push({ message: 'Qt path not configured' });  // shown once
    }
    return { targets, diagnostics, ... };
}
```

The text formatter then displays list-level diagnostics separately from per-item details.

## 4. Cross-file reference consistency

When a command's syntax changes (e.g., `forja list` now requires a category), ALL references to the old syntax across the codebase must be updated — including `nextActions` arrays in other command files.

**Audit pattern:** After changing command syntax, grep for the old form:
```
grep -r "'forja list'" src/cli/commands/   # find all stale references
```

Files that commonly contain nextActions references to other commands:
- `status.ts` — `buildNextActions()`
- `doctor.ts` — check results and final `nextActions`
- `init.ts` — post-init suggestions
- `list.ts` — per-category suggestions
- `activeTarget.ts` — error messages

## 5. parseInt of user input must validate NaN and range

Every `parseInt()` of user-provided input must check for NaN and valid range. Missing validation lets `NaN` propagate into config, causing cryptic failures later.

**Pattern:**
```typescript
const portStr = extractFlag(argv, '--port');
let port: number | undefined;
if (portStr) {
    port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        outputResult({
            ok: false,
            diagnostics: [{ level: 'error', message: `${T('idx.invalidPort')}: ${portStr}. ${T('idx.invalidPortHint')}` }],
            nextActions: ['forja setup'],
        }, wantsJson);
        process.exitCode = 1;
        return;
    }
}
```

**Anti-pattern (bug found in review):**
```typescript
// extractFlag called twice — second call returns undefined → parseInt(undefined) = NaN
port: extractFlag(argv, '--port') ? parseInt(extractFlag(argv, '--port')!, 10) : undefined,
```

**Rule**: Extract once, validate, then use. Never call `extractFlag` twice for the same flag.

## Checklist

- [ ] Does every command with required positional args error when they're missing?
- [ ] Does `forja <command>` (no subcommand) show help with `ok: false`, not `ok: true`?
- [ ] Are nextActions conditional on current state (e.g., servers exist vs not)?
- [ ] Are there any empty `nextActions: []` arrays?
- [ ] Are global diagnostics shown once at list level, not repeated per-item?
- [ ] After syntax changes, have all cross-file nextActions references been updated?
- [ ] Does every `parseInt()` of user input validate NaN and range (1–65535 for ports)?
