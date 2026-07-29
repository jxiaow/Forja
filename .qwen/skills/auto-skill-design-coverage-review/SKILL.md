---
name: design-coverage-review
description: Before implementing a command removal/merge, review the design doc against actual implementation code to find capability gaps and migration issues
source: auto-skill
extracted_at: '2026-07-05T04:15:38.332Z'
---

# Design Coverage Review

When a design document proposes removing or merging commands, systematically verify that the design covers every capability in the actual implementation BEFORE coding begins. Catches missing flags, unhandled flows, broken imports, and stale references that would cause rework during implementation.

## When This Applies

- A design doc says "delete command X, merge into command Y"
- A design doc proposes removing a command surface (e.g., `setup`, `init`)
- Before starting implementation of a command consolidation

## Process

### 1. Read the Full Implementation

Read every file that implements the command being removed/changed:
- The main command file (e.g., `setup.ts`)
- Internal modules it calls (e.g., `init.ts`)
- The target command that absorbs its responsibilities (e.g., `use.ts`)
- Type definitions and shared interfaces

Read them completely — do not skim. Every function, every branch, every flag handler.

### 2. Inventory Every Capability

Extract a complete list from the implementation:

| Category | What to Extract |
|----------|----------------|
| **Flags** | Every CLI flag the command accepts (including undocumented ones like `--jom-path`) |
| **Interactive flows** | Every prompt/choose sequence, including conditional ones (e.g., "only for .pro files") |
| **Three-mode behavior** | How interactive / script / AI-agent modes differ |
| **Questions protocol** | What questions are generated, with what fields (id, choices, defaults, when conditions) |
| **Save/write operations** | Every config file written, in what order, with what idempotency rules |
| **Detection/scanning** | What environment detection happens, what versions are extracted |
| **Output formatting** | Text output structure, JSON output structure, step tracking |
| **Cross-references** | Imports from other modules, types defined here but used elsewhere, nextAction strings pointing here |
| **Edge cases** | Error handling, partial failure states, ambiguous states |

### 3. Compare Against Design Doc

For each capability from step 2, check if the design doc covers it:

| Status | Meaning | Action |
|--------|---------|--------|
| ✅ Covered | Design explicitly addresses this | None |
| ❌ Gap | Design doesn't mention this capability | Add to design |
| ⚠️ Implicit | Design mentions it vaguely but lacks detail | Clarify in design |
| 🔗 Broken ref | Code references the removed command (imports, nextActions, types) | Add to migration cleanup |

Pay special attention to:
- **Flags that exist in code but not in design syntax** (e.g., `--jom-path`)
- **Conditional prompts** that only fire for specific file types (e.g., qmake TARGET for .pro files)
- **Version detection** that the design doesn't mention displaying
- **Interactive modes** (e.g., "show current values and let user modify") that the design describes vaguely
- **Type ownership** — interfaces defined in the file being deleted but imported by other files
- **nextAction strings** in other files that point to the command being removed

### 4. Categorize Findings

Present findings as three tables:

**❌ Uncovered capabilities** — things the current code does that the design doesn't address:
```
| # | Capability | Design status | Impact |
```

**⚠️ Alignment issues** — things that are mentioned but need clarification:
```
| # | Issue | Current code | Design doc |
```

**✅ Already covered** — confirmation that key capabilities are addressed (brief list)

### 5. Update Design Doc

For each gap found, update the design document:
- Add missing flags to syntax section
- Add missing interactive flows to behavior section
- Add missing questions to the questions protocol
- Add missing output examples
- Add code cleanup items (imports, type migrations, stale references)
- Expand verification checklist

### 6. Expand Verification Checklist

Add specific verification items for every gap found:
```
- [ ] `forja use target --jom-path <path>`：只改 jom 路径
- [ ] `forja use target --project app.pro`：提示输入 qmake TARGET
- [ ] `use.ts` 中无 `import from './setup'` 引用
```

## Key Principles

- **Code is the completeness baseline**: The design must cover everything the current code does, even if the design changes HOW it's done
- **Read before comparing**: Don't guess what the code does from the design — read the actual implementation
- **Migration is part of the design**: Broken imports, stale nextActions, and type ownership are design concerns, not "implementation details"
- **Flags are contracts**: Every flag in the current code is a user contract — removing one requires explicit design decision
- **Conditional behavior is easy to miss**: Prompts that only fire for `.pro` files or only on Windows are invisible in the design's "happy path" description
