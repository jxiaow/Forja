---
name: command-surface-reduction
description: When a command has too many subcommands/flags, systematically analyze overlap, get user confirmation, and reduce to minimal surface
source: auto-skill
extracted_at: '2026-07-01T14:52:07.808Z'
---

# Command Surface Reduction

When a command accumulates too many subcommands and flags, systematically reduce it to the minimal useful surface by removing redundancy and low-frequency options.

## Signs a Command Needs Reduction

- **Too many subcommands**: 4+ subcommands where some overlap with other commands
- **Deep nesting**: 3+ levels of nesting (e.g., `forja use remote workspace`) — entity should be promoted to top-level
- **Flag explosion**: Flags that only apply to edge cases (e.g., `--file`, `--repo`, `--server` on a sync command)
- **Overlap with sibling commands**: e.g., `forja sync status` duplicates `forja status`
- **Conceptual mismatch**: Subcommands that don't belong (e.g., `transfer` under `sync`, `restore` under `doctor`)
- **Configuration sprawl**: A "selection" command (`use`) accumulating one-time setup commands (`use qt`, `use sdk`)
- **User says "too many"**: Direct feedback that the command surface is overwhelming

## Procedure

### 1. Inventory the current surface

List every subcommand and flag with:
- What it does (one line)
- Usage frequency (high/medium/low)
- Overlap with other commands (which command covers the same info?)

```
| Subcommand/flag | Function | Frequency | Overlap |
|---|---|---|---|
| sync status | Check sync readiness | Low | forja status covers 90% |
| sync --file | Sync specific file | Low | Auto-incremental sync already handles this |
```

### 2. Propose removals with alternatives

For each item to remove, specify what replaces it:

| Remove | Alternative |
|---|---|
| `sync status` subcommand | Merge unique info into `forja status` sync section |
| `sync reset` subcommand | Change to `--reset` flag |
| `sync transfer` subcommand | Remove from sync (conceptual mismatch) |
| `--file` flag | Auto-incremental sync covers this |

### 3. Get explicit user confirmation

Present the proposal as a table. Ask the user to confirm each item. Don't proceed until the user agrees on the full plan. Use `ask_user_question` when possible, or present the plan and wait for approval.

**Key**: The user may have different opinions on different items. Let them accept some and reject others.

### 4. Plan the implementation (plan mode)

Enter plan mode and explore:
- Which functions/types become dead after each removal
- Which callers need updating
- What info needs to be merged elsewhere (e.g., status fields)
- Which tests reference removed features
- Which docs need updating

### 5. Implement bottom-up

Work from the core module outward:

1. **Core module** (`sync/cli.ts`) — Remove dead functions/types, simplify function signatures
2. **Command layer** (`cli/commands/sync.ts`) — Remove dead action functions, simplify result types and formatters
3. **Dispatcher** (`cli/commands/index.ts`) — Remove subcommand routing, update flag handling
4. **VSCode integration** (`vscode/commands.ts`) — Remove from QuickPick lists, descMap, validCategories arrays
5. **Sibling commands** (`cli/commands/status.ts`) — Merge in any absorbed info
6. **Tests** — Remove/update tests that reference removed features
7. **Docs** — Update ALL doc files that reference the removed surface (see layer 8)

### 6. Verify at each layer

After each layer:
- `npx tsc --noEmit` — catch type errors immediately
- Search for remaining references to removed functions/types
- Run affected tests

### 7. Final verification

- Full `npm test` — confirm no regressions (pre-existing failures are OK)
- Grep for any remaining references to removed commands/flags
- Verify docs match implementation

### 8. Multi-doc sync (when removing a category/subcommand)

Removing a category requires updating ALL docs that enumerate categories. Typical files:

| File | What to update |
|---|---|
| `docs/operations/command-consolidation/v2/<cmd>.md` | Category table, syntax, Result interface |
| `docs/operations/command-consolidation/v2/index.md` | Category list, decision table, migration table |
| `docs/operations/command-consolidation/command-api.zh.md` | Category table, command surface table |
| `docs/cli-interface-spec.md` | Category table, TypeScript interface |
| `docs/README-cli.md` | Example commands |
| `docs/self-testing-guide.md` | Test commands, checklists |

