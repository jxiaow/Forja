---
name: cli-three-mode-commands
description: CLI commands that need user input must support three modes — interactive prompts, script flags, and AI agent questions/answers protocol
source: auto-skill
extracted_at: '2026-07-01T03:32:34.225Z'
---

# CLI Three-Mode Commands

Commands that require user decisions (e.g., setup, initialization, configuration wizards) must support three usage modes. This ensures the same command works for humans, scripts, and AI agents without separate code paths.

## The Three Modes

| Mode | Trigger | Input Method | Behavior |
|------|---------|-------------|----------|
| Terminal interactive | TTY, no `--json` | `prompt()` / `choose()` | Interactive prompts; flags serve as default values |
| Script | `--json` + flags | CLI flags | Use flag values directly, skip all prompts |
| AI agent | `--json` without flags | Questions/answers protocol | Return `status: "needs-input"` + `questions`; accept `--answers <path>` |

## Mode Detection Logic

```typescript
const isInteractive = !options.json && process.stdin.isTTY === true;
const hasFlags = /* check if required flags are provided */;

if (isInteractive) {
    // Mode 1: prompt user, use flags as defaults
    const value = await prompt('Enter host', options.host || 'localhost');
} else if (options.answers) {
    // Mode 3b: read answers from JSON file
    const answers = JSON.parse(fs.readFileSync(options.answers, 'utf8'));
    // apply answers to options
} else if (hasFlags) {
    // Mode 2: use flags directly
    // proceed with flag values
} else {
    // Mode 3a: return questions
    return { ok: false, status: 'needs-input', questions: [...] };
}
```

## Questions Protocol

When a command cannot proceed without user input in `--json` mode, it returns a structured `questions` array instead of an error:

```json
{
  "ok": false,
  "action": "setup-remote",
  "status": "needs-input",
  "questions": [
    { "id": "host", "label": "Host address", "required": true },
    { "id": "port", "label": "Port", "default": 22 },
    { "id": "mode", "label": "Build mode", "default": "release", "choices": ["debug", "release"] }
  ],
  "nextAction": "forja setup remote --json --answers <path>"
}
```

### Question fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Maps to the flag/option name |
| `label` | yes | Human-readable prompt text |
| `required` | no | If true, must be answered (no default) |
| `default` | no | Default value if not answered |
| `choices` | no | Constrained set of valid values |
| `when` | no | Conditional — only required when another field matches a value |

### Conditional questions (`when`)

Use `when` when a question's relevance depends on another answer:

```json
{ "id": "authMode", "label": "Auth mode", "default": "key", "choices": ["key", "password"] },
{ "id": "privateKeyPath", "label": "Private key", "default": "~/.ssh/id_rsa", "when": { "authMode": "key" } },
{ "id": "password", "label": "Password", "when": { "authMode": "password" } }
```

The answers file only needs to include the field matching the chosen condition.

### Answers file format

```json
{
  "host": "192.168.1.10",
  "port": 22
}
```

Only fields that need overriding are included. The `--answers <path>` flag points to this file.

## `--reset` Flag

Commands that are idempotent (skip already-configured fields) should support `--reset` to force re-prompting all fields:

- Without `--reset`: skip fields that already have saved values
- With `--reset`: re-prompt/re-ask everything, ignoring existing config
- With `--reset --json`: return ALL fields in questions (including already-configured ones)
- **Atomic**: all fields are collected first, then written together. If the user cancels mid-way, no config is modified.

## Flags as Prompt Defaults

In interactive mode, flag values are NOT ignored — they serve as default values for prompts:

```bash
forja setup remote --host 192.168.1.10
# Interactive prompt shows:
# 主机地址 [192.168.1.10]: ↵   ← flag value as default
# 用户名: dev                  ← no flag, empty prompt
```

## Design Principles

1. **One command, three audiences** — humans, scripts, and AI agents all use the same command
2. **Flags are universal** — they work in all three modes (as values in script mode, as defaults in interactive mode, as pre-filled answers in agent mode)
3. **Questions are typed** — `id` maps to flag names, so the same knowledge drives all three modes
4. **`--answers` uses file path** — `--answers <path>` is more reliable than stdin (especially on Windows), and avoids stdout/stdin conflicts
5. **Don't duplicate functionality across commands** — if another command handles a concern (e.g., `server add` manages servers), `setup` should prompt for it inline only for one-stop convenience, not expose it as flags that duplicate the other command's interface

## When to Apply

This pattern is appropriate for commands that:
- Require multiple user decisions to complete
- Need to work in CI/CD (scripts) and AI agent workflows
- Are idempotent (safe to re-run)
- Serve as "onboarding" or "initialization" entry points

This pattern is NOT appropriate for:
- Simple read-only commands (use `--json` for machine output)
- Commands with a single required parameter (just make it a required flag)
- Build/run/stop commands (they execute actions, not collect configuration)
