---
name: nextaction-flow-audit
description: Systematically audit nextAction and diagnostic fix fields across all commands — build scenario matrices, check for circular references, ensure each scenario points to the most helpful command
source: auto-skill
extracted_at: '2026-07-03T05:01:24.136Z'
---

# nextAction / Diagnostic Flow Audit

## When This Applies

You're reviewing or designing the `nextAction` and diagnostic `fix` fields across CLI commands. These fields guide users (and AI agents) to the correct next step — getting them wrong creates confusion, circular loops, or dead ends.

## Core Principles

### 1. No Self-Referencing nextAction

`nextAction` must never point to the command the user is already running.

```
BAD:  user runs `forja sync` → error → nextAction: 'forja sync'  (circular!)
GOOD: user runs `forja sync` → config missing → interactive setup (text) or choices (JSON)
```

### 2. Point to the Most Helpful Command

When config is missing, point to the command that solves the problem in one step, not a command that just lists what's wrong.

```
BAD:  server not found → fix: 'forja server'        (just lists servers, can't create one)
GOOD: server not found → fix: 'forja setup remote'   (interactive: create server + configure + deploy)
```

### 3. Commands Should Be Self-Sufficient

If a command needs configuration to run, it should handle setup itself:
- **Text mode**: interactive prompts (select/create server, input path, etc.)
- **JSON mode**: return `choices` array so AI can ask the user

Don't just error out and point to a different command.

### 4. Context-Aware Diagnostics

Don't show diagnostics that don't apply to the user's situation:

```
BAD:  user is in local mode → diagnostic: "sync not configured, run forja setup remote"
GOOD: user is in local mode → no sync diagnostic (local doesn't need sync)
```

## Audit Procedure

### Step 1: Build a Scenario Matrix

Before changing any code, enumerate ALL possible states and what the diagnostic/nextAction should be:

| Scenario | readiness state | diagnostic level | fix/nextAction | Issue? |
|----------|----------------|-----------------|----------------|--------|
| Not initialized | toolchain=unknown | warning | choices: setup / setup remote | ✓ |
| Has config, no target | target=not-selected | info | forja list targets | ✓ |
| Target missing | target=missing | error | forja list targets | ✓ |
| Local mode, no sync | sync=not-selected | (none) | (none) | ✓ was: info+fix |
| Remote mode, no server | sync=not-selected | warning | forja setup remote | ✓ was: forja server |
| Sync server deleted | sync=blocked | error | forja setup remote | ✓ was: forja sync |
| Everything ready | all=ready | (none) | forja build | ✓ |

Mark each cell: is the current behavior correct? What should it be?

### Step 2: Grep for All nextAction and fix Fields

```bash
# Find all nextAction assignments
grep -rn "nextAction" src/cli/commands/ src/sync/ src/remote/

# Find all diagnostic fix fields
grep -rn "fix:" src/cli/commands/

# Find KEYWORD_SUGGESTIONS
grep -rn "KEYWORD_SUGGESTIONS" src/cli/commands/
```

### Step 3: Check Each Reference

For each `nextAction` or `fix` value, verify:

1. **Not self-referencing** — doesn't point to the command being executed
2. **Not circular** — doesn't create A→B→A loops
3. **Context-appropriate** — only shown when relevant to the user's mode/situation
4. **Most helpful** — points to the command that solves the problem most completely
5. **Exists** — the suggested command actually exists and does what's implied

### Step 4: Check JSON vs Text Mode

For commands with interactive setup:
- Text mode: interactive prompts are fine
- JSON mode: must return `choices` array, never rely on "run this command again"

```typescript
// JSON mode: return choices
if (wantsJson) {
    outputResult({
        ok: false,
        choices: [
            { label: 'forja sync', command: 'forja sync', description: 'Interactive setup' },
            { label: 'forja setup remote', command: 'forja setup remote', description: 'Full remote setup' },
        ],
    }, wantsJson);
}
// Text mode: interactive setup
else {
    const guided = await interactiveSyncSetup(workspace);
    if (!guided) { process.exitCode = 1; return; }
    // fall through to execution
}
```

### Step 5: Verify

```bash
npm run compile
npm test
```

## Real Example

`forja status` sync diagnostics before audit:

| Scenario | Was | Fixed to |
|----------|-----|----------|
| Local mode, no sync server | info + fix: 'forja setup remote' | (removed — local doesn't need sync) |
| Remote mode, no sync server | warning + fix: 'forja server' | fix: 'forja setup remote' |
| Sync enabled, server deleted | error + fix: 'forja sync' | fix: 'forja setup remote' |
| Remote config missing | error + fix: 'forja server' | fix: 'forja setup remote' |

## Rule of Thumb

**Every nextAction/fix is a promise: "run this command and your problem will be closer to solved." If the promise is false (circular, irrelevant, or unhelpful), fix it.**
