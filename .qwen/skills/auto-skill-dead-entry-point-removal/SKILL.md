---
name: dead-entry-point-removal
description: When a module has both a standalone CLI entry and is consumed by a main dispatcher, systematically remove the dead standalone entry and all its dependencies
source: auto-skill
extracted_at: '2026-07-01T14:27:05.333Z'
---

# Dead Entry Point Removal

## When This Applies

A module (e.g., `sync/cli.ts`) exports both:
1. **Library functions** consumed by the main dispatcher (`executeSyncCli`, `planSyncCli`, etc.)
2. **A standalone CLI entry** (`runSyncCli`) with its own arg parser, help text, text formatters, and sub-command handlers

The standalone entry becomes dead when the main dispatcher (`cli/commands/index.ts`) fully covers the command's functionality. The standalone entry, its helpers, and their types are all dead code — but they're tangled with the live library functions in the same file.

## Checklist

### 1. Dependency Analysis (Do This First!)

Before deleting anything, map which exports are actually used externally:

```
grep -r "from.*sync/cli" src/   # find all import sites
```

For each exported symbol, classify:
- **Live**: imported by external files (dispatcher, other modules) → KEEP
- **Dead**: only used internally by the standalone entry → REMOVE

Common dead symbols:
- The standalone entry function itself (`runSyncCli`)
- Arg parser (`parseSyncCliArgs`, `SyncCliOptions`)
- Help text (`getSyncHelpText`, `syncHelpText`)
- Sub-command handlers that duplicate dispatcher logic (server CRUD, `use`, `test-connection`)
- Text formatters only used by the standalone entry (`printSyncServerText`, `printNextActions`)
- Types only used by dead functions (`SyncServerResult`, `SyncUseResult`, etc.)

### 2. Remove Dead Code

- Delete dead functions, types, interfaces, and constants
- Remove imports that become unused (server CRUD helpers, transport functions only used by dead code)
- Keep the file header comment and all live exports intact

### 3. Fix Live Functions While You're In There

The dead code removal is a good opportunity to fix issues in the remaining live functions:
- Replace hardcoded strings with `T()` translation calls
- Update `nextAction` references to current command names (e.g., `forja sync servers` → `forja list servers`)
- Inline removed helper functions if their logic is still needed (e.g., `remotePathForServer` → inline lookup)
- Remove deprecated flag support in the dispatcher (`--plan` flag → only `plan` subaction)

### 4. Update Test Files (Most Commonly Missed!)

Tests often import the dead standalone entry:
- Remove tests that exercise the dead entry point (they test removed code)
- Keep tests for live library functions (`isIgnored`, etc.)
- Remove imports of dead symbols from test files
- **Source-code-inspecting tests**: Tests that `readFileSync` the source and `assert.match` for patterns in removed help text or dead code must be updated to remove those assertions

### 5. Update the Dispatcher

- Remove deprecated flag support (e.g., `--plan` from `findUnknownFlags` known-flags set)
- Remove `hasFlag(argv, '--plan')` checks when only the subaction form should work

### 6. Add Translation Keys

If live functions had hardcoded strings that are now exposed through `T()`:
- Add new keys to the `UI` translation table in `types.ts`
- Use the namespaced pattern (`sync.notEnabled`, `sync.noRemotePath`) for new keys
- Reuse existing keys where the message matches (e.g., `syncMissingServers` for status diagnostics)

### 7. Clean Up Dead Translation Keys

After removing dead functions, check if any `T()` keys in the translation table (`types.ts`) were only used by the removed code. Remove them to keep the translation table clean:
- Grep for each key in `src/` — if zero matches, it's dead
- Common victims: keys for removed formatters, status displays, error messages

### 8. Verify

- `tsc --noEmit` passes (catches dangling references to removed types)
- `grep` for all removed function names — must return zero matches
- Run tests — source-code-inspecting tests are the most likely to fail
- Check that no other module imports removed symbols

## Key Insights

- **The hardest part is dependency analysis**, not the deletion. You must know which exports are live vs dead before touching anything. A function might look dead but be imported by a test file.
- **Source-code-inspecting tests are the most commonly missed breakage.** Tests that `readFileSync('src/sync/cli.ts')` and match against help text or dead code patterns will fail silently until run.
- **Don't try to do incremental edits on large dead code blocks.** When removing 500+ lines scattered throughout a 1200-line file, it's cleaner to `write_file` the reconstructed clean version than to do 10 sequential `edit` operations that shift line numbers.
- **Inline, don't preserve.** If a helper function (like `remotePathForServer`) is used by both live and dead code, inline its 1-line body into the live callers instead of keeping the function.
