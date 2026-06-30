---
name: use-list-convention
description: Settings use `forja use <x>` to set and `forja list <x>` to view — `forja setup` is the one-stop init entry, `use remote` is 2-level max
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

5. **`list remote-repos` merged into `list remote`** — Don't create separate list categories for closely related data.

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

### List (merged categories)
```
forja list remote     # Shows full remote config INCLUDING repo mappings
forja list servers    # Shows configured servers
forja list env qt     # Scan available Qt installations (requires sub-category)
forja list env vs     # Scan available VS installations (requires sub-category)
forja list env        # ERROR — sub-category required
```

## Storage

- **Global settings** (like language): `~/.forja/config.json` via `loadGlobalConfig()` / `saveGlobalConfig()`
- **Workspace settings** (like target, mode): `~/.forja/projects/<hash>.json` via `loadQtSettings()` / `saveQtSettings()` etc.

## Why

User rejected `forja config` as a top-level command: "有config命令？" — the command surface should not grow for single settings. User also rejected 3-level nesting: "use remote workspace set" → simplified to "use remote workspace --path". The `--clear` flag replaces the `clear` subcommand to reduce command count.
