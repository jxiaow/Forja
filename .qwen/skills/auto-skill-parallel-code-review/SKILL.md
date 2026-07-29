---
name: parallel-code-review
description: Launch 3 parallel explore agents to review different dimensions of a module (logic, spec alignment, output layer) for thorough coverage
source: auto-skill
extracted_at: '2026-07-01T05:26:01.653Z'
---

# Parallel Code Review

When reviewing a non-trivial module or command, launch multiple explore agents in parallel to cover different review dimensions simultaneously. This catches more issues faster than sequential review.

## When This Applies

- User asks to "review" a command or module
- The module has 3+ files with different concerns (core logic, dispatcher, formatters, spec)
- Single-pass review is likely to miss cross-cutting issues

## Process

### 1. Initial Quick Review (you, not agents)

Read the main implementation file yourself first. Identify the obvious bugs and fix them immediately. This gives you context to write better agent prompts and avoids wasting agent time on issues you can spot instantly.

### 2. Launch 3 Parallel Explore Agents

Split the review into non-overlapping dimensions:

| Agent | Focus | What to look for |
|-------|-------|-----------------|
| **Logic** | Core business logic (e.g., init.ts) | State writes, edge cases, error handling, dead code, validation gaps |
| **Spec alignment** | Spec doc vs implementation | Flag coverage, behavior match, JSON output structure, translation keys, nextAction values |
| **Output layer** | Formatters + dispatcher | Untranslated strings, missing fields, flag parsing, exit codes, dead code in outputResult |

Each agent prompt should:
- List the specific files to read
- List already-known issues (so agents don't re-report them)
- Specify the review dimensions (error handling, state consistency, edge cases, dead code)
- Request thoroughness level: "very thorough"

### 3. Fix Your Findings While Agents Run

Don't wait idle. While agents are working:
- Fix the obvious issues from your initial review
- Update spec documents for issues you already found
- Add translation keys you know are missing

### 4. Aggregate and Deduplicate

When agents complete:
- Read each agent's full report from the output file
- Categorize findings by severity (bug / UX / cosmetic / doc)
- Deduplicate across agents (same issue found by multiple agents)
- Present a unified summary table to the user

### 5. Fix Everything

When user says "全部修复":
- Group fixes by file to minimize context switching
- Compile and test after each batch
- Fix spec docs in the same pass as code

## Key Principles

- **Non-overlapping scopes**: Each agent reviews a different aspect — don't have two agents review the same file for the same things
- **Fix while waiting**: Use agent wait time productively
- **Severity matters**: Categorize as 🔴 Bug / 🟡 UX / 🟢 Cosmetic / ⚪ Doc — helps user prioritize
- **Spec is a review dimension**: Always compare implementation against the spec document — this catches drift that pure code review misses
- **Translation key audit**: Part of spec alignment — check that all T() keys used in code exist in the translation table, and spec lists all keys
