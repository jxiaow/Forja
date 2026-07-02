---
name: use-list-convention
description: Settings use `forja use <x>` to set and `forja list <x>` to view — noun commands (server) own their own listing — `list` is for enumeration only
source: auto-skill
extracted_at: '2026-06-26T04:19:06.345Z'
---

# Use/List Convention for Settings

All user-facing settings follow a strict two-command convention:

- **Initial setup**: `forja setup` — one-stop initialization (local + remote), replaces `forja init`
- **Set/change**: `forja use <setting> <value>` — reuses the existing `use` command
- **View/current**: `forja list <setting>` — reuses the existing `list` command

## Rules

1. **No new top-level commands for single settings** — Don't create `forja config`, `forja settings`, `forja show`, etc. for individual settings. The user explicitly rejected `forja config lang` in favor of `forja use lang`.

2. **`setup` is the one-stop entry** — `forja setup` handles local detection + remote configuration + deployment + verification in one flow. It's idempotent — re-running shows current values and lets user modify.

3. **`use` is for changing, `list` is for viewing** — Clear separation of concerns.

4. **Max 2 levels of nesting** — `forja use remote workspace --path /xxx` is OK. `forja use remote workspace set --path /xxx` is NOT (3 levels). Use `--clear` flag instead of `clear` subcommand.

5. **Noun commands own their listing** — When a top-level noun command manages CRUD (e.g. `forja server add/update/remove`), the list/view operation belongs under that noun, not under `list`. Pattern: `git remote` (no args = list).

6. **`list` is for enumeration only** — Don't put single-value reads or shallow-copy summaries under `list`. Use `forja status` for overview.

## Command Surface

### Setup (replaces init)
```
forja setup                              # One-stop: local + remote
forja setup --local-only                 # Local only
forja setup --host <ip> --username xw    # Non-interactive with remote
```

### Use (2-level max)
```
forja use remote --server <id>                          # Switch server
forja use remote --remote-path <path>                   # Change remote path
forja use remote workspace --path <path> [--mode staged] # Set workspace
forja use remote build-order qt:build sdk:build         # Set build order
forja use remote transfer --server <id> --path <path>   # Set deploy transfer
forja use remote workspace --clear                      # Clear (flag, not subcommand)
```

### List (enumeration only)
```
forja list targets      # List Qt/SDK project candidates
forja list env          # List toolchain environment (qt/vs/jom/make)
forja list env qt       # Qt environment detail
forja list remote       # Full remote config (workspace/bin/build-order/transfer/repos)
forja list lang         # Current language setting
```

### Noun commands (own their listing)
```
forja server                # List all servers (no subcommand = default view)
forja server --detail <id>  # View single server detail
forja server add            # Add server
forja server update <id>    # Update server
forja server remove <id>    # Remove server
```

## What Does NOT Belong Under `list`

- **`list config`** — removed; shallow copy of other list commands. `forja status` provides better overview.
- **`list servers`** — moved to `forja server` (noun command owns its listing).

## Storage

- **Global settings** (like language): `~/.forja/config.json` via `loadGlobalConfig()` / `saveGlobalConfig()`
- **Workspace settings** (like target, mode): `~/.forja/projects/<hash>.json` via `loadQtSettings()` / `saveQtSettings()` etc.

## Why

User rejected `forja config` as a top-level command: "有config命令？" — the command surface should not grow for single settings. User also rejected 3-level nesting: "use remote workspace set" → simplified to "use remote workspace --path". The `--clear` flag replaces the `clear` subcommand to reduce command count. User also rejected `list servers` because `server` is already a top-level noun command managing CRUD — listing should be under the noun, not orphaned under `list`.
