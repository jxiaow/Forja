---
name: help-text-structure
description: CLI help text must separate command-specific usage patterns from truly global options, and use template literals in code
source: auto-skill
extracted_at: '2026-07-02T11:35:55.393Z'
---

# Help Text Structure

CLI `--help` output must clearly separate what the command does (usage patterns) from global flags (options).

## Rules

1. **Usage section = command-specific patterns**: Every way to invoke the command goes here — subcommands, action-specific flags, flag combinations. Each line is a complete usage example.
2. **Options section = truly global flags only**: Only flags that apply to ALL commands (like `--json`) go here. Command-specific flags (`--server`, `--file`, `--yes`) belong in Usage as part of complete examples.
3. **Code format = template literals**: In translation keys, use backtick template strings with real line breaks, not `\n` escape sequences. This matches the existing pattern (see `help.setup`).

## Anti-pattern
```
Usage: forja sync [plan|reset] [options] [--json]

  forja sync                    Sync changed files
  forja sync plan               Preview changes

Options:
  --server <name>               Select server      ← command-specific, belongs in Usage
  --remote-path <path>          Remote path         ← command-specific, belongs in Usage
  --file <path>                 Sync specific file  ← command-specific, belongs in Usage
  --yes                         Skip confirmation   ← command-specific, belongs in Usage
  --json                        JSON output         ← global, stays in Options
```

## Correct pattern
```
Usage:
  forja sync                                        Sync changed files (interactive confirm)
  forja sync --server <name> --remote-path <path>   Configure server and sync
  forja sync --yes                                  Skip confirmation
  forja sync plan                                   Preview pending changes
  forja sync status                                 Show sync configuration
  forja sync reset                                  Clear sync state
  forja sync --file <path>                          Sync specific file (repeatable)

Options:
  --json                                  JSON output
```

## Code format

```typescript
// ✅ Correct — template literal with real line breaks
'help.sync': {
    en: `Usage:
  forja sync                    Sync changed files
  forja sync plan               Preview changes

Options:
  --json                        JSON output`,
    zh: `用法:
  forja sync                    同步变更文件
  forja sync plan               预览待同步文件

选项:
  --json                        JSON 格式输出`,
},

// ❌ Wrong — \n escape sequences in single-quoted string
'help.sync': {
    en: 'Usage: forja sync [plan|reset]\n\n  forja sync ...\n  forja sync plan ...',
},
```

## Checklist

- [ ] All command-specific flags shown as complete usage lines, not isolated in Options
- [ ] Only truly global flags (--json, --locale) in Options section
- [ ] Template literals (backticks) used in code, not \n escapes
- [ ] Both en and zh versions updated
