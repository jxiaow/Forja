---
name: module-redundancy-review
description: Multi-pass review of a single module for redundancy patterns — each pass finds progressively deeper issues that a single pass misses
source: auto-skill
extracted_at: '2026-06-29T14:30:00.000Z'
---

# Module Redundancy Review

When reviewing a single module (command handler, service, etc.) for code quality, a single pass is not enough. Redundancy hides at different depths — each pass finds progressively subtler issues.

## Why

In a `forja status` review, 6 passes found 21 issues total:
- Pass 1 (10 issues): obvious bugs, dead code, mid-file require(), duplicate function calls, unused params
- Pass 2 (4 issues): helper functions still reloading configs that caller already loaded, dead interface fields, mergeable branches
- Pass 3 (3 issues): redundant object re-assignment, verbose `ReturnType<typeof ...>` instead of imported types, duplicate `getServerById` calls
- Pass 4 (2 issues): dead field never populated, cross-file redundant config loading in `collectTargetCandidates`
- Pass 5 (2 issues): dead `vs.version` field, cross-module redundant loading in `resolveRemoteConfig` — fixed by splitting into `resolveRemoteConfigFrom` (pure) + `resolveRemoteConfig` (wrapper)
- Pass 6 (0 issues): confirmed convergence — no new findings after 21 fixes across 3 files

Each pass only found issues because the previous fixes made the code cleaner and the remaining redundancy more visible.

## Procedure

### Pass 1: Surface issues
Read the full file. Check:
- Dead code (unreachable branches, ternary with same value on both sides)
- Duplicate function calls (same function called twice with same args)
- Import issues (dynamic require, mid-file imports, unused imports)
- Unused parameters (declared but never referenced in function body)
- Redundant config/data loading (load once at top, reuse below — not reload in each section)
- Catch blocks that silently swallow errors

### Pass 2: Cross-function redundancy
After pass 1 fixes, re-read the file. Check:
- Helper functions that reload data the caller already has (should accept as parameter)
- Dead interface fields (defined but always `undefined` / never populated)
- Mergeable branches (if/else with identical assignment in both)
- Duplicate logic blocks (same 5+ lines repeated in different branches)

### Pass 3: Micro-redundancy
After pass 2 fixes, re-read. Check:
- Redundant re-assignment (`obj.field = obj.field` via reference mutation)
- Redundant recalculation (recomputing a value that hasn't changed)
- Verbose type patterns (`ReturnType<typeof fn>` when the type is exported)
- Duplicate lookups (same `getById` / `find` called in different sections)

### Pass 4: Cross-file redundancy (same-module callers)
Check if functions within the module that are called by the reviewed module also have redundant loading:
- Does a called function internally reload data the caller already has?
- Apply pure-aggregation-wrapper pattern: split into pure function + convenience wrapper

### Pass 5: Cross-module redundancy
Check if functions in OTHER modules that the reviewed module calls also have redundant loading:
- Does a cross-module function (e.g. `resolveRemoteConfig` from `remote/core/config.ts`) internally reload data the caller already has?
- Apply pure-aggregation-wrapper pattern to the cross-module function
- This pass often requires touching files outside the reviewed module

### Pass 6: Convergence check
Re-read the final state. If no new issues found, the review is complete.

## Key patterns

| Pattern | Fix |
|---------|-----|
| Config loaded at top, then reloaded in helper | Pass cached value as parameter |
| `ReturnType<typeof fn>` when type is exported | Import the type directly |
| Two branches set same value before diverging | Merge into one branch, nest the divergence |
| `result.x = result.x` after mutation | Delete — reference already reflects mutation |
| Field in interface always `undefined` | Remove from interface |
| Same `getById` called twice in same function | Cache in a variable |
| Same 10-line block in 2 branches | Extract to helper function |
| `catch { /* ignore */ }` | Narrow to expected errors, surface unexpected ones |
| Cross-module function reloads caller's data | Split into pure function + convenience wrapper |

## Verification

After each pass:
1. `tsc --noEmit` — type check
2. Compile and run the command in all modes (text, --json, --process etc.)
3. Verify output is identical to before the fix (behavior preservation)

## When to apply

- When user asks to "review" a command or module
- After implementing a feature and wanting to clean up
- When a module has grown past ~300 lines and feels "heavy"
- Stop when a full pass finds 0 issues (convergence)
