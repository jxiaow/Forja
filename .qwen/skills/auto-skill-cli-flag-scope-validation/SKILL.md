---
name: cli-flag-scope-validation
description: CLI flags that are only valid for specific subcommands/categories must error when used outside their scope — not be silently ignored
source: auto-skill
extracted_at: '2026-07-02T02:25:36.451Z'
---

# CLI Flag Scope Validation

When a flag is only meaningful for a specific subcommand or category, using it outside that scope must produce an error — not be silently consumed and ignored.

## The Bug Pattern

A flag like `--detail` is extracted from argv at the top of the handler, before the subcommand dispatch. If only one subcommand uses it, the other subcommands silently consume and ignore it:

```typescript
// BUG: --detail is extracted for ALL categories, but only 'servers' uses it
const detailId = extractFlag(argv, '--detail');
// For `forja list targets --detail foo`, detailId = 'foo' but targets ignores it
const result = await runList(workspace, category, { detailId });
```

The user runs `forja list targets --detail foo` and gets normal target listing — no indication that `--detail` was meaningless here.

## The Fix

After extracting the flag and determining the subcommand/category, validate scope:

```typescript
const detailId = extractFlag(argv, '--detail');

// --detail is only valid for servers
if (detailId && category !== 'servers') {
    outputResult({
        ok: false,
        action: 'list',
        diagnostics: [{ level: 'error', message: T('idx.detailOnlyServers') }],
        nextAction: 'forja list servers --detail <id>',
    }, wantsJson);
    process.exitCode = 1;
    return;
}
```

## Distinct from Unknown Flag Validation

- **Unknown flag validation** (`cli-unknown-flag-validation`): catches typos like `--detial` — flags that don't exist at all
- **Flag scope validation** (this skill): catches known flags used in wrong context — `--detail` exists but only applies to `servers`

Both are needed. A flag can be in the known-flags set (passing unknown-flag validation) but still be invalid for the current subcommand.

## Rules

1. **Extract first, validate scope second** — extract the flag value, then check if the current subcommand/category actually uses it
2. **Error message must say where the flag IS valid** — don't just say "--detail not valid here"; say "--detail is only valid for servers" and point nextAction to the correct usage
3. **Add a translation key** for the scope error message (e.g., `idx.detailOnlyServers`)
4. **Check ALL extracted flags** — if a handler extracts multiple flags (e.g., `--detail`, `--force`, `--verbose`), each one needs scope validation if it's not universally applicable

## Audit Checklist

When reviewing a CLI handler that dispatches to subcommands:

- [ ] List all `extractFlag()` / `hasFlag()` calls
- [ ] For each flag, check: is it used by ALL subcommands or only some?
- [ ] For flags used by only some: is there a scope guard that errors for the others?
- [ ] Does the error message tell the user which subcommand DOES accept the flag?
