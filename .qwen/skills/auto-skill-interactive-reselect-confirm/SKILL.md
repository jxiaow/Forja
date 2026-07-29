---
name: interactive-reselect-confirm
description: When a config command has an existing selection, interactive mode must show current value and confirm before entering selection flow — don't silently reuse or always prompt
source: auto-skill
extracted_at: '2026-07-06T02:53:29.324Z'
---

# Interactive Re-selection with Confirm

When a configuration command (e.g., `use target`, `use server`) has an existing selection and the user runs it interactively without flags, the command must:

1. **Show the current selection** — display what's currently configured
2. **Ask if the user wants to change** — `confirm('Change target?', false)` with default N
3. **Branch based on answer**:
   - **N (default)** → reuse existing, continue to next configuration step (toolchain, mode, etc.)
   - **Y** → enter the full selection flow (choose from list)

## Bug Pattern: Silently Reuse Existing

```typescript
// BUG: when hasExisting, always reuses without asking
if (!needTarget) {
    const existingProject = ctx.existingTarget?.project;
    if (existingProject) {
        const match = candidates.find(c => c.project === existingProject);
        if (match) return { value: match };  // User never gets to re-select!
    }
}
```

User runs `forja use target` to change their selection, but the command silently reuses the existing target. The user has no way to re-select without using `--project` flag or `--reset`.

## Bug Pattern: Always Prompt

```typescript
// ALSO BUG: always enters selection, even if user just wanted to update toolchain
const needTarget = !hasExisting || options.interactive;  // Wrong!
```

User runs `forja use target` to update toolchain settings, but is forced to re-select the target every time. Annoying and unnecessary.

## Correct Pattern: Confirm Before Branching

```typescript
// CORRECT: show current, ask if change, then branch
if (!needTarget) {
    const existingProject = ctx.existingTarget?.project;
    if (existingProject) {
        const match = candidates.find(c => c.project === existingProject);
        if (match) {
            if (options.interactive) {
                console.log(`  Target: ${match.label} — ${match.project}`);
                const change = await confirm(T('confirmChangeTarget'), false);
                if (!change) return { value: match };  // Reuse
                // Fall through to selection
            } else {
                return { value: match };  // Non-interactive: reuse
            }
        }
    }
}
// Continue to selection flow...
```

## Rules

1. **Interactive mode with existing config → confirm** — don't silently reuse, don't always prompt. Show current value and ask Y/N.

2. **Default to N (reuse)** — most users running the command without flags want to update other settings (toolchain, mode), not change the target. Changing target is the less common case.

3. **Non-interactive mode → reuse** — JSON/script mode without `--project` flag should reuse existing. If they want to change, they use `--project <path>`.

4. **Show enough context** — display both the label and path/identifier so the user knows what they're keeping or changing.

5. **Apply to all config commands** — this pattern applies to `use target`, `use server`, `remote set`, etc. Any command that has an existing selection and can be run to change it.

## Why This Matters

- **Silent reuse** frustrates users who want to change — they can't figure out how to re-select
- **Always prompt** frustrates users who want to update other settings — they're forced through unnecessary selection
- **Confirm with default N** satisfies both: users who want to change can say Y, users who want to keep can say N (or just press Enter)

## Audit Checklist

When reviewing config commands with existing selections:

- [ ] Does interactive mode show the current selection?
- [ ] Does it ask Y/N before entering selection flow?
- [ ] Is the default N (reuse)?
- [ ] Does non-interactive mode reuse without prompting?
- [ ] Can users still change via explicit flag (`--project`, `--server`, etc.)?
