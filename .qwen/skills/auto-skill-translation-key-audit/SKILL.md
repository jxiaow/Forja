---
name: translation-key-audit
description: Systematically audit T() translation key calls against the translation table — find mismatches where code uses keys that don't exist, causing raw key names to appear in user output
source: auto-skill
extracted_at: '2026-06-30T09:08:33.953Z'
---

# Translation Key Audit

When the project uses a `T('key')` function for i18n, code can silently reference keys that don't exist in the translation table. The `T()` function returns the raw key string when a key is missing, so users see identifiers like `use.invalidModeHint` instead of translated text.

## Why This Matters

Unlike missing imports or type errors, **missing translation keys compile cleanly and pass type checks**. The only way to detect them is to systematically compare code usage against the translation table. In one audit, 29 mismatches were found across 3 files — all invisible to the compiler.

## When to Run

- After adding new T() calls in any command file
- After renaming or consolidating translation keys
- As part of a code review for any file that calls T()
- When users report seeing raw key names in output

## Audit Procedure

### 1. Extract All T() Keys from Code

Search all source files for T() calls:
```
grep -rn "T('" src/cli/commands/ | grep -oP "T\('[^']+'\)"
```

Collect the unique keys per file.

### 2. Extract All Defined Keys from Translation Table

The translation table lives in `src/cli/commands/types.ts`. Extract all defined keys:
```
grep -oP "'[^']+'\s*:" src/cli/commands/types.ts
```

### 3. Compare: Code Keys vs Table Keys

For each key used in code, check if it exists in the translation table. Report any key that appears in code but NOT in the table.

### 4. Fix Mismatches

For each missing key, determine the correct fix:

**Option A: Code uses wrong key name, correct key exists in table**
```typescript
// Code uses: T('use.invalidModeHint')
// Table has: T('use.invalidModeDetail')  ← same meaning, different name
// Fix: change code to use the table key
```

**Option B: Key genuinely missing, needs to be added**
```typescript
// Code uses: T('init.selectTarget')
// Table has: nothing similar
// Fix: add the key to the translation table with en/zh entries
```

### 5. Verify

After fixes, re-run the comparison to confirm zero mismatches. Compile and run tests.

## Common Mismatch Patterns

| Pattern | Example | Root Cause |
|---------|---------|------------|
| Hint vs Detail | `use.invalidModeHint` vs `use.invalidModeDetail` | Developer used intuitive name, table has different convention |
| Short vs Long | `idx.unexpectedArg` vs `idx.unexpectedArgument` | Abbreviation in code, full word in table |
| Past vs Present | `init.remoteInitOk` vs `init.remoteInitSucceeded` | Different tense/voice |
| Completely Missing | `use.projectKindUnknown` | New error path added without updating translation table |

## Checklist

- [ ] All T() keys in `src/cli/commands/*.ts` exist in the translation table
- [ ] No key is defined in the table but unused in code (dead translations)
- [ ] Keys follow consistent naming convention (camelCase, dot-separated namespace)
- [ ] Both `en` and `zh` entries exist for every key
- [ ] After adding new T() calls, the translation table was updated in the same change
