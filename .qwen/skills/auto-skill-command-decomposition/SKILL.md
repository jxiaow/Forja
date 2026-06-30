---
name: command-decomposition
description: Split monolithic CLI commands into focused subcommands by separating concerns (e.g. local vs remote, init vs config)
source: auto-skill
extracted_at: '2026-06-30T11:16:26.139Z'
---

# Command Decomposition

When a CLI command accumulates too many responsibilities (many flags, overlapping with other commands, different concerns mixed), split it into focused subcommands.

## Signs a Command Needs Decomposition

- **Flag explosion**: 5+ flags that only apply to some code paths
- **Overlap**: Same operation available via two different commands
- **Escape hatches**: Flags like `--local-only` that negate half the command's work
- **Mixed concerns**: One-time initialization mixed with ongoing configuration

## Procedure

### 1. Identify the split axis

Find the natural seam — what concerns are mixed?
- Local vs remote → `setup` / `setup remote`
- Init vs config → `setup` / `use`
- View vs edit → `list` / `use`

### 2. Design the subcommands

Each subcommand should have:
- **Minimal flags** — only flags relevant to its concern
- **Clear responsibility** — one job, done well
- **No overlap** — if two commands do the same thing, one is wrong

Example:
```
Before: forja setup --local-only --host X --username Y --server Z --remote-path P --plan --json
After:  forja setup [--plan --json]
        forja setup remote [--plan --json]
```

### 3. Handle the shared logic

- Extract shared code into internal functions (e.g., `runInit` used by both local and remote)
- Each subcommand calls the shared functions it needs
- Don't duplicate logic between subcommands

### 4. Design the interaction flow

**Responsibility chain** — each command only points to the NEXT step:
```
setup → "run `forja list targets`" → list → "run `forja use target`" → use → "run `forja build`"
```

Rules:
- Don't skip steps (setup shouldn't tell you to `use target` directly)
- Don't enumerate (that's `list`'s job)
- `nextAction` is singular — point to the most blocking issue
- When diagnostics exist, they contain the command to resolve them
- When no diagnostics, `nextAction` gives the happy-path next step

### 5. Interactive vs non-interactive

```
isInteractive = !options.json && process.stdin.isTTY === true
```

| Mode | Behavior |
|------|----------|
| Interactive (TTY, no --json) | Prompt for choices, show plan, confirm |
| Non-interactive (--json or pipe) | Auto-select or report ambiguous, no prompts |

Non-interactive ambiguous case:
```json
{
  "ok": true,
  "ambiguous": true,
  "diagnostics": [{ "level": "info", "message": "Found 2 targets. forja list targets" }],
  "nextAction": null
}
```

### 6. Implementation checklist

- [ ] Split the main function into `runXxx` + `runXxxSub`
- [ ] Separate interfaces (XxxOptions, XxxResult) for each subcommand
- [ ] Update dispatcher to route subcommands (check first positional arg)
- [ ] Remove flags that belong to other commands
- [ ] Update text formatters for each subcommand
- [ ] Update translation keys
- [ ] Update tests (split monolithic tests to match new structure)
- [ ] Rebuild CLI package for integration tests
- [ ] Update documentation (spec, command-api, help text)

## Anti-patterns

- **God command**: One command that does everything with 10+ flags
- **Escape hatch flags**: `--skip-remote`, `--local-only` — sign the command does too much
- **Overlapping commands**: Two commands that can do the same thing
- **Multi-step nextActions**: If you need to tell the user to run 3 commands, your command is doing too little or too much
