---
name: self-review-before-close
description: After implementing a batch of changes, must do a thorough self-review of all changed files before declaring done — use an agent to scan for bugs, edge cases, and inconsistencies
source: auto-skill
extracted_at: '2026-06-24T04:43:48.478Z'
---

# Self-Review Before Close

After implementing a batch of changes (3+ files or non-trivial logic), must do a thorough self-review of ALL changed files before declaring the task complete. Do NOT skip this step.

## Why

In a 10+ round bug-fix session, the user found issues that the implementer should have caught:
- `forja --help` broken because --help intercept was placed after the no-command check
- `doctor --plan` rejected as unknown flag because the flag set was incomplete
- `sync --force` silently accepted but never implemented
- `delete` used instead of `= null` for typed fields
- `require()` used instead of `await import()` inconsistent with the rest of the file
- Dead code in workspace boundary check (condition always false)
- Plan mode not respecting existing state (inconsistent with execution)

All of these were findable by reading the changed code carefully.

## Procedure

### Single-layer review (for small changes, ≤5 files in one layer)

1. **After all fixes are implemented and tests pass**, launch a review agent with the full list of changed files
2. The agent reads each file thoroughly and reports:
   - Logic errors or bugs introduced by the changes
   - Edge cases not handled (missing values, empty inputs, error paths)
   - Inconsistencies between files (e.g., one handler has a flag, another doesn't)
   - Dead code or unreachable branches
   - Type mismatches or incorrect casts
   - Ordering dependencies (e.g., intercept must come before check X)
3. Fix everything the agent finds
4. Re-run tests
5. Only then declare the task complete

### Multi-layer review (for large changes, ≥6 files or spanning multiple layers)

Launch **3 parallel review agents**, each targeting a different architectural layer:

1. **CLI layer agent** — Reviews `src/cli/commands/`, `src/cli/index.ts`. Checks:
   - Every handler's flag validation completeness (compare knownFlags vs flags actually read)
   - Positional arg validation coverage across all handlers
   - Write ordering (domain config before activeTarget)
   - Error handling on all file writes
   - Exit code correctness on failure paths

2. **VSCode/UI layer agent** — Reviews `src/vscode/`, `src/ui/`, `src/extension.ts`. Checks:
   - Settings sync between config panel and activeTarget
   - Return value checks on all CLI function calls
   - Resource lifecycle (terminals, emitters, subscriptions)
   - Import consistency (await import vs require)
   - Type contract adherence (null vs delete)

3. **Core/Remote layer agent** — Reviews `src/core/`, `src/remote/`. Checks:
   - Config sanitization completeness
   - Corruption tracking integration with consumers
   - Lock lifecycle (acquire/release in all error paths)
   - Bridge error handling and timeout behavior
   - Path resolution edge cases (parent workspace inheritance)

After all 3 agents report, fix all findings, re-run tests, then declare complete.

## What to look for

| Category | Example |
|----------|---------|
| **Ordering** | --help intercept placed after no-command check → `forja --help` errors |
| **Incomplete sets** | Flag validation set missing a flag that the handler actually uses |
| **Dead code** | Condition always false because value was already transformed |
| **Type contract** | `delete` instead of `= null` for typed fields |
| **Import consistency** | `require()` in a file that uses `await import()` everywhere else |
| **Plan/execution mismatch** | Plan shows defaults that execution doesn't produce |
| **Error swallowing** | Catch block that logs but doesn't propagate or rollback |
| **Missing return** | After error, code continues instead of returning early |
| **Missing exit code** | Failure path returns ok:false but doesn't set `process.exitCode = 1` |
| **Partial write** | Domain config saved but activeTarget not — or vice versa |
| **Dead feature flag** | Flag in knownFlags set but never read by the handler |
| **Missing value msg** | `--server=<missing>` reported as "unknown flag" instead of "requires a value" |
| **Non-null assertion** | `prepared.lock!.lockId` — fragile against future refactoring |
| **Rollback scope** | `_settings = _load()` restores ALL sections instead of just the failed one |
| **Notification scope** | `_reload` notifies all keys in a section instead of only changed keys |
| **Cross-layer sync** | Config panel saves SDK setting but doesn't sync to activeTarget |
| **Dead corruption check** | try-catch around load functions that catch internally — never fires |
| **Doc/code mismatch** | Docs reference `remoteForjaVersion` but code uses `remoteForjaBin` |
| **Mutation double-call** | `extractFlag(argv, '--port') ? parseInt(extractFlag(argv, '--port')!, 10)` — first call removes from argv, second returns undefined → NaN. Any argv-mutating helper called twice for the same key is a bug |
| **Step key inconsistency** | Multi-step workflow sets `result.steps.remoteConfig` in code but display formatter only knows `serverSetup` — step silently missing from output. All step keys set in logic must exist in the display mapping |
| **Result state hardcoded** | `executionMode: 'remote'` set unconditionally even when the switch step failed or was skipped — result fields must reflect actual runtime outcomes, not assumed outcomes |
| **Silent error swallowing** | `if (result.ok) { ... }` with no `else` branch — failure from sub-function call is silently dropped, user sees no diagnostic and no failed step |
| **Semantic drift in replacement** | Replacing `legacyConfig.qtPath \|\| legacyConfig.vsInstall` with `targets.length > 0` — the new check tests a different property (target existence vs toolchain configuration). Always verify the replacement has identical semantics, not just similar shape |
| **Architecture layer violation in fix** | Adding `import { T } from '../../cli/commands/types'` to a `core/` or `remote/core/` module to fix a translation issue — core layers must not depend on CLI/UI layers. The fix introduces a worse problem than the original |
| **Error detail loss in downgrade** | Changing `ok: false` with full diagnostics to `ok: true` with a generic warning — the specific error cause (permission denied, SSH timeout) is lost. Always preserve the original diagnostic details in the warning message |
| **Optional parameter bypass** | Making `workspace?: string` optional so callers don't need to pass it — but the cascade cleanup logic inside the function is skipped when workspace is absent, leaving dangling references |
| **Error path conflation** | A function returns `false` for both "user cancelled" and "config write failed" — the caller shows "cancelled" for both cases. Use discriminated return types to distinguish failure modes |
| **Null as error surrogate** | Returning `null` from a function to indicate an error, then the caller maps null to a generic "cancelled" message — instead return a result type `{ ok: false, diagnostics: [...] }` that carries the actual error |

## Parallel-path consistency (apply DURING fixes, not just after)

When you find a bug in one code path, immediately check all sibling/parallel paths for the same bug before moving on. This is not "proactive bug hunting" in general — it's specifically about mirroring fixes across structurally similar code.

### Technique

1. **Identify the pattern**: You found bug X in function/path A
2. **Find siblings**: Grep for structurally similar functions/paths (e.g., `runSetup` vs `runSetupRemote`, or two branches of an if/else, or two handlers for similar commands)
3. **Check each sibling**: Does the same bug exist there?
4. **Fix all instances together**: Don't fix one and forget the others

### Examples from this project

| Bug found in | Sibling with same bug | What to check |
|---|---|---|
| `runSetup` passes `effectiveProject` to `runInit` | `runSetupRemote` only passed `answers?.target` | All flag→option forwarding in both functions |
| `runSetup` has `!effectiveProject` guard on needs-input | `runSetupRemote` missing the same guard | All conditional guards in both paths |
| Question filter checks `saved.toolchain` (wrong state) | Same filter in `runSetupRemote` | All question/config filtering in both functions |

### When to apply

- Fixing a bug in one of N similar functions/handlers/branches
- Adding a flag/parameter to one command that similar commands also take
- Changing filter/validation logic that appears in multiple places

## When to apply

- After fixing 3+ bugs in one batch
- After any change to a dispatcher/router/handler pattern
- After adding validation to some but not all siblings
- When the user says "review your changes" or "are you done?"

## Anti-pattern

```
Implement fixes → run tests → "all done!" → user finds 5 more bugs
```

## Correct pattern

```
Implement fixes → run tests → self-review agent → fix findings → re-test → "all done!"
```
