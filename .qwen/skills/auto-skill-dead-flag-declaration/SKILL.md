---
name: dead-flag-declaration
description: CLI flags declared in known-flags sets but never read are dead code — they silently pass validation while providing no functionality
source: auto-skill
extracted_at: '2026-07-15T14:15:54.136Z'
---

# Dead Flag Declaration

When a flag is listed in a command's known-flags set (so it passes unknown-flag validation) but is never actually read or acted upon, it's a dead flag. Users can pass it without error, but nothing happens — this is worse than an unknown flag (which at least errors).

## The Bug Pattern

```typescript
// --yes is in the known-flags set, so it passes validation
const syncUnknown = findUnknownFlags(argv, new Set(['--yes', '--file']), new Set(['--file']));

// But --yes is never read anywhere in the handler
// User runs: forja sync --yes
// Nothing happens differently than: forja sync
```

Another variant — flag declared in type but not parsed from argv:

```typescript
// Type declares debug?: boolean
interface RunOptions { debug?: boolean; }

// But dispatcher doesn't include --debug in known flags
const runUnknown = findUnknownFlags(argv, new Set(['--detach', '--plan']), new Set());
// forja run --debug → "unknown flag" error
// The type supports it but the CLI can't receive it — dead interface
```

## Why This Is Worse Than Missing Flags

| Scenario | User experience |
|----------|----------------|
| Flag doesn't exist at all | "Unknown flag: --yes" → user knows it's not supported |
| Flag in known-set but never read | No error, silent no-op → user thinks it worked |
| Flag in type but not in CLI | "Unknown flag: --debug" → user confused because docs mention it |

## The Fix

### If the feature is planned but not implemented:
Remove the flag from known-flags until the feature is implemented. Add a TODO comment.

```typescript
// TODO: --yes will skip confirmation when interactive sync is implemented
const syncUnknown = findUnknownFlags(argv, new Set(['--file']), new Set(['--file']));
```

### If the feature was removed:
Remove the flag from both the known-flags set and the type definition.

### If the flag is parsed but not acted upon:
Either implement the action or remove the flag entirely.

## Rules

1. **Every flag in a known-flags set must be read by `extractFlag()` or `hasFlag()` somewhere in the command path** — if it's not read, remove it from the set
2. **Every flag in a command's type/interface must be parseable from CLI argv** — if the dispatcher doesn't parse it, the type is lying
3. **Planned flags should not be declared** — add them when the feature is implemented, not before
4. **Audit after feature removal** — when removing a feature, check that its flags are removed from known-flags sets

## Audit Checklist

- [ ] For each flag in every known-flags Set: is there a corresponding `extractFlag()` or `hasFlag()` call?
- [ ] For each optional field in command option types: can it be set via CLI flags?
- [ ] After removing a feature: were its flags removed from known-flags sets?
- [ ] Are there TODO comments about planned flags? → Remove the flag until it's implemented
