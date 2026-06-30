---
name: cli-view-edit-separation
description: CLI viewing commands (list) and editing commands (use) must be separate — never mix read and write in one command
source: auto-skill
extracted_at: '2026-06-24T09:15:37.238Z'
---

# CLI View/Edit Separation

Read-only queries and state-changing operations must use different commands. Never overload an "edit" command with "view" functionality, and never create a new top-level command for a single setting.

## Principles

### 1. `list` is for viewing, `use` is for editing

- `forja list <category>` — read-only, shows current state
- `forja use <target> <value>` — writes config, changes state

Do NOT make `forja use lang` (no args) show the current language. `use` implies "set this". For viewing, route to `forja list lang`.

**Anti-pattern:**
```
forja use lang       → shows "Current language: zh"  (confusing — use is for setting)
```

**Correct:**
```
forja list lang      → shows "语言：zh"              (list = view)
forja use lang zh    → sets language to zh            (use = edit)
```

### 2. Don't create new top-level commands for single settings

When a user wants to configure a single setting (like language), don't create `forja config` as a new top-level command. Instead, add it as a subcommand of an existing semantically-matching command.

**Anti-pattern:**
```
forja config lang zh    → new top-level command just for one setting
```

**Correct:**
```
forja use lang zh       → reuses existing 'use' command
```

Only create a new top-level command when there are enough related settings to form an independent domain.

### 3. Help text must distinguish view vs edit

When a setting has both view and edit paths, the help text for the edit command should point to the view command:

```
forja use lang <zh|en>   Set language (view: forja list lang)
```

## Design Pattern

For each user-configurable setting:

| Concern | Command | Example |
|---------|---------|---------|
| View current value | `forja list <setting>` | `forja list lang` |
| Change value | `forja use <setting> <value>` | `forja use lang zh` |
| Help text cross-reference | In `use --help` | "view: forja list lang" |

## Checklist

- [ ] Does viewing a setting go through `list`, not `use`?
- [ ] Does `use <setting>` without a value produce an error pointing to `list <setting>`?
- [ ] Is the setting a subcommand of an existing command, not a new top-level command?
- [ ] Does the `use` help text mention where to view the current value?
