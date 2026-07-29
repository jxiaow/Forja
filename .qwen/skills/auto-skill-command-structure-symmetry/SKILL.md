---
name: command-structure-symmetry
description: Write commands (use/setup/server) can have subcommands; read/list commands must stay flat — don't add subcategories just for symmetry
source: auto-skill
extracted_at: '2026-07-02T03:15:00.000Z'
---

# Command Structure: Write vs Read Asymmetry

Write commands and read commands have different user intents. Do NOT enforce structural symmetry between them.

## Core Principle

- **Write commands** (`use`/`setup`/`server`): subcommands are good — users need precise targeting of what to modify
- **Read/list commands** (`list`/`status`): stay flat — one command shows everything, don't split into subcategories

**Why:** User rejected symmetric subcategories for `list remote`: "命令变多了，谁记得住啊" (more commands, who can remember them all?). Write subcommands make sense because the user must point at a specific thing to change. Read commands exist to "give me everything" — splitting them into 5 subcategories just increases memory burden.

## Correct Pattern

```
# Write side — subcommands for precision
forja use remote workspace    → sets remote workspace
forja use remote repo         → sets repo mapping
forja use remote build-order  → sets build order
forja use remote transfer     → sets deploy config
forja use remote forja-bin    → sets forja binary path

# Read side — flat, one command shows all
forja list remote             → shows ALL remote config in one view
```

## Management Commands: Read Belongs Under the Noun

When a noun command manages CRUD (add/update/remove), the list/view operation also belongs under that noun — not under a separate `list` command:

```
# Wrong: view is under a different command
forja server add/update/remove    → CRUD
forja list servers                → view        ← orphaned under list

# Correct: view is under the noun command
forja server                      → list all (no subcommand = default view)
forja server --detail <id>        → view single
forja server add/update/remove    → CRUD
```

Pattern: `git remote` (no args = list), `git remote add`, `git remote remove`.

## What Doesn't Belong Under `list`

### Single-value reads

A `list` command must enumerate **multiple items**. If it only shows a single value, it doesn't belong under `list`:

```
forja list lang    → "Language: zh"     ← NOT a list, it's a read-value
```

**Decision**: Keep if there's no better home and the value is genuinely useful to look up. Don't delete just because it's "not a list".

### Shallow-copy summaries

A `list` command shouldn't be a shallow copy of other list commands:

```
forja list config
  Qt: configured         → run `list targets` for details
  SDK: not configured    → run `list targets` for details
  Sync: configured       → run `list remote` for details
```

**Fix**: Remove the shallow-copy command. `forja status` already provides a better overview (answers "can it work?" not just "what is configured").

## Convention-named files use parent directory as label

When scanning for project files, files with convention names (no distinguishing stem) should use the parent directory as their display label:

| File | Label (wrong) | Label (correct) |
|------|--------------|-----------------|
| `CMakeLists.txt` | `CMakeLists` | Parent directory name |
| `Makefile` | `Makefile` | Parent directory name |
| `app.pro` | `app` | `app` (already has a stem) |
| `project.sln` | `project` | `project` (already has a stem) |

```typescript
const fileName = path.basename(file).toLowerCase();
const dirName = path.basename(path.dirname(file));
const isConventionName = fileName === 'cmakelists.txt' || fileName === 'makefile';
const label = isConventionName
    ? (dirName && dirName !== '.' ? dirName : path.basename(workspace))
    : path.basename(file, path.extname(file));
```

## Anti-Patterns

| Anti-pattern | Why it's wrong | Correct approach |
|-------------|---------------|-------------------|
| Adding subcategories to `list` to mirror `use` subcommands | Increases memory burden; read intent is "show all" not "pick one" | Keep `list` flat, improve output formatting with clear sections |
| View/list under a separate command from CRUD noun | `forja list servers` is orphaned from `forja server add/remove` | Move view to the noun command: `forja server` (no args = list) |
| `list <x>` is a shallow copy of other list commands | Users still need to run specific commands for details | Remove; use `status` for overview |
| Convention-named files use filename as label | `CMakeLists` or `Makefile` doesn't distinguish projects | Use parent directory name |
