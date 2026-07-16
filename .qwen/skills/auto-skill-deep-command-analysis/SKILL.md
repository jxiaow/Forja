---
name: deep-command-analysis
description: When reviewing CLI commands after a major refactor or storage migration, systematically read each command's actual implementation to find bugs, dead code, data source inconsistencies, and misleading error messages that spec-alignment review misses
source: auto-skill
extracted_at: '2026-07-15T12:07:35.682Z'
---

# Deep Command Analysis

## When to Apply

- After a major storage migration (e.g., old settingsIO → new workspaceStore)
- After a large refactor that touched many command files
- When the user says "review all commands" or "deep analysis"
- When spec-alignment review found zero issues but you suspect there are more

## Why This Is Different from Spec-Alignment Review

Spec-alignment review (see `cli-command-review` skill) checks implementation against documentation. Deep command analysis checks implementation against **itself** — tracing actual data flow, finding dead code, verifying error message accuracy, and detecting inconsistencies between commands that share patterns.

## Method

### Step 1: Full Codebase Read

Read ALL command files, helper files, types, and the dispatcher before launching agents. This gives you context to write precise agent prompts and validate their findings.

### Step 2: 7-Dimension Parallel Analysis

Launch 6-7 parallel general-purpose agents, each covering a group of related commands + cross-cutting concerns. Each agent checks **7 analysis dimensions**:

| Dimension | What to Check |
|-----------|---------------|
| **Data flow** | Correct data source (new store vs legacy), field completeness in transformations, stale references |
| **Translation keys** | Every T() call has a matching key in the translation table; no hardcoded strings in diagnostics/output |
| **Edge cases** | Empty config, corrupted files, paths with spaces, absolute vs relative, null/undefined propagation |
| **JSON/text consistency** | All Result interface fields handled by text formatter; fix/hint fields not dropped in text mode |
| **Error handling** | try/finally for global state, cascading deletes, partial failure reporting, exit code coverage |
| **nextAction accuracy** | Points to a command that can actually fix the problem; not a readonly command; adapts to context |
| **Dead code** | Unused flags, unreachable branches, functions never called, parameters always falsy |

Agent grouping strategy — group by **shared dependencies**, not just sequential order:

| Agent | Commands + Files | Shared Dependencies |
|-------|-----------------|-------------------|
| Agent 1 | status + types.ts translation audit | readiness logic, T() table |
| Agent 2 | init + prompt helpers | workspaceStore, setSilent, projectScanner |
| Agent 3 | list + use + useTarget/ | candidates, activeTarget, workspaceStore |
| Agent 4 | remote + server + remote/core/config | serverStore, SSH, settingsIO |
| Agent 5 | build + run + clean | createActionPlan, runCliResult, remote/plan |
| Agent 6 | stop + doctor + sync | localState, lock, bootstrap, sync/cli |
| Agent 7 | dispatcher (index.ts) + entry (cli/index.ts) | flag parsing, outputResult, routing |

### Step 3: Per-Command Checklist

For each command, the agent checks:

#### Data Flow Correctness
- [ ] Does the command read from the correct data source? (new store vs old store)
- [ ] Are all fields copied completely when constructing intermediate objects?
- [ ] Are there missing field copies? (e.g., `--project` path copies mode/arch but not toolchain fields)
- [ ] After entity deletion, are all references in other stores cleaned up? (dangling-reference-on-delete)

#### Global State Safety
- [ ] Are setSilent/setLocale/etc. wrapped in try/finally?
- [ ] Can exceptions leak global state changes? (global-state-try-finally)

#### Result Envelope Consistency
- [ ] Does `ok: false` always pair with error-level diagnostics? (ok-level-consistency)
- [ ] Is `ok: true` + `level: 'info'` used correctly (not for actual failures)?

#### Dead Code Detection
- [ ] Are there function parameters that are always falsy when checked?
- [ ] Are there unused imports/variables/functions?
- [ ] Are there flags declared in knownFlags but never read? (dead-flag-declaration)

#### Error Message Accuracy
- [ ] Does the error message match the actual failure reason?
- [ ] Does `nextAction` point to a command that can actually solve the problem?
- [ ] Does `nextAction` use exact command syntax?
- [ ] Are all diagnostic messages translated via T()?

#### JSON Output Safety
- [ ] Are there `console.log` calls that could break JSON output?
- [ ] Does text formatter render all diagnostic fields (fix, hint, params)?

