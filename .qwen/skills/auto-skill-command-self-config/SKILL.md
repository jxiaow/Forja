---
name: command-self-config
description: Commands that require prerequisite configuration should handle it inline — don't force users to jump to a different command first
source: auto-skill
extracted_at: '2026-07-02T10:34:28.727Z'
---

# Command Self-Configuration Pattern

When a command requires prerequisite configuration (e.g., selecting a server, setting a path), the command itself should accept and save that configuration — not force users through a separate setup command first.

## Anti-pattern
```
forja server add --name x --host y ...     # step 1: create server
forja use sync --server x --remote-path /p  # step 2: configure sync
forja use sync --enable                     # step 3: enable
forja sync                                  # step 4: finally sync
```

## Correct pattern
```
forja sync --server x --remote-path /p      # one step: configure + sync
```

## Rules

1. **The doing command owns configuration**: If `forja sync` needs a server, `forja sync --server` should work — don't require `forja use sync --server` first.
2. **Accept config flags alongside action**: `--server`, `--remote-path` etc. on the action command save config AND perform the action in one invocation.
3. **Interactive guidance when config missing**: In TTY mode, if prerequisites are missing, guide the user inline (prompt to create/select server, input path) rather than erroring with "run X first".
4. **JSON mode: error with precise nextAction**: In non-interactive mode, return an error with the exact command needed (e.g., `forja server add --name <name> --host <host>`).
5. **Keep internal API for cross-command reuse**: The config-saving function (e.g., `configureSyncSettings`) should be reusable by other commands (e.g., `setup remote`) — extract it as a shared utility, don't duplicate logic.
6. **Remove the old separate entry**: Once the action command handles its own config, delete the separate configuration command's CLI dispatch (e.g., remove `case 'sync'` from `handleUse`). Keep the underlying function if other internal callers need it.
7. **Update all nextAction/fix references**: Audit all `nextAction`, `fix`, hint text, and translation keys across the codebase — they must point to the new self-configuring command, not the removed separate command.

## Example: forja sync redesign

- `forja sync --server <name> --remote-path <path>` → saves config (selectedServer, remotePaths, enabled=true) then syncs
- `forja sync` (TTY, no config) → interactive: create/select server → input remote-path → sync
- `forja sync --json` (no config) → error with `nextAction: "forja server add ..."`
- `forja use sync` → removed from CLI dispatch; `runUseSync()` kept as internal API for `setup.ts`

## Checklist when applying

- [ ] Identify which command "does the thing" — that command should also handle its own setup
- [ ] Add config flags (--server, --remote-path, etc.) to the action command
- [ ] **Validate subcommands BEFORE config logic** — unknown subcommand rejection must happen before any config setup or interactive prompts. Otherwise `forja sync status` (unknown) triggers server selection prompts before being rejected.
- [ ] Add interactive guidance for TTY mode when config is missing
- [ ] Ensure JSON mode returns clear nextAction for missing prerequisites
- [ ] Remove the separate config command's CLI dispatch
- [ ] Update all nextAction/fix/hint references globally (grep for old command)
- [ ] Update translation keys for affected messages
