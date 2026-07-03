---
name: cli-command-review
description: Systematic review checklist for CLI command implementations — spec alignment, diagnostic completeness, nextAction logic, text output, i18n, and edge cases
source: auto-skill
extracted_at: '2026-07-01T08:07:55.696Z'
---

# CLI Command Review

When reviewing a CLI command implementation (especially one with a spec document), use this multi-pass checklist. Each pass catches a different category of issues that single-pass review misses.

## When to Apply

- Reviewing a command that has a spec document (e.g., `docs/operations/command-consolidation/v2/<cmd>.md`)
- After implementing a new command or major refactor of an existing one
- When the user says "review <command>"

## Pass 1: Spec-vs-Implementation Alignment

Read the spec document AND the implementation side by side. Check:

### Diagnostic Messages
- [ ] Every diagnostic message text matches the spec's diagnostic table exactly
- [ ] `params` field keys match what the spec expects (e.g., `{file}`, `{detail}`, `{path}`)
- [ ] `hint` fields exist where spec examples show hints
- [ ] `fix` fields exist where spec examples show fix commands
- [ ] No diagnostic uses string concatenation where the spec defines a single message (fragile for i18n)
- [ ] **Dynamic value inclusion**: If the spec message includes `: {path}` or `: {name}`, verify the code actually appends the dynamic value — not just the base T() string. Common miss: `message: T('key')` when spec expects `T('key') + ': ' + value`

### Interface / Type Alignment
- [ ] TypeScript interfaces match the spec's Result type definition
- [ ] All fields in spec JSON examples are present in the interface (check for fields in examples but missing from types)
- [ ] Field types match (e.g., `version?: string` vs missing field)

### Readiness / State Logic
- [ ] Every readiness state value used in code exists in the spec's readiness table
- [ ] All state transitions in the spec have corresponding code paths
- [ ] Edge cases: what happens when a sub-system errors? Does readiness go to `'unknown'` or silently default to another state?

### ok Judgment
- [ ] `assessOk()` logic matches the spec's ok judgment rules
- [ ] Check which states are excluded (e.g., `not-selected` for target → false, but for sync → true)

### nextAction Derivation
- [ ] Trace each spec scenario's expected `nextAction` — does the code produce it?
- [ ] Check priority: does the code consider all factors (running process, diagnostic fix, default)?
- [ ] Common bug: `nextAction` defaults to `'forja build'` when a process is running — should be `'forja stop'`

### JSON Output Scenarios
- [ ] For each spec scenario (normal + error), trace the code path — does it produce the same JSON structure?
- [ ] Check conditional fields: are they shown/hidden at the right times?

## Pass 2: Text Output Formatting

Read `formatStatusText()` (or equivalent) carefully:

- [ ] **Separator check**: Do label+value pairs have proper separators? (e.g., `pid 12345` not `pid12345`)
- [ ] **Translation value check**: Do T() values include trailing colons/spaces where needed? (e.g., `'pid '` not `'pid'`)
- [ ] **Conditional output**: Are optional sections (toolchain, remote, sync, runtime) shown/hidden correctly?
- [ ] **Consistency**: Do all similar labels follow the same format pattern?

## Pass 3: i18n Completeness

- [ ] **All T() keys exist** in the translation table (run translation-key-audit)
- [ ] **No hardcoded strings** in diagnostic `hint` fields — all hints go through T()
- [ ] **No hardcoded diagnostic messages** — `diag('error', 'Some English string')` must use T() keys
- [ ] **No string concatenation** of multiple T() calls with hardcoded separators (e.g., `${T('a')}, ${T('b')}` — should be a single key)
- [ ] **Placeholder pattern**: If T() values have `{0}`, `{1}` placeholders, use `T('key', ['val0', 'val1'])` — never manual `.replace('{0}', ...)`
- [ ] **params key names**: If `params` uses named keys (`qtCount`) but T() uses numbered placeholders (`{0}`), document this mismatch

## Pass 4: Logic Edge Cases

