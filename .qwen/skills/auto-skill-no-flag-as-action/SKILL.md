---
name: no-flag-as-action
description: When a flag triggers an action rather than modifying a value, convert it to a positional subcommand — flags are for parameters, subcommands are for actions
source: auto-skill
extracted_at: '2026-07-05T09:56:12.319Z'
---

# No Flag-as-Action

When a flag's primary purpose is to **trigger an action** (not pass a parameter to another action), it should be a **positional subcommand** instead.

## Core Principle

- **Flags** (`--foo`): modify or parameterize the current action — `--mode debug`, `--detach`, `--json`
- **Subcommands** (`foo`): are themselves actions — `build fresh`, `doctor fix`, `sync reset`

If removing the flag would leave the command with nothing to do, it's an action → make it a subcommand.

## Anti-Pattern: Flag-as-Action

```bash
# WRONG: --reset is an action, not a parameter
forja sync --reset              # "reset" is what you DO, not how you modify sync

# WRONG: --server triggers a "set" action
forja remote --server X --remote-path Y   # --server/--remote-path trigger config write

# WRONG: --custom triggers "run a custom command" action
forja run --custom lint         # "custom" is what you DO, not a modifier
```

## Correct Pattern

```bash
# RIGHT: action is a subcommand
forja sync reset                # "reset" is clearly an action
forja remote set --server X --remote-path Y   # "set" is the action, flags are parameters
forja run custom lint           # "custom" is clearly an action, "lint" is its parameter
```

## How to Identify

Ask: **"Does this flag make sense as a modifier to the default action?"**

| Flag | Default Action | Is it a modifier? | Verdict |
|------|---------------|-------------------|---------|
| `--mode debug` | build | Yes — modifies how to build | Keep as flag |
| `--detach` | run | Yes — modifies how to run | Keep as flag |
| `--json` | any | Yes — modifies output format | Keep as flag |
| `--reset` | sync | No — IS the action | → subcommand |
| `--server X` | remote (show) | No — triggers write | → subcommand |
| `--custom lint` | run | No — IS a different action | → subcommand |
| `--debug` | run | No — IS a different action | → subcommand (or delete if unsupported) |

## Implementation Checklist

When converting flag-as-action to subcommand:

1. **Add to subcommand dispatch** — Add the new subcommand to the switch/if chain
2. **Remove from known flags set** — Remove from `knownFlags` so using the old flag form errors
3. **Update help text** — Move from flags section to subcommands section
4. **Update keyword suggestions** — If the old flag was in KEYWORD_SUGGESTIONS, update to new syntax
5. **Update nextAction references** — Grep for the old syntax in fix/nextAction fields across all files
6. **Update tests** — Fix assertions that use the old flag syntax

## Flag That Needs View/Add/Delete → Subcommand

When a flag only supports overwrite (set value), but the setting also needs **view**, **add**, and **delete** operations, convert it to a subcommand. A flag can only set — it can't express "show current", "append", or "remove".

```bash
# WRONG: can only overwrite, no way to view or incrementally modify
forja use target --suppress-warnings C4819,C5297   # overwrite only

# RIGHT: subcommand supports all operations
forja use target suppress-warnings              # view
forja use target suppress-warnings C4819,C5297  # replace
forja use target suppress-warnings --add C4819  # append
forja use target suppress-warnings --rm C4819   # remove
```

**Scope matters:** The subcommand should live under the same parent as the original flag to preserve scoping. `suppress-warnings` is per-target, so it stays under `use target`, not promoted to `use suppress-warnings` (which would be global).

## Real Examples from This Project

| Before | After | Files Changed |
|--------|-------|---------------|
| `remote --server X` | `remote set --server X` | index.ts, remote.ts, types.ts (help), KEYWORD_SUGGESTIONS |
| `sync --reset` | `sync reset` | index.ts, types.ts (help) |
| `run --custom <name>` | `run custom <name>` | index.ts, types.ts (help) |
| `run --debug` | deleted | index.ts, types.ts (help) — was CLI dead code |
| `use target --suppress-warnings <codes>` | `use target suppress-warnings [--add\|--rm] [codes]` | index.ts, use.ts, types.ts (help) |
