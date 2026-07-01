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

## Anti-Patterns

| Anti-pattern | Why it's wrong | Correct approach |
|-------------|---------------|-----------------|
| `forja list targets` for all ambiguous cases | Redundant in interactive mode (user just saw the list); wrong for incomplete answers | Match to mode: retry for interactive, fix answers for --json |
| `forja build` when there are errors | Misleads user into running a command that will fail | No nextAction, or the fix command |
| `forja setup remote` after local setup succeeds | Pushes optional features the user didn't ask for | `forja build` (verify local works first) |
| Generic `forja status` for all failures | Doesn't tell the user what to FIX | Use diagnostic `fix` field or specific command |

## Audit Checklist

When reviewing nextAction assignments:

- [ ] Does the nextAction match the interaction mode (interactive vs --json vs --answers)?
- [ ] Does the nextAction match what specifically went wrong?
- [ ] Is there a case where `list` is suggested but the user already saw the list?
- [ ] Is there a case where the same generic nextAction is used for different failure types?
- [ ] Are nextActions from sub-functions propagated (not overridden)?