- [ ] **Branch coverage**: Are all combinations of state covered? (e.g., `enabled=false + server=selected + runAt=remote`)
- [ ] **Error → state mapping**: When a function throws, does the readiness state reflect the error (`'unknown'`) or silently default (`'not-selected'`)?
- [ ] **Summary field completeness**: Are summary fields (e.g., `result.sync`) populated in ALL cases where they should be visible, not just the happy path?
- [ ] **Early returns**: Do early return paths (workspace not found, config corrupted) include all required fields?
- [ ] **Early return skips subsequent checks**: In validation functions, does `return 'missing'` after the first check prevent later checks from running? If the spec expects ALL issues reported at once, the function must NOT return early — collect all diagnostics, then return. Pattern: `let ok = true; if (!x) { ok = false; diag(...); } if (!y) { diag(...); } if (!ok) return 'missing';`
- [ ] **Text output for degraded states**: Display conditions like `s.enabled && s.server` hide the section when server is deleted. Check: should the section still show partial info (e.g., "enabled (server not found)") in degraded states?
- [ ] **Invalid positional sub-arg silent fallback**: When a command accepts positional sub-arguments (e.g., `forja list env qt`), invalid values (e.g., `forja list env foo`) must error — not silently fall back to the default/no-sub-arg behavior. Check: is there an `else` branch that rejects unrecognized positional values?
- [ ] **Hardcoded nextAction**: nextAction that doesn't adapt to current state (e.g., always suggesting `'forja use lang zh'` even when lang is already `zh`). Check: does nextAction consider the current state to suggest the opposite/complementary action?

## Pass 5: Cross-cutting Concerns

- [ ] **fix field → nextAction**: If a diagnostic has `fix`, verify it actually influences `nextAction` correctly
- [ ] **Parallel path consistency**: If the same check exists for Qt and SDK paths, do both have the same fields (fix, hint)?
- [ ] **Platform branching**: Windows vs POSIX paths — do both have equivalent diagnostics and fix suggestions?

## Pass 6: Help Text & Interface Consistency

- [ ] **Help text matches implementation**: Every subcommand, flag, and option listed in help text must actually be handled by the dispatcher. Check: does `forja sync --server <id>` work, or is it listed in help but not in `knownFlags`?
- [ ] **No phantom subcommands**: Help text must not list subcommands that don't exist in the handler (e.g., help lists `status`/`transfer` but handler only handles `plan`/`reset`)
- [ ] **nextAction type consistency**: `ForjaJsonResult.nextAction` is `string` (singular). Never set `nextActions` (array) — it gets silently ignored by `outputResult`. Pick the single best suggestion.
- [ ] **No duplicate null checks**: Avoid `if (result.nextAction) { if (result.nextAction) { ... } }` — the inner check is always true and indicates a copy-paste error.
- [ ] **Dead code / redundant arrays**: If `IMPLEMENTED_COMMANDS` equals `COMMANDS`, or `isImplementedCommand()` returns the same as `isCommand()`, one is dead code.
- [ ] **Shared code extraction**: If the same logic (e.g., pinnedProject fallback, --json stripping) appears in 2+ files, extract to a shared helper.

## Pass 7: Sequential Operation Error Propagation

When a command performs multiple sequential operations (e.g., clean → build, detect → configure → deploy), check that errors in early steps are NOT silently swallowed.

- [ ] **Every awaited result is checked**: After `await runSomething()`, is the return value's `ok` field checked? Or is the result discarded?
- [ ] **Multi-step commands fail atomically**: If step 1 of 3 fails, does the command return failure? Or does it continue to step 2?
- [ ] **Preparatory steps propagate errors**: "fresh" = clean + build. If clean fails, the whole command must fail — not silently proceed to build with stale artifacts.

**Bug example:** `build fresh` ran clean first but discarded the result: `await runCliResult(cleanPlan, ...)`. The clean failure was silently swallowed and build proceeded with stale objects. Fix: capture the result, check `ok`, return error if clean failed.

## Pass 8: Result Status Consistency

When a command sets individual step statuses (e.g., `steps.forjaDeploy = 'failed'`), verify the overall `result.ok` reflects those failures.

- [ ] **Any step failed → ok = false**: If any step is marked `'failed'`, the overall result must be `ok: false`.
- [ ] **Error diagnostics match step status**: Steps marked `'failed'` must have corresponding error-level diagnostics.
- [ ] **Early return on critical failure**: When a step fails and subsequent steps depend on it, return immediately with `ok: false` — don't just mark the step and continue.
- [ ] **nextAction is set on failure**: When `ok: false`, `nextAction` must point to a recovery command.

**Bug example:** `setup remote` when SSH unreachable: marked `steps.forjaDeploy = 'failed'` but left `result.ok = true`. Scripts/AI checking `ok` would think setup succeeded when it didn't. Fix: set `result.ok = false`, populate `result.remote` with partial state, set `nextAction: 'forja doctor --remote'`, and return early.

## Pass 9: Cross-Command Consistency

When multiple commands share a pattern (e.g., all execution commands accept `--project`), verify they all implement it consistently.

