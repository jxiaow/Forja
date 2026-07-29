---
name: merge-with-arch-simplification
description: When merging commands, simultaneously simplify internal architecture — replace combinatorial booleans with per-field resolvers, unify dual-path patterns, split monolithic functions into phases
source: auto-skill
extracted_at: '2026-07-05T05:35:31.004Z'
---

# Merge with Architecture Simplification

When merging one command into another (e.g., `setup` → `use target`), do NOT just add the old command's logic on top of the new. The receiving command is likely already complex. Use the merge as an opportunity to simplify the internal architecture so the merged result is simpler than either input alone.

## When This Applies

- Merging command A into command B where B already has complex branching
- The merged function would exceed ~200 lines or have >20 if/else branches
- The source command has combinatorial conditionals (e.g., 6 boolean `willPrompt*` variables)
- The same `if (kind === 'qt') {} else {}` pattern appears 3+ times across files

## Anti-Pattern: Naive Merge

```
Before: runUseTarget = 220 lines, 25 branches
After:  runUseTarget = 500+ lines, 50 branches (added setup logic on top)
```

This is what happens when you just copy setup's logic into use target's existing branches. Every setup condition multiplies with every use target condition.

## Target Architecture

```
Before: runUseTarget = 220 lines, 25 branches
After:  runUseTarget = 50 lines (orchestrator)
        detect.ts = 80 lines (phase 1)
        resolve.ts = 150 lines (phase 2, independent functions)
        save.ts = 80 lines (phase 3, unified dispatch)
        report.ts = 80 lines (phase 4)
        Total = 440 lines, but max function = 150 lines, branches per function < 10
```

## Process

### 1. Identify Complexity Hotspots

Before merging, measure the current state:

| Metric | How to Count |
|--------|-------------|
| Lines per function | Any function > 200 lines is a hotspot |
| if/else branches | Count `if`/`else if`/`else` in each function |
| Repeated patterns | Same `if (kind === X)` appearing 3+ times |
| Combinatorial booleans | N boolean variables that gate behavior = 2^N potential paths |

### 2. Replace Combinatorial Booleans with Per-Field Resolvers

**Problem:** N boolean variables like `willPromptTarget`, `willPromptQt`, `willPromptVs`... each depending on 3-5 independent factors. They create implicit state spaces (2^N combinations) and cross-dependencies.

**Solution:** Each field gets an independent resolve function with clear priority:

```typescript
// WRONG: 6 willPrompt* booleans with cross-dependencies
const willPromptTarget = needTarget && totalTargets > 1 && interactive && !project;
const willPromptQt = !qtPath && (reset || !existingQt.qtPath) && candidates.length > 1 && interactive;
// ... 4 more, each with 3-5 conditions

// RIGHT: independent resolve per field, 3-4 clear paths each
async function resolveTarget(candidates, existing, options) {
    if (options.project) return options.project;          // priority 1: flag
    if (existing && !options.reset) return existing;      // priority 2: existing
    if (candidates.length === 1) return candidates[0];    // priority 3: single option
    if (options.interactive) return await choose(...);    // priority 4: interactive
    return undefined; // → JSON question                  // priority 5: needs-input
}
// Same pattern for resolveQtPath, resolveVsPath, resolveMode, resolveArch...
```

**Key rule:** Each resolve function must be independently callable — no shared state, no cross-dependencies. The main flow becomes a linear sequence:

```typescript
const target = await resolveTarget(ctx, options);
const qtPath = await resolveQtPath(ctx, options);
const vsInstall = await resolveVsPath(ctx, options);
const mode = await resolveMode(ctx, options);
const arch = await resolveArch(ctx, options);
```

### 3. Unify Repeated Dual-Path Patterns

**Problem:** `if (kind === 'qt') { ... } else { ... }` repeated 6+ times across files.

**Solution:** Extract a single dispatch function that handles kind internally:

