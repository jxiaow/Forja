---
name: setup-idempotency
description: Re-running setup/init on an already-configured project must skip interactive prompts, skip informational diagnostics, show current values, and follow correct interaction ordering
source: auto-skill
extracted_at: '2026-07-03T11:34:45.729Z'
---

# Setup Idempotency

When a setup/init command is re-run on an already-configured project, it must be a lightweight status update — not a repeat of the first-time experience.

## Interaction Ordering

Interactive prompts must follow a logical dependency order:

```
Target → qmake TARGET (if .pro) → Toolchain paths (Qt, VS) → Build settings (mode, arch)
```

**Why:** Users think in this order — "what am I building, with what tools, how." Don't ask about Qt path before the user has picked their target.

## Interactive Wizard: Step Numbering + Echo-Back

Multi-step interactive flows must show progress and confirm each selection.

### Extract a generic helper

Don't repeat step counting + numbering + echo-back in every prompt. Extract one helper:

```typescript
interface StepTracker { current: number; total: number }

async function interactiveSelect<T extends object>(
    tracker: StepTracker, labelKey: string, items: T[],
    format: (item: T) => string, isSkip: (item: T) => boolean, echo: (item: T) => string,
): Promise<T | null> {
    tracker.current++;
    const choices = [...items, skipSentinel];
    const chosen = await choose(`[${tracker.current}/${tracker.total}] ${T(labelKey)}`, choices, ...);
    if (chosen && !isSkip(chosen)) { console.log(`  ✓ ${echo(chosen)}`); return chosen; }
    console.log(`  – ${skipLabel}`);
    return null;
}
```

### Pre-compute total steps

```typescript
const willPromptTarget = needTargetResolution && totalTargets > 1 && options.interactive;
const willPromptQt = !existingQt.qtPath && qtCandidates.length > 1 && options.interactive;
// ... etc
const tracker: StepTracker = { current: 0, total: [willPromptTarget, willPromptQt, ...].filter(Boolean).length };
```

Some steps can only be determined dynamically (e.g., qmake TARGET prompt depends on which target was selected). For these, increment `tracker.total` and `tracker.current` inline after the dependency is resolved.

### Each prompt is one call

```typescript
if (willPromptTarget) {
    const chosen = await interactiveSelect(tracker, 'init.selectTarget', candidates, ...);
    if (chosen) effectiveCandidates = [chosen];
}
```

### Config summary in output

After all prompts, show a detailed config summary — not just "已配置":

```
本地：
  已配置 (Qt ✓, VS ✓, jom ✓)
  19 Qt + 0 SDK 个目标
  目标: qt_linux_pc_client/qt_linux_pc_client.pro
  Qt (5.15.13): C:\Qt\5.15.13\msvc2019
  VS (2022): C:\Program Files\Microsoft Visual Studio\2022\Community
  模式/架构: release | x86
```

Version goes in parentheses after the label: `Qt (5.15.13): path`. Read back from saved config after init completes. The summary replaces per-field "当前 X: ..." diagnostics — don't show both.

### Toolchain status from path presence

Don't maintain a separate `toolchain: { qt: boolean, vs: boolean }` object — derive status from path presence:

```typescript
if (local.qtPath) parts.push('Qt ✓');
if (local.vsInstall) parts.push('VS ✓');
```

This avoids redundancy between `toolchain.qt` and `qtPath`.

### JSON output: no redundant fields

The JSON result must not contain fields that duplicate other fields or add no information:

| Remove | Why |
|--------|-----|
| `toolchain: { qt, vs, jom }` | Redundant with `qtPath`/`vsInstall` presence |
| `configured: true` | Redundant with `ok: true` |
| `sdkTargets: 0` | Zero-value adds no info; only include when > 0 |

Keep `steps` — it carries meaningful per-step status for `setup remote`.

## Core Pattern: Single Guard Variable

Define ONE boolean that captures "does this execution need to resolve a target" and use it to gate ALL target-related logic. Don't add scattered `!existingActiveTarget` checks at every branch.

```typescript
const hasExistingTarget = !!existingActiveTarget;
const needTargetResolution = !hasExistingTarget || !!options.project || options.reset === true;
```

Then use `needTargetResolution` consistently for all target-related diagnostics and prompts.

**Why not `!existingActiveTarget`?** Because `--reset` sets `existingActiveTarget = null` but still needs the full resolution flow. `needTargetResolution` captures the intent.

## Three Rules

### 1. Skip interactive prompts when already configured

If the user has already made a selection (e.g., activeTarget exists), don't prompt again.

### 2. Skip informational diagnostics that no longer apply

Messages like "找到多个目标，未自动选择" and "配置已存在" are noise when the user already has a configured target. The config summary already shows current values.

### 3. nextAction must check ALL prerequisites

Don't suggest `forja build` just because there's an activeTarget — also check toolchain readiness:

```typescript
const hasTarget = !!(activeTarget || existingActiveTarget);
const toolchainReady = toolchainDetected.qt && (platform !== 'win32' || toolchainDetected.vs);
if (hasTarget && toolchainReady) { nextAction = 'forja build'; }
else if (hasTarget) { nextAction = undefined; }  // toolchain missing
```

## Phase-Based Structure

Structure the init function in clear phases:

```
Phase 1: Detect   — scan targets, detect toolchain, apply flag overrides, validate
Phase 2: Resolve  — interactive prompts (target, Qt, VS, mode, arch)
Phase 3: Save     — write config to disk (check return values, early return on failure)
Phase 4: Select   — auto-select target if single candidate
Phase 5: Report   — warnings, next action, return result
```

## Save Helpers Must Return Boolean

Config write helpers must return `boolean` so the caller can early return on failure:

```typescript
function saveQtConfig(...): boolean {
    // ...
    if (changed) { try { saveQtSettings(workspace, qt); } catch { return false; } }
    return true;
}

// Caller:
if (!saveQtConfig(...)) { return initWriteFailed(error, detected); }
```

**Why:** If Qt config write fails but execution continues to save SDK config and target, you get partial-write state. The original code had early returns — don't lose them during refactoring.

## Anti-Pattern: Piecemeal Guards

```typescript
// BAD: adding a guard at each branch individually
} else if (totalTargets > 1 && options.interactive && !existingActiveTarget) { ... }
} else if (effectiveCandidates.length > 1 && !existingActiveTarget) { ... }
```

Each guard is an independent chance to get the condition wrong. Use one variable.

## Checklist

When modifying setup/init flow:

- [ ] Is there a single `needTargetResolution` variable gating all target-related logic?
- [ ] Are informational diagnostics suppressed when the config summary already shows them?
- [ ] Does nextAction account for all prerequisites (target + toolchain), not just one?
- [ ] Does `choose()` have no default value for large lists?
- [ ] Do interactive prompts use a shared helper with `[N/M]` numbering and echo-back?
- [ ] Does the output include a config summary with versions — `Qt (5.15.13): path` format?
- [ ] Do save helpers return boolean and does the caller early return on failure?
- [ ] Is the function organized in clear phases (Detect → Resolve → Save → Select → Report)?
- [ ] Does qmake TARGET prompt fire for .pro files (both fresh setup and --reset)?
- [ ] Are all multi-option fields (mode, arch, target, toolchain) prompted in interactive mode with no silent defaults?
- [ ] Is JSON output free of redundant fields (no `toolchain`, `configured`, zero-value `sdkTargets`)?
- [ ] Is toolchain status derived from path presence (no separate `toolchain` boolean object)?
