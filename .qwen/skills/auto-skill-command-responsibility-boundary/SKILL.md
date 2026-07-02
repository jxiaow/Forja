---
name: command-responsibility-boundary
description: CLI commands must not duplicate other commands' functionality — when prerequisites are missing, redirect via diagnostic fix fields instead of inlining the logic
source: auto-skill
extracted_at: '2026-07-01T02:45:07.909Z'
---

# Command Responsibility Boundary

A CLI command must only handle its own responsibility. When a prerequisite from another command's domain is missing, handle it via redirect, inline prompt, or phase inclusion — but never duplicate flags.

## Core Rule

> Do NOT add **flags** that duplicate another command's interface. Instead, either:
> 1. Redirect via diagnostic `fix` field (non-interactive default)
> 2. Prompt inline in interactive mode (one-stop convenience)
> 3. Include the parent command's full flow as a phase (一体化)

## Why

- **Duplication drifts** — two implementations of the same thing will diverge over time
- **Flag explosion** — adding `--host`/`--username`/`--port` to `setup remote` turns a focused command into a god command
- **User confusion** — when the same operation is available two different ways, users don't know which to use
- **Command symmetry** — users learn the command vocabulary; each command should do one thing well

## Three Ways to Handle Cross-Command Concerns

### 1. Redirect via diagnostic (non-interactive default)

```typescript
if (existingServers.length === 0 && !isInteractive) {
    diagnostics.push({ level: 'error', message: T('setupNoServer'), fix: 'forja server add' });
    result.nextAction = 'forja server add';
}
```

### 2. Inline interactive prompt (one-stop convenience)

In interactive mode, prompt for missing data inline — don't force the user to exit and run another command:

```typescript
if (existingServers.length === 0 && isInteractive) {
    const host = await prompt('Host address');
    const username = await prompt('Username');
    const server = addServer({ host, username, ... });
    // Continue with created server...
}
```

This is NOT duplicating `server add` — it's inline convenience for one-stop setup. The `server add` command still exists for explicit server management.

### 3. Include parent flow as phase (一体化)

A subcommand can include the parent command's full flow. Real example — `forja setup remote` includes `forja setup` as Phase 1:

```
forja setup remote:
  Phase 1: scan targets → detect toolchain → select → save local config  (same as `forja setup`)
  Phase 2: detect server → derive path → deploy → init → switch mode
```

This is appropriate when:
- The subcommand **depends on** the parent's output (remote init needs to know target kind from local scan)
- The user expects **one-stop** initialization (run once, get everything configured)
- The parent command is **idempotent** (safe to re-run as part of the larger flow)

Implementation: call the parent function directly, not via CLI dispatch:

```typescript
// Phase 1: local init
const initResult = await runInit(workspace, { interactive: isInteractive, ... });
result.steps.localConfig = initResult.ok ? 'done' : 'failed';

// Phase 2: remote config (uses initResult.detected to determine target kind)
const resolved = await resolveServer(workspace, options, isInteractive, diagnostics);
// ... deploy, init, switch using activeTarget from Phase 1
```

## Checklist When Adding Flags to a Command

Before adding a new flag, ask:

1. **Does another command already handle this?** → Don't add the flag; redirect or prompt inline
2. **Is this a one-time setup or ongoing config?** → Setup belongs in `setup`/`server add`; ongoing config belongs in `use`
3. **Am I adding flags to avoid a two-step workflow?** → In interactive mode, inline prompts are fine. In script mode, flags are fine. Don't add flags just for interactive convenience.

## Diagnostic Design for Missing Prerequisites

| Prerequisite missing | Diagnostic level | fix | nextAction |
|---------------------|-----------------|-----|------------|
| No server exists | `error` | `forja server add` | `forja server add` |
| Multiple servers, none selected | `error` | _(message says use --server)_ | `forja list servers` |
| Server ID not found | `error` | _(message says not found)_ | `forja list servers` |
| No target configured | `error` | `forja setup` | `forja setup` |
| Multiple targets, none selected | `info` | _(message says ambiguous)_ | `forja list targets` |

## When to Apply

- Designing a new CLI command or subcommand
- Adding flags to an existing command
- Reviewing whether a command's scope is too broad
- When a user says "this overlaps with X command" or "this should point to X instead"

## Clear/Reset Operations Must Stay in Their Lane

A `clear` or `reset` subcommand must only clear the data it owns. It must NOT cascade-clear data managed by sibling subcommands.

**Bug example:** `forja use remote workspace clear` was clearing `remote.repos = []` alongside workspace settings. But repos are managed by `forja use remote repo clear` — a separate subcommand. Users who ran `workspace clear` lost their repo mappings unexpectedly.

**Rule:** When implementing a clear operation, list exactly which fields it should reset. Cross-reference against sibling subcommands — if another subcommand owns a field, don't touch it.

```typescript
// WRONG: workspace clear nukes repos too
if (action === 'clear') {
    remote.workspaceMode = 'legacy';
    remote.remoteWorkspace = '';
    remote.profile = '';
    remote.repos = [];  // ← belongs to `repo clear`, not `workspace clear`
}

// CORRECT: only clear workspace-owned fields
if (action === 'clear') {
    remote.workspaceMode = 'legacy';
    remote.remoteWorkspace = '';
    remote.profile = '';
    // repos are cleared by `forja use remote repo clear`
}
```