- [ ] **Same flags across similar commands**: If `build` accepts `--project`, do `run`, `stop`, `clean` also accept it?
- [ ] **Same error behavior**: If `build` returns `forja list targets` when project is missing, does `run` do the same?
- [ ] **Same fallback logic**: If `build` has `tryPinnedProjectFallback()`, does `clean` have it too?
- [ ] **Parity between Qt and SDK paths**: If the Qt code path checks VS and reports missing, does the SDK code path do the same?

**Bug example:** `doctor` checked VS toolchain for Qt targets on Windows but had no `else` branch for SDK targets when `vsInstall` was not configured. SDK targets silently passed the VS check → user saw `toolchain-vs: ready` when VS wasn't configured at all.

## Common Bug Patterns Found

| Pattern | Symptom | Fix |
|---------|---------|-----|
| nextAction ignores running process | `nextAction: "forja build"` when process running | Add `if (runtime?.running)` priority check |
| Diagnostic missing `fix` field | User sees error but no suggested command | Add `fix` to diagnostic |
| Readiness default on error | `readiness.runtime = 'not-selected'` when read failed | Set to `'unknown'` in catch block |
| Summary field conditional too strict | `sync` section hidden when server deleted but enabled=true | Relax condition to just `enabled` |
| Text output missing separator | `pid12345` instead of `pid 12345` | Add space to T() value or template |
| Hardcoded hint string | English hint in Chinese locale | Create T() key for the hint |
| String concatenation of T() calls | `${T('a')}, ${T('b')}` breaks i18n | Merge into single T() key |
| Interface missing field from spec examples | `vs.version` in examples but not in type | Add field to interface |
| Early return skips subsequent checks | Only Qt error shown; VS/jom errors missing | Replace `return` with flag; check all tools before returning |
| Diagnostic message missing dynamic value | `"Qt not found"` instead of `"Qt not found: C:/Qt/old"` | Append `: ${value}` to message; add `params` |
| Text output hides section in degraded state | Sync line disappears when server deleted | Relax condition; show partial info with degraded-state label |
| Spec ok rules vs examples inconsistency | Rules say "any blocked → false" but sync excluded | Clarify rules to list which dimensions are checked; update examples |
| Help text lists phantom subcommands/flags | `forja sync status` errors with "unknown action" | Help text must match actual handler implementation exactly |
| `nextActions` array silently ignored | JSON output has `nextActions` but text mode shows nothing | Use `nextAction` (singular string), pick best suggestion |
| `flagsWithValues` swallows positional args | `doctor --unlock` consumes next token as value | Only list flags that actually consume a value argument |
| Duplicate toolchain checks when no target | `toolchain-vs` appears twice in doctor output | Track checked items in a Set to deduplicate |
| Hardcoded diagnostic messages in English | Chinese locale shows English error messages | All `diag()` messages must use T() translation keys |
| `wantsJson` fallback to `process.argv` | Inconsistent JSON detection across commands | Always use `options.json ?? false`, dispatcher passes the value |
| Dead flags in knownFlags | `forja doctor --fix` accepted but does nothing | Remove flags from knownFlags that no code path reads |
| Sequential error silently swallowed | `build fresh` clean fails but build proceeds | Check return value of every awaited step; return error on failure |
| Step failed but ok=true | `setup remote` SSH unreachable, steps=failed, ok=true | Set `ok=false` when any step fails; return early with nextAction |
| Asymmetric toolchain checks | SDK target on Windows doesn't check VS | Ensure Qt and SDK paths have equivalent validation branches |

## Multi-pass Rationale

Single-pass review tends to only find surface issues (typos, missing imports). Each pass targets a different category:
- Pass 1 catches spec misalignment (most impactful)
- Pass 2 catches text formatting (user-visible)
- Pass 3 catches i18n gaps (locale-dependent)
- Pass 4 catches logic edge cases (state-dependent)
- Pass 5 catches consistency issues (maintenance burden)

In practice, reviewing a single command across 4 rounds found 18 issues total:
- Round 1 (Pass 1+2): 6 issues — major bugs, spec alignment, text formatting
- Round 2 (Pass 3+4): 5 issues — i18n gaps, edge cases, missing fix fields
- Round 3 (Pass 1 re-trace): 3 issues — diagnostic messages missing dynamic values, text display conditions
- Round 4 (Pass 4 deep): 4 issues — early return control flow, spec rule/example inconsistencies

Each round found issues the previous rounds missed. The later rounds required reading the code more carefully and tracing every spec scenario through the actual code path.