```typescript
// WRONG: every call site does kind dispatch
if (kind === 'qt') {
    const qt = loadQtSettings(ws); qt.mode = mode; saveQtSettings(ws, qt);
} else {
    const sdk = loadSdkSettings(ws); sdk.mode = mode; saveSdkSettings(ws, sdk);
}

// RIGHT: unified interface, dispatch once inside
function saveTargetFields(workspace, kind, fields) {
    if (kind === 'qt') {
        const qt = loadQtSettings(workspace);
        if (fields.mode) qt.mode = fields.mode;
        // ... all qt fields ...
        saveQtSettings(workspace, qt);
    } else {
        const sdk = loadSdkSettings(workspace);
        if (fields.mode) sdk.mode = fields.mode;
        // ... all sdk fields ...
        saveSdkSettings(workspace, sdk);
    }
}
// Callers just: saveTargetFields(workspace, kind, { mode, arch, qtPath, ... })
```

### 4. Split Monolithic Functions into Phases

**Problem:** A 400-line function with 7 sequential steps and error handling at each step.

**Solution:** Split into phase functions, each 50-150 lines, orchestrated by a thin entry point:

```typescript
// WRONG: 400-line monolith
async function runSetupRemote(workspace, options) {
    // Phase 1: detect (30 lines)
    // Phase 2: resolve server (110 lines, 4 paths)
    // Phase 3: configure remote (20 lines)
    // Phase 4: configure sync (15 lines)
    // Phase 5: deploy forja (50 lines)
    // Phase 6: remote init (40 lines)
    // Phase 7: switch execution (10 lines)
    // Error handling interleaved throughout
}

// RIGHT: thin orchestrator + phase modules
async function runUseTarget(workspace, options) {
    const ctx = await detectContext(workspace);           // Phase 1: ~80 lines
    const resolved = await resolveAll(ctx, options);      // Phase 2: ~150 lines
    if (!resolved.config) return buildErrorResponse();
    const saveResult = saveAll(workspace, resolved.config); // Phase 3: ~80 lines
    if (!saveResult.ok) return buildErrorResponse();
    return buildSuccessResult(resolved.config, ctx);      // Phase 4: ~80 lines
}
```

### 5. Eliminate Repeated Templates in Dispatchers

**Problem:** Every handler function repeats the same 4-line unknown-flag validation pattern, 12 times.

**Solution:** Extract a handler wrapper:

```typescript
// WRONG: 12 handlers × 4 lines = 48 lines of identical validation
async function handleBuild(argv, workspace, wantsJson) {
    const unknown = findUnknownFlags(argv, knownFlags, flagsWithValues);
    if (unknown.length > 0) {
        outputResult({ ok: false, diagnostics: [unknownFlagsMsg(unknown)] }, wantsJson);
        process.exitCode = 1; return;
    }
    // ... actual logic ...
}

// RIGHT: wrapper handles validation
function withValidation(known, withVal, handler) {
    return async (argv, workspace, wantsJson) => {
        const unknown = findUnknownFlags(argv, known, withVal);
        if (unknown.length > 0) {
            return { ok: false, diagnostics: [unknownFlagsMsg(unknown, known)] };
        }
        return handler(argv, workspace, wantsJson);
    };
}
```

### 6. Set Complexity Targets

Before starting, define measurable targets:

| Metric | Before | Target |
|--------|--------|--------|
| Total lines (command layer) | 3748 | ~2500 |
| Max function lines | 400 | < 150 |
| if/else density | 10.5/100 lines | < 7/100 lines |
| Dual-path repetitions | 6 | 1 (inside unified function) |
| Combinatorial boolean vars | 6 | 0 (per-field resolve) |

## Checklist

- [ ] Complexity hotspots identified and measured before merging
- [ ] Combinatorial booleans replaced with per-field resolve functions
- [ ] Each resolve function has ≤ 5 clear priority paths, no cross-dependencies
- [ ] Dual-path patterns (kind dispatch) unified into single function
- [ ] Monolithic functions split into ≤ 150-line phase modules
- [ ] Entry point is a thin orchestrator (< 50 lines)
- [ ] Repeated templates extracted into wrappers
- [ ] Complexity targets defined and met
- [ ] Each phase module is independently testable
- [ ] `tsc --noEmit` passes after each phase
