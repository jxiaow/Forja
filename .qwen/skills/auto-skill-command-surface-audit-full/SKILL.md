---
name: command-surface-audit-full
description: When changing one command, audit the entire command surface for consistency — flag-as-action, subcommand style, dead code, and cross-command overlap
source: auto-skill
extracted_at: '2026-07-05T07:09:49.923Z'
---

# Full Command Surface Audit

When you're already modifying one command (e.g., removing `setup`), audit ALL commands for consistency issues. Users notice when one command follows a pattern but others don't — fixing only the target command leaves the surface feeling "messy."

## When This Applies

- Removing or merging a command
- Adding a new command
- User says "the commands feel messy/inconsistent"
- You're about to change the dispatcher (index.ts)

## Audit Checklist

### 1. Flag-as-Action Pattern

Check every command: are any flags being used as actions instead of modifiers?

| Symptom | Example | Fix |
|---------|---------|-----|
| Flag presence triggers a write operation | `remote --server X` sets the server | Add explicit subcommand: `remote set --server X` |
| Flag name matches what would be a subcommand | `sync --reset` | Change to: `sync reset` |
| Flag selects a mode that has its own behavior | `run --custom <name>` | Change to: `run custom <name>` |

**Rule:** Actions are subcommands, flags are modifiers. If removing the flag changes the command's behavior (not just its parameters), it should be a subcommand.

### 2. No-Args Behavior

Every command should have a sensible no-args behavior:

| Pattern | Example |
|---------|---------|
| Show current config | `remote` → show remote binding |
| Show current config | `use` → show target/execution/lang |
| Default execution | `build` → incremental build |
| List items | `server` → list all servers (git remote pattern) |

**Anti-pattern:** Command with no args returns an error or shows help. This breaks the "no-args = default" consistency.

### 3. List vs Use Convention

- `list` enumerates multiple items: `list targets`, `list env`
- `use` selects/configures single values: `use target`, `use lang`
- Single-value items don't belong in `list`: `list lang` is wrong (lang is one value)

### 4. Dead Flags

Check for flags that always error or never succeed:

| Symptom | Example | Fix |
|---------|---------|-----|
| Flag always returns an error | `run --debug` (CLI-only, always says "use VSCode") | Delete the flag |
| Flag only works in one mode | `--json` flag on a command that never outputs JSON | Remove or implement |

### 5. Cross-Command Overlap

Map which commands touch the same config/state:

```
setup (local)  → sets activeTarget, qtPath, vsInstall, mode, arch
use target     → sets activeTarget, qtPath, vsInstall, mode, arch
```

If two commands write the same config, one should be removed. The remaining command should handle all scenarios (first-time config, switching, modifying).

### 6. Subcommand Style Consistency

All commands should use the same dispatch pattern:

```
command [subcommand] [flags]
```

Not a mix of:
- `command --flag` (flag-as-action)
- `command subcommand` (positional subcommand)
- `command positional-arg` (bare positional)

### 7. Stale References

After any command change, search the entire codebase for:
- `nextAction` strings pointing to removed commands
- `fix` fields in diagnostics pointing to removed commands
- Help text mentioning removed commands
- Translation keys for removed commands
- Test files testing removed commands
- VSCode command registrations for removed commands
- `package.json` contributes for removed commands

## Process

1. **Read the dispatcher** (index.ts) — understand all commands and their dispatch patterns
2. **Read each command file** — note flags, subcommands, no-args behavior
3. **Build the inconsistency table** — list every violation found
4. **Present to user** — show all issues, get confirmation on which to fix
5. **Fix all confirmed issues** in one pass — don't leave some for "later"
6. **Search for stale references** — grep for removed command names across all files
7. **Compile and verify** — `tsc --noEmit` must pass

## Key Principle

**Fix all consistency issues together.** If you fix `remote --server` → `remote set` but leave `run --custom` as a flag, the surface is partially improved but still inconsistent. Users notice the half-fix more than the no-fix.
