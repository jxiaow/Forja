---
name: cli-plan-first-confirm
description: CLI commands that modify remote/external state must show a plan and confirm before executing — not directly run
source: auto-skill
extracted_at: '2026-06-29T11:36:58.538Z'
---

# CLI Plan-First Confirmation

CLI commands that modify remote or external state (upload files, delete resources, deploy, etc.) must NOT directly execute by default. The user must see what will happen and confirm.

## Pattern

```
Interactive (TTY, no --json):
  1. Run plan/dry-run internally
  2. Show summary to user
  3. If nothing to do → print "nothing to do" and exit
  4. Ask confirmation [y/N] (default N for safety)
  5. If confirmed → execute
  6. If declined → print "cancelled" and exit

Automation (--json or non-TTY):
  → Execute directly, return JSON result
```

## Implementation

```typescript
// In the command handler:
if (action === 'run' && !wantsJson && !hasFlag(argv, '--yes')) {
    // 1. Run plan first
    const plan = await runPlan(workspace, options);
    if (!plan.ok) { outputResult(plan, ...); return; }

    // 2. Check if there's anything to do
    if (plan.pendingCount === 0) {
        console.log(T('nothingToDo'));
        return;
    }

    // 3. Show plan summary
    console.log(formatPlanText(plan, locale));
    console.log();

    // 4. Confirm
    const yes = await confirm(T('confirmMessage'), false);
    if (!yes) {
        console.log(T('cancelled'));
        return;
    }
}

// 5. Execute directly (or directly if --json / --yes)
const result = await runExecute(workspace, options);
outputResult(result, wantsJson, ...);
```

## Key Rules

1. **`--json` = direct execution** — automation/AI scripts need no confirmation
2. **`--yes` / `-y` = skip confirmation** — human-readable output without interactive prompt (for scripts that don't need JSON)
3. **Interactive = plan + confirm** — human users see what will happen first
4. **Empty plan = no prompt** — if nothing to do, just say so and exit
5. **Default answer is N** — safer default for destructive operations
6. **`--plan` / subcommand `plan` still works** — explicit dry-run is always available
7. **Use existing `confirm()` utility** from `cli/commands/prompt.ts`
8. **No double-plan** — handler runs plan once, then calls the execute function directly (not through the dispatcher which would re-plan). Use standalone action functions (`runSyncPlan`, `runSyncExecute`) not a monolithic `runSync(action)`.

## When to Apply

Any CLI command that:
- Uploads/deletes files on a remote server
- Modifies external system state (deploy, provision, clean remote)
- Performs irreversible or hard-to-undo operations

Does NOT apply to:
- Read-only commands (list, status, plan)
- Local-only operations that are trivially undoable
- Commands where the user explicitly opted into execution (e.g., `--execute` flag)

## Checklist

- [ ] Does the command modify remote/external state?
- [ ] If yes, does the non-JSON path show a plan before executing?
- [ ] Is confirmation [y/N] with default N?
- [ ] Does `--json` skip confirmation and execute directly?
- [ ] Does `--yes` skip confirmation but still produce human-readable output?
- [ ] Is the "nothing to do" case handled without prompting?
- [ ] Are plan and execute implemented as separate functions (no double-plan)?
- [ ] Is `--yes` in the known flags set for `findUnknownFlags`?
