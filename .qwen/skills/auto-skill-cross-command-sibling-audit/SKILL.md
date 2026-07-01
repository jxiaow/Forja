---
name: cross-command-sibling-audit
description: When fixing an issue in one CLI command, systematically check all sibling commands for the same pattern — same dead imports, same missing validation, same structural inconsistencies
source: auto-skill
extracted_at: '2026-07-01T09:25:26.621Z'
---

# Cross-Command Sibling Audit

When you fix a bug or clean up code in one CLI command, **immediately check all sibling commands** for the same pattern. CLI commands in this project share structure (imports, output functions, error handling, flag validation) — issues rarely exist in only one command.

## When This Applies

- You fixed a dead import / unused parameter in one command's output function
- You added input validation (e.g., file existence check) to one command
- You replaced a weak execution engine with a shared one
- You fixed help text format in one command
- You added error handling (try/catch) to one code path
- You changed a shared interface (e.g., BuildResult) — do all Result interfaces need the same change?

## The Pattern

CLI commands (`build.ts`, `clean.ts`, `run.ts`, `stop.ts`) are structured identically:
- Same imports from `../../qt/cli/` and `./types`
- Same `output*Result()` function shape (wantsJson → JSON, else → text)
- Same `run*()` function shape (resolve target → dispatch by kind → return result)
- Same flag handling (`--json`, `--plan`, `--workspace`, `--lang`)

When one has a problem, the others almost certainly do too.

## Real Examples From This Project

| Fix in build.ts | Found same issue in |
|---|---|
| Replaced `executeSdkAsync` → `runCliResult` | `clean.ts` still used `executeSdkAsync` |
| Removed dead `qtResult` param from `outputBuildResult` | `outputCleanResult` and `outputRunResult` had same dead param |
| Removed dead `locale` param from `outputBuildResult` | Same dead param in all three output functions + 4 call sites in `index.ts` |
| Removed dead `stripJson` import | Also present in `run.ts` |
| Added `fs.existsSync` for `--project` | Only build.ts supports `--project`, but verified clean/run don't need it |

## Process

### 1. Identify the Sibling Set

Determine which commands share the pattern you just fixed:
```bash
# Commands with output functions
grep -rn "output.*Result.*wantsJson" src/cli/commands/

# Commands with similar execution paths
grep -rn "executeSdkAsync\|runCliResult\|createActionPlan" src/cli/commands/

# Commands with same imports
grep -rn "from.*types.*Locale" src/cli/commands/
```

### 2. Check Each Sibling

For each sibling command, check:
- **Same dead import?** — If build.ts had unused `textOutput`, do clean.ts and run.ts?
- **Same dead parameter?** — If `locale` was unused in one output function, is it unused in all?
- **Same missing validation?** — If build.ts didn't validate `--project` file existence, do others that accept `--project`?
- **Same execution engine?** — If build.ts switched to `runCliResult`, did all SDK execution paths?
- **Same error handling?** — If build.ts got try/catch for SDK path, does clean.ts?

### 3. Fix All at Once

Don't just note the issues — fix them all in the same session. Partial cleanup creates inconsistency.

### 4. Update Call Sites

If you changed a function signature (removed a parameter), update ALL call sites:
```bash
grep -rn "outputBuildResult\|outputCleanResult\|outputRunResult" src/cli/commands/index.ts
```

### 5. Verify Compilation

```bash
npx tsc --noEmit
```

## Rules

- **Never fix only one command** — if the pattern is structural (imports, params, output shape), it exists in siblings too
- **Fix all siblings before declaring done** — partial cleanup is worse than no cleanup (creates inconsistency)
- **Check the dispatcher** (`index.ts`) — if you change a function signature, all call sites must update
- **Verify with grep, not memory** — don't assume you know which commands have the pattern; search for it

## Audit Checklist

After fixing an issue in one CLI command:

- [ ] Identified all sibling commands with the same structure
- [ ] Checked each sibling for the same dead imports / params / branches
- [ ] Checked each sibling for the same missing validation / error handling
- [ ] Fixed all siblings (not just the one reported)
- [ ] Updated all call sites in index.ts
- [ ] TypeScript compiles clean
