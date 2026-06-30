---
name: post-migration-cleanup
description: After a migration/consolidation, remove transitional naming prefixes that no longer distinguish anything
source: auto-skill
extracted_at: '2026-06-17T08:01:59.250Z'
---

# Post-Migration Naming Cleanup

## When to Apply

After a migration or consolidation is complete and the old code path is fully removed, transitional prefixes (e.g., `unified`, `new`, `v2`, `modern`, `legacy`) in file names, function names, type names, and comments become dead weight. They imply a distinction that no longer exists.

## Checklist

### 1. Identify Dead Prefixes

Look for naming that was added to distinguish old vs new during migration:
- File names: `unifiedCommands.ts`, `newParser.ts`, `v2Handler.ts`
- Function/type names: `runUnifiedCli`, `UnifiedCommand`, `createNewBuilder`
- Comments: "Unified CLI entry", "called by the unified dispatcher"

If the prefix no longer distinguishes from anything (the old path is gone), it's dead.

### 2. Rename Source Files

- `unifiedFoo.ts` → `foo.ts`
- `newBar.ts` → `bar.ts` (if old bar is deleted)

### 3. Rename Exports

- `registerUnifiedCommands` → `registerCommands`
- `UnifiedCommand` → `Command`
- `isUnifiedCommand` → `isCommand`
- `UNIFIED_COMMANDS` → `COMMANDS`
- `runUnifiedCli` → `runCli`

### 4. Update All Import Sites

Search for all imports of renamed symbols and update them. Key files:
- Entry points (extension.ts, cli/index.ts)
- Cross-module imports (qt/commands.ts, sdk/sdkExtension.ts)
- Dynamic imports (await import('../ui/unifiedStatusBar'))

### 5. Update Test Files (Easy to Miss!)

Test files often reference old names via string literals:
- `readFileSync(path.join(..., 'unifiedStatusBar.ts'))` → update path
- `assert.match(source, /registerUnifiedCommands/)` → update regex
- `assert.match(source, /runUnifiedCli/)` → update regex
- Temp directory names: `'forja-unified-foundation-'` → `'forja-cli-foundation-'`

**Always grep for the old names in test files after renaming source exports.**

### 6. Update Comments

Remove transitional language from doc comments:
- "Unified CLI entry" → "CLI entry"
- "called by the unified forja dispatcher" → "called by the forja dispatcher"
- "Provides a unified interface" → "Provides an interface"

### 7. Verify

- `tsc --noEmit` passes
- `eslint` passes
- All tests pass (especially source-assertion tests)

## Key Insight

The user expects transitional naming to be cleaned up as part of the migration itself. Leaving `unified` prefixes after the old code is gone signals incomplete work. When in doubt, ask: "Does this prefix still distinguish from something, or is it just historical?"
