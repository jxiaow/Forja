---
inclusion: manual
---

# Superpowers Skills System

This steering file integrates [obra/superpowers](https://github.com/obra/superpowers) into Kiro.

Superpowers skills are installed at: `~/.kiro/superpowers/skills/`

## Available Skills

When this context is active, load and follow the relevant skill from the skills library:

| Skill | When to Use |
|-------|-------------|
| brainstorming | Before any creative work - creating features, building components, adding functionality |
| writing-plans | After design approval - break work into detailed implementation tasks |
| executing-plans | Execute implementation plan in batches with checkpoints |
| subagent-driven-development | Fast iteration with two-stage review (spec compliance, then code quality) |
| test-driven-development | During implementation - enforce RED-GREEN-REFACTOR cycle |
| systematic-debugging | When fixing bugs - 4-phase root cause analysis |
| verification-before-completion | Before declaring a fix complete - ensure it's actually fixed |
| requesting-code-review | Before submitting code for review |
| receiving-code-review | When responding to review feedback |
| using-git-worktrees | For parallel development on isolated branches |
| finishing-a-development-branch | When tasks complete - merge/PR/keep/discard decision |
| dispatching-parallel-agents | For concurrent subagent workflows |
| writing-skills | To create new skills following best practices |

## How to Use

Reference a skill by name in chat: `#Superpowers` then ask to use a specific skill, e.g.:
- "Use brainstorming to design this feature"
- "Use TDD for this implementation"
- "Use systematic-debugging to find this bug"

## Skill Files Location

Each skill is at: `~/.kiro/superpowers/skills/<skill-name>/SKILL.md`

When a skill is invoked, read the full SKILL.md file and follow its instructions exactly.

## Skill Priority

1. **User's explicit instructions** (AGENTS.md, direct requests) — highest priority
2. **Superpowers skills** — override default behavior where they conflict
3. **Default system prompt** — lowest priority

## Skill Types

- **Rigid** (TDD, debugging): Follow exactly. Don't adapt away discipline.
- **Flexible** (patterns): Adapt principles to context.
