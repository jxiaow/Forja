---
name: stale-reference-cleanup
description: After changing CLI command syntax (removing flags, subcommands, or renaming), grep the entire codebase for stale references in diagnostics, nextActions, help text, translations, and tests
source: auto-skill
extracted_at: '2026-07-03T03:18:19.179Z'
---

# Stale Reference Cleanup After Command Syntax Changes

## When This Applies

You changed CLI command syntax — removed flags, removed subcommands, changed a command name, or restructured a command's interface. The implementation is updated, but references to the old syntax are scattered across the codebase.

## Why This Is Hard

Old command syntax leaks into places that don't cause compile errors:
- String literals in diagnostic `fix` fields
- `nextAction` values
- Help text templates
- Translation table values (`T()` keys)
- `KEYWORD_SUGGESTIONS` mappings
- Test assertions that check for specific strings
- Comments and documentation

TypeScript won't catch these. Tests may not catch these. Only a systematic grep finds them.

## Checklist

### 1. Grep for the Old Syntax

Search the entire `src/` directory for the old command string:

```
grep -r "old command syntax" src/
```

Check every match. Common locations:

| Location | What to fix |
|----------|-------------|
| `diagnostics.push({ fix: '...' })` | Update to new command |
| `nextAction = '...'` | Update to new command |
| `nextActions` array elements | Update or remove |
| `KEYWORD_SUGGESTIONS` table | Update hint/params/next |
| `T('key')` translation values | Update the en/zh strings |
| `help.*` translation keys | Update help text |
| Test assertions | Update expected strings |
| Comments | Update or remove |

### 2. Check All Files That Reference the Changed Command

Files most likely to have stale references:

- `src/cli/commands/status.ts` — diagnostic `fix` fields and `nextAction`
- `src/cli/commands/doctor.ts` — diagnostic `fix` fields
- `src/cli/commands/sync.ts` — `nextAction` values
- `src/cli/commands/types.ts` — translation table, help text
- `src/cli/commands/index.ts` — `KEYWORD_SUGGESTIONS`, help routing
- `src/sync/cli.ts` — `nextAction` in sync resolution
- `src/remote/core/status.ts` — version comparison, diagnostic messages
- `src/test/*.ts` — test assertions

### 3. Update Tests That Check Source Code

Some tests read source files and assert patterns:

```typescript
const source = fs.readFileSync('src/cli/commands/index.ts', 'utf8');
assert.match(source, /expected pattern/);
```

These break when you change the source. Update the expected patterns.

### 4. Verify

```bash
# Grep for old syntax — should return zero matches
grep -r "old syntax" src/

# Compile
npm run compile

# Run tests
npm test
```

## Real Example

When `forja sync --server` was removed:

1. `status.ts` had 3× `fix: 'forja sync --server <name> --remote-path <path>'`
2. `doctor.ts` had 1× diagnostic fix
3. `sync.ts` had 2× nextAction
4. `sync/cli.ts` had 1× nextAction
5. `types.ts` had 4× help text lines + 1× translation value
6. `index.ts` had 1× KEYWORD_SUGGESTIONS entry

All were string literals that compiled fine but produced wrong guidance at runtime.

## Rule of Thumb

**Every time you remove or rename a CLI command/flag/subcommand, grep for its exact string across all of `src/` before declaring done.**
