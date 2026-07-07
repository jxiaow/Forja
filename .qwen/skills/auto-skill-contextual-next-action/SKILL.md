---
name: contextual-next-action
description: nextAction must match the user's specific situation and interaction mode — not a generic fallback for all failure types
source: auto-skill
extracted_at: '2026-07-01T06:16:20.302Z'
---

# Contextual Next Action

`nextAction` must tell the user what to do NEXT given their specific situation — the interaction mode they're in, what they've already provided, and what specifically went wrong. A generic fallback like `forja list targets` for all ambiguous cases is unhelpful because it doesn't match the user's context.

## Bug Pattern: Generic Fallback for All Failures

```typescript
// BUG: same nextAction for all ambiguous cases
if (initResult.ambiguous) {
    result.nextAction = 'forja list targets';  // Wrong for most cases!
}
```

This is wrong because:
- **Interactive mode, user didn't choose** → They just saw the list in the `choose()` prompt. Telling them to `list targets` is redundant.
- **--json + answers file missing target** → They need to fix their answers file, not list targets.
- **--project not found** → This is the ONLY case where `list targets` is correct (they need to discover valid paths).

## Correct Pattern: Match nextAction to Situation

```typescript
if (initResult.ambiguous) {
    if (options.json && answers) {
        // --json mode with answers, but answers didn't include target
        result.nextAction = 'forja setup --json --answers <answers.json>';
    } else {
        // Interactive mode, user didn't choose from prompt
        result.nextAction = 'forja setup';  // Retry
    }
} else {
    result.nextAction = 'forja build';
}
```

## Decision Matrix

| Situation | Interaction Mode | What Went Wrong | Correct nextAction |
|-----------|-----------------|-----------------|-------------------|
| Multi-target ambiguous | `--json`, no answers, no --project | Missing input | `forja setup --json --answers <answers.json>` |
| Multi-target ambiguous | `--json` + answers file | Answers missing target | `forja setup --json --answers <answers.json>` |
| Multi-target ambiguous | Interactive, user cancelled | User didn't choose | `forja setup` (retry) |
| `--project` path not found | Any mode | Invalid path provided | `forja list targets` (discover valid paths) |
| No server configured | `--json`, no answers | Missing input | `forja setup remote --json --answers <answers.json>` |
| No server configured | Interactive | No servers exist | `forja server add` |
| Multiple servers, none selected | Non-interactive | Ambiguous | `forja list servers` |
| All succeeded | Any mode | N/A | `forja build` |

## Rules

1. **nextAction must match the interaction mode** — interactive users who just saw a prompt don't need to be told to `list` what they saw; AI agents need the `--answers` protocol; script users need flag-based solutions.

2. **nextAction must match what went wrong** — "project not found" → `list targets`; "answers incomplete" → fix answers; "user cancelled" → retry the same command.

3. **Don't use `list` as a generic "help" fallback** — `forja list targets` is only appropriate when the user needs to DISCOVER valid options. If they already saw the options (interactive prompt) or need to PROVIDE input (answers file), `list` is the wrong suggestion.

4. **Early returns from sub-functions carry context** — when `runInit` returns `nextAction: 'forja list targets'` because `--project` didn't match, the caller must propagate it (see `diagnostic-propagation` skill). Don't override it with a generic fallback.

5. **The "retry" pattern** — when the user was in interactive mode and didn't complete (cancelled a prompt, didn't choose), the nextAction should be the same command they just ran, so they can try again.

6. **The "toggle" pattern for list/view commands** — when showing a current setting value, nextAction should suggest the opposite/alternative, not a hardcoded value. Example: `listLang()` showing current language `zh` should suggest `forja use lang en` (switch to the other option), not always `forja use lang zh` regardless of current state.

```typescript
// BUG: always suggests zh regardless of current lang
nextAction: 'forja use lang zh'

// CORRECT: suggest the toggle
nextAction: lang === 'zh' ? 'forja use lang en' : 'forja use lang zh'
```

## The "Skipped Config" Pattern

When a user **explicitly skips** a configuration step (e.g., selects "跳过" for mode/arch/toolchain), nextAction must NOT suggest `forja build` — even if an existing target has values from a previous session. The skip means "I don't want to configure this now" and the system must respect that.

```typescript
// BUG: suggests build because existing target has mode/arch from before
const hasTarget = !!(activeTarget || existingActiveTarget);
if (hasTarget && toolchainReady) nextAction = 'forja build';

// CORRECT: track whether user skipped in this session
const skippedConfig = modeSkipped || archSkipped;
if (hasTarget && toolchainReady && !skippedConfig) nextAction = 'forja build';
else if (skippedConfig) nextAction = 'forja setup';  // come back to finish
```

### Key Insight

`needTargetResolution` (whether target selection was needed) is NOT the same as "user skipped config". A user can have an existing target (so `needTargetResolution = false`) but still skip mode/arch prompts. The skip tracking must be independent:

```typescript
let modeSkipped = false;
if (willPromptMode) {
    const chosen = await choose(...);
    if (chosen) resolvedMode = chosen.value;
    else modeSkipped = true;  // explicitly tracked
}
// Don't fall back to existing values when skipped
const effectiveMode = modeSkipped ? undefined : (resolvedMode || existingTarget?.mode);
```

