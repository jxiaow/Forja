---
name: write-commands-delegate-to-status
description: After a write command (use target, setup), nextAction should point to the status/readiness command — not duplicate its validation logic
source: auto-skill
extracted_at: '2026-07-06T02:32:51.910Z'
---

# Write Commands Delegate to Status for Next Action

After a write command modifies configuration, its `nextAction` should point to the **status/readiness command** (e.g., `forja status`) — the single source of truth for "what to do next". Write commands should NOT try to duplicate the validation logic that the status command already performs.

## Anti-Pattern: Write Command Duplicates Validation

```ts
// WRONG: use target tries to determine if build is ready
const toolchainReady = config.qtPath && (os.platform() !== 'win32' || config.vsInstall);
const makefileOk = validateMakefile(...);
nextAction: toolchainReady && makefileOk ? 'forja build' : 'forja build qmake'
```

This creates inconsistency: `use target` and `status` may give different next actions because they run independent validations.

## Correct Pattern: Point to Status

```ts
// RIGHT: use target just says "check status"
nextAction: 'forja status'
```

`status` already does all validation (Makefile, toolchain readiness, sync state, etc.) and derives the correct next action. No need to duplicate.

## Rules

1. **Write commands (use, setup, config) → nextAction = status** — after modifying config, the user should check the consolidated readiness view
2. **Status is the single source of truth** — it aggregates all readiness checks and derives the correct next action
3. **Don't duplicate validation** — write commands don't need to check Makefile, toolchain paths, sync state, etc. just to suggest a next action
4. **Read commands can suggest write commands** — `status` → `forja build`, `list targets` → `forja use target` — this direction is fine because it's moving from info to action

## Flow

```
use target (write) → status (read/validate) → build (action)
     ↓                      ↓
  "check status"      "run build" / "fix X first"
```

## Audit Checklist

- [ ] Does `use target` nextAction point to `forja status`?
- [ ] Does `setup` nextAction point to `forja status`?
- [ ] Does `status` nextAction point to the correct action command (`forja build`, `forja doctor`, etc.)?
- [ ] Are there no parallel validation paths between write commands and status?