#### Flag Scope Validation
- [ ] Are flags validated per-subcommand, not just at command level?
- [ ] Do subcommands reject flags that don't apply to them?

#### Cross-Command Consistency
- [ ] Do similar commands handle the same edge case the same way?
- [ ] Are shared patterns (workroot check, target resolution) implemented identically?

### Step 4: Severity Classification

Classify each finding:

| Severity | Criteria | Action |
|----------|----------|--------|
| Critical | Data loss, crash, security, wrong behavior in common path | Fix immediately |
| High | Wrong behavior in edge case, misleading error in common path | Fix immediately |
| Medium | Dead code, inconsistency, minor UX issue, i18n gap | Fix in same batch |
| Low | Unused import, cosmetic, theoretical issue | Fix in cleanup pass |

### Step 5: Parallel Fix Execution

When fixing many issues across many files, launch parallel general-purpose agents grouped by file:

| Agent | Files |
|-------|-------|
| Agent 1 | status.ts |
| Agent 2 | init.ts |
| Agent 3 | list.ts + use.ts + useTarget/ |
| Agent 4 | remote.ts + server.ts + remote/core/config.ts |
| Agent 5 | build.ts + run.ts + stop.ts + clean.ts |
| Agent 6 | doctor.ts |
| Agent 7 | index.ts (dispatcher) + types.ts |

Each agent gets specific fix instructions with file:line references from the analysis.

### Step 6: Verify Compilation

After all agents complete, run `tsc --noEmit` to verify zero errors. Fix any type mismatches.

### Step 7: Verify Before Claiming "No Issues"

After analysis, if zero issues found, re-read at least 2 command files manually. Deep analysis almost always finds issues — if it doesn't, the analysis wasn't deep enough.

## Real Results: 56 Issues Found and Fixed

In a full audit of 12 CLI commands using this methodology:

| Severity | Count | Key Examples |
|----------|-------|---------|
| Critical/High | 17 | Legacy data source in status, setSilent without try/finally, server delete without cascade, diagnostics duplicated in doctor, remoteReset path injection |
| Medium | 22 | Toolchain fix pointing to readonly commands, hardcoded English/Chinese strings, modify flow overwriting toolchain, suppressWarnings silent replace, no SIGKILL fallback |
| Low | 17 | Dead translation entries, duplicate headers, dead flags, redundant exitCode assignments |

## Key Insight

The most valuable findings come from **tracing actual values through code** rather than reading code at face value. For example:

- `validateMakefile` reads `qtConfig.qtPath` from legacy settingsIO — but CLI users only write to workspaceStore, so the value is always empty → Makefile validation silently fails
- `setSilent(true)` followed by `setSilent(false)` looks safe — until you trace that `scanProFiles()` can throw, leaving the global lock permanently engaged
- `removeServer(id)` removes from servers.json — but doesn't clear `remote.selectedServer` or `sync.selectedServer`, creating dangling references that produce confusing "server not found" errors later
- `doctor` pushes diagnostics inline AND in a final loop over blocked checks → every blocked diagnostic appears twice in output
- `ok: false` + `level: 'info'` is a semantic contradiction that confuses AI agents checking `ok` to decide if they should retry

## High-Priority Analysis Areas

After fixing common issues, analyze these areas for deeper problems:

### 1. Data Source Migration Completeness
- Are there any remaining reads from legacy stores that should use the new store?
- Do all write paths go through the new store exclusively?
- Are there "hybrid" reads that check both stores and could give inconsistent results?

### 2. Cascade Delete Completeness
- When deleting an entity (server, target, config), grep for ALL references to its ID across all stores
- Check: remote.selectedServer, sync.selectedServer, remotePaths, transfer.deployServer
- Dangling IDs cause silent failures downstream

### 3. Translation Coverage
- Grep for ALL hardcoded strings in diagnostic messages, error messages, and output
- Check for hardcoded strings in non-English languages too (e.g., Chinese messages in remote/core/config.ts)
- Verify T() keys exist in BOTH en and zh translation entries

### 4. Partial Failure Reporting
- When a multi-step operation has step 1 succeed and step 2 fail, does the result correctly report partial success?
- Does `ok` reflect the overall outcome or just the last step?
- Are warning diagnostics used for non-fatal failures?

### 5. Global State Leak Prevention
- Every setSilent/setLocale/setXxx call must have try/finally
- Check async functions — `await` between set and restore is a leak window
- Check error paths — does every throw/return path restore the state?