## Anti-Patterns

| Anti-pattern | Why it's wrong | Correct approach |
|-------------|---------------|-----------------|
| `forja list targets` for all ambiguous cases | Redundant in interactive mode (user just saw the list); wrong for incomplete answers | Match to mode: retry for interactive, fix answers for --json |
| `forja build` when there are errors | Misleads user into running a command that will fail | No nextAction, or the fix command |
| `forja setup remote` after local setup succeeds | Pushes optional features the user didn't ask for | `forja build` (verify local works first) |
| Generic `forja status` for all failures | Doesn't tell the user what to FIX | Use diagnostic `fix` field or specific command |
| Hardcoded nextAction in list/view commands | Suggests same action regardless of current state | Toggle: suggest the alternative to current value |
| Same nextAction for "nothing exists" and "already done" | User who already configured gets "run setup" | State-aware: nothing→setup, in-progress→configure, done→status |

## State-Aware nextAction on Success Paths

nextAction should also adapt to current state on **success** paths, not just failure paths.

```typescript
// BUG: always suggests 'use target' even when target is already selected
nextAction: targets.length === 0 ? 'forja setup' : 'forja use target --project <path>'

// CORRECT: guide to selection after listing
if (targets.length === 0) {
    nextAction = 'forja use target';           // Nothing to work with
} else {
    nextAction = 'forja use target --project <name|path>';  // Select or change
}
```

### Success-Path Decision Matrix

| Command | State | Correct nextAction | Why |
|---------|-------|--------------------|-----|
| `list targets` | No targets exist | `forja use target` | Need to initialize |
| `list targets` | Targets exist (any selection state) | `forja use target --project <name\|path>` | After seeing list, natural next step is selection |
| `list config` | Nothing configured | `forja setup` | Need to initialize |
| `list config` | Only sync/remote, no target | `forja use target --project <path>` | Need to select target |
| `list config` | Target configured | `forja status` | Already configured, verify readiness |

### Rule

When a list/config command succeeds, the nextAction should answer: **"Given what the user just saw, what's the most useful next step?"** — not a hardcoded suggestion.

After listing targets, the user's natural next action is to select or change target — even if one is already selected. Don't suggest `forja status` (readiness check) when the user is in "browsing targets" mode.

## Audit Checklist

When reviewing nextAction assignments:

- [ ] Does the nextAction match the interaction mode (interactive vs --json vs --answers)?
- [ ] Does the nextAction match what specifically went wrong?
- [ ] Is there a case where `list` is suggested but the user already saw the list?
- [ ] Is there a case where the same generic nextAction is used for different failure types?
- [ ] Are nextActions from sub-functions propagated (not overridden)?
- [ ] For list/view commands showing current state: does nextAction suggest the toggle/alternative, not a hardcoded value?
- [ ] For success paths: does nextAction adapt to current state (nothing→setup, partial→configure, done→status)?
- [ ] **No self-referencing**: nextAction never points to the command the user is already running
- [ ] **No circular loops**: A→B→A chains are eliminated
- [ ] **Most helpful command**: fix/nextAction points to the command that solves the problem most completely (e.g., `forja setup remote` over `forja server` when server needs to be created)
- [ ] **JSON mode choices**: when config is missing in JSON mode, return `choices` array instead of pointing to a command that requires interactive input
- [ ] **Context-aware diagnostics**: diagnostics only appear when relevant to the user's mode (e.g., no sync hints for local-only users)

## The `choices` Pattern for AI-Guided Multi-Option Scenarios

When a command cannot determine a single correct nextAction because the user must choose between fundamentally different paths, return a `choices` array instead of a single `nextAction`. This lets the AI agent present options to the user rather than guessing.

### When to Use `choices`

Use `choices` when:
- The workspace is completely uninitialized (could be local or remote setup)
- Sync config is missing (could configure independently or via full remote setup)
- Any scenario where there are 2+ fundamentally different paths forward, and the right choice depends on user intent

### Implementation

```typescript
// StatusResult interface
choices?: Array<{ label: string; command: string; description: string }>;

// When no single nextAction is correct
if (!activeTarget && readiness.toolchain === 'unknown') {
    result.nextAction = undefined;  // No single action
    result.choices = [
        { label: 'forja setup', command: 'forja setup', description: T('statusSetupLocal') },
        { label: 'forja setup remote', command: 'forja setup remote', description: T('statusSetupRemote') },
    ];
}
```

### Text Mode Rendering

When `nextAction` is undefined but `choices` is present, show all options:

```typescript
if (result.nextAction) {
    lines.push(T('next'));
    lines.push(`  ${result.nextAction}`);
} else if (result.choices) {
    lines.push(T('next'));
    for (const c of result.choices) {
        lines.push(`  ${c.label}  (${c.description})`);
    }
}
```

### Rules

1. **`choices` replaces `nextAction`, not supplements it** — when `choices` is present, `nextAction` should be `undefined`
2. **Each choice must be a complete, runnable command** — the AI or user can execute it directly
3. **Descriptions should be concise** — one phrase explaining what this path does
4. **Limit to 2-4 choices** — more options become overwhelming
5. **Text mode must also show choices** — human users need the same information as AI