**Always grep** for the removed name across all `docs/` to find every reference.

## Common Patterns

### Subcommand → Flag
Low-frequency standalone actions become flags:
```
Before: forja sync reset
After:  forja sync --reset
```

### Subcommand → Merge into sibling
When command A's subcommand overlaps with command B:
```
Before: forja sync status (shows username/port/authMode)
        forja status     (shows name/host only)
After:  forja status     (shows username/port/authMode — merged)
        (sync status removed)
```

### Conceptual mismatch → Remove
When a subcommand doesn't belong:
```
Before: forja sync transfer (deploy artifacts — not file sync)
After:  (removed from sync, core function preserved for future home)
```

### Deep nesting → Promote to top-level
When a command has 3+ levels of nesting (e.g., `forja use remote workspace`), promote the nested entity to its own top-level command. This flattens the hierarchy and groups all operations on that entity under one command.

```
Before: forja use remote                          (set server/path)
        forja use remote workspace --mode staged   (3 levels deep)
        forja use remote repo --local X --remote Y (3 levels deep)
        forja doctor restore <repo> <paths>        (conceptually remote, not diagnostic)

After:  forja remote                              (show config)
        forja remote --server X --remote-path Y   (set server/path)
        forja remote workspace --mode staged       (2 levels, not 3)
        forja remote repo --local X --remote Y     (2 levels, not 3)
        forja remote restore <repo> <paths>        (correct home)
```

**When to promote:**
- Entity has 5+ configuration sub-commands (workspace, repo, forja-bin, build-order, transfer)
- Entity has runtime operations (restore, reset) currently scattered in other commands
- Maximum nesting depth exceeds 2 levels

**Also move related operations from other commands** — e.g., `doctor restore/reset/clean-untracked` are remote repo operations, not diagnostics. Moving them to `remote` makes the command boundary cleaner.

### Configuration sprawl → Consolidate into setup
When a "selection" command (`use`) accumulates one-time configuration subcommands:
```
Before: forja use qt --qt-path <path>     (toolchain config, done once)
        forja use sdk --vs-dev-cmd <path>  (toolchain config, done once)

After:  forja setup --qt-path <path>       (setup absorbs toolchain config)
        forja setup --vs-dev-cmd <path>
```

**Rule**: `use`/`select` commands should only handle frequent choices (target, execution mode). One-time configuration belongs in `setup`.

### Low-frequency flag → Evaluate carefully
Don't remove flags just because "the default covers it". Check edge cases:

```
BAD reasoning: --file is low-frequency, forja sync already only syncs git changes
GOOD reasoning: --file is needed for:
  1. Forcing re-sync of already-synced files (no git change)
  2. Cleaning up remote orphans (local deleted but git doesn't track it)
  3. Syncing files outside git tracking
```

**Rule**: Before proposing to remove a flag, list concrete scenarios where the default behavior FAILS. If any scenario is realistic, keep the flag.

## Anti-patterns

- **Removing without alternatives**: Every removal must have a clear alternative or explanation
- **Removing without confirmation**: User must approve each removal — they may know about use cases you don't
- **Removing flags without checking edge cases**: "Default covers it" is not enough — list scenarios where default fails before proposing removal
- **Partial cleanup**: If you remove a subcommand, also remove its types, tests, docs, and translation keys
- **Keeping "just in case"**: If a feature is low-frequency AND has no realistic edge case, remove it. It can be re-added if needed
- **Updating HTML docs manually**: Only update the markdown spec; HTML variants are auto-generated

## Checklist

- [ ] Every subcommand/flag inventoried with frequency and overlap assessment
- [ ] User confirmed each removal individually
- [ ] Core module cleaned (dead functions, types, imports removed)
- [ ] Command layer cleaned (dead action functions, result types simplified)
- [ ] Dispatcher cleaned (subcommand routing, flag handling updated)
- [ ] VSCode integration cleaned (QuickPick, validCategories, descMap updated)
- [ ] Merged info added to absorbing command (if applicable)
- [ ] Tests updated (removed references to deleted features)
- [ ] All docs updated (grep removed name across docs/ to find every reference)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes (no new failures)
- [ ] No remaining references to removed commands/flags in source
