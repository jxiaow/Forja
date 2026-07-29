---
name: command-surface-audit
description: Audit whether a new unified command surface fully covers all old commands and catch misclassifications
source: auto-skill
extracted_at: '2026-06-15T12:29:24.038Z'
---

# Command Surface Audit

When consolidating a large CLI command set into a smaller unified surface, systematically verify that every old command has a correct new home. Catch commands that were assigned to the wrong new command based on their actual behavior.

## When This Applies

- Consolidating N old commands into M new commands (N >> M)
- An `index.md` or mapping table already defines old→new assignments
- You need to verify the assignments are correct before implementation

## Process

### 1. Inventory All Old "View/Query" Commands

From the command inventory document, extract every command that reads/lists/checks state (not executes). Group them by their **actual behavior pattern**, not by their old command tree:

| Behavior Pattern | Description | Example Old Commands |
|-----------------|-------------|---------------------|
| File/config enumeration | Lists things that exist | `qt projects`, `sdk projects`, `sync servers` |
| Config read | Shows what was configured | `remote workspace status`, `remote build-order status` |
| Health validation | Checks if things work | `sync test-connection`, `remote test` |
| Readiness summary | Current state + next step | `qt status`, `sdk status`, `remote status` |
| Runtime state | Shows running processes | `qt ps`, `remote qt ps` |

### 2. Compare Against New Command Assignments

For each behavior pattern, check which new command the mapping table assigns it to:

- **Enumeration** → should go to `list`
- **Config read** → should go to `list` (NOT `status`)
- **Health validation** → should go to `doctor`
- **Readiness summary** → should go to `status`
- **Runtime state** → should go to `status --process`

### 3. Flag Misclassifications

The most common error: **config-read commands assigned to `status`** instead of `list`.

Example found in this project:
- `forja remote workspace status` was mapped to `forja status` — but it only reads config, doesn't check readiness
- `forja remote build-order status` was mapped to `forja status` — but it only lists a config array
- `forja remote transfer status` was mapped to `forja status` — but it only shows transfer config

These should be `forja list remote` because they answer "what is configured", not "can it be used".

### 4. Define Clear Boundaries Between Commands

Articulate the boundary as a Q&A table:

| Question | Command | Reason |
|----------|---------|--------|
| "What exists?" | `list` | Pure enumeration |
| "What is configured?" | `list` | Config read |
| "Can it be used?" | `doctor` | Health validation |
| "What is the current state?" | `status` | Readiness + nextActions |

### 5. Check for Overloaded Commands

If a new command (e.g., `status`) is absorbing too many different behavior patterns, it risks becoming a catch-all. Signs of overload:
- The command's "absorbed old commands" list includes both config reads and health checks
- The JSON output has fields for both "what is configured" and "whether it works"
- Users would need to read docs to know what kind of info they'll get

**Fix**: Split by behavior pattern. Config reads → `list <category>`. Health checks → `doctor`. Readiness → `status`.

### 6. Update All Documentation Consistently

After reclassifying commands, update:
1. The source spec (`.md`) for both affected commands
2. The mapping table in `index.md`
3. The boundary definition section (e.g., "List vs Doctor vs Status Boundary")
4. Both HTML variants (en/zh)
5. TOC sidebars in HTML if new sections were added

## Key Principles

- **Behavior over naming**: A command named `status` might actually be config enumeration — classify by what it does, not what it's called
- **One question per command**: Each new command should answer exactly one type of question. If it answers two, consider splitting
- **Explicit boundaries**: Document the boundary between related commands as a Q&A table, not as prose
- **Status stays lean**: `status` should only include information needed for readiness judgment. Full config details belong in `list`
