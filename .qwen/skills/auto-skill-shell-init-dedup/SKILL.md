---
name: shell-init-dedup
description: When concatenating shell command groups (e.g. qmake + build), deduplicate environment init (PATH, VsDevCmd, cd) to avoid exceeding command line length limits
source: auto-skill
extracted_at: '2026-07-07T08:23:30.828Z'
---

# Shell Command Init Deduplication

## Problem

When multiple shell command groups are concatenated into a single command line (e.g. `qmake && build`), each group may independently include environment initialization commands (PATH setup, VsDevCmd.bat, cd to project dir). This duplicates the init, wasting command line length — and on Windows, can exceed cmd.exe's 8191 character limit ("输入行太长").

## Pattern

Each command group is assembled as: `[init_commands..., cd_command, action_command]`. When two groups are concatenated:

```
[init, cd, qmake] + [init, cd, build] → [init, cd, qmake, init, cd, build]
```

The second `init, cd` is redundant since the first already set up the environment.

## Fix

1. **Expose init commands separately** on the builder interface (e.g. `initCommands(cfg)` returning `[...envInit, cdCommand]`)
2. **When combining**, slice the init prefix off the second group:
   ```typescript
   const initLen = shellBuilder.initCommands(cfg).length;
   commands = [...firstCmds, ...secondCmds.slice(initLen)];
   ```
3. **Only dedup when safe** — if intermediate commands (e.g. rcc) may change the working directory, keep the second group's `cd` to restore the correct directory:
   ```typescript
   const deduped = (hasIntermediateCmds) ? secondCmds : secondCmds.slice(initLen);
   ```

## Checklist

- [ ] Identify all concatenation points where command groups are combined
- [ ] Verify each concatenation: are there intermediate commands that change cwd?
- [ ] If yes → don't dedup (or only strip env init, keep cd)
- [ ] If no → safe to slice off init prefix from second group
- [ ] Measure resulting command length against platform limits (Windows: 8191 chars)

## Anti-pattern

Don't just dedup by string matching or counting `&&` separators — use the known init command count from the builder. This is precise and doesn't break when command content changes.
