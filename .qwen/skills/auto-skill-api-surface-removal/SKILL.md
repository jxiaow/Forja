---
name: api-surface-removal
description: When removing a dead interface field or CLI flag, systematically clean up code, callers, help text, translation keys, and all doc layers
source: auto-skill
extracted_at: '2026-07-01T07:34:09.221Z'
---

# API Surface Removal

When removing a dead/unused field from a TypeScript interface or a CLI flag, follow this checklist to ensure nothing is left behind.

## When This Applies

- An interface field is declared but never populated (e.g., `locked?: boolean` marked `reserved`)
- A CLI flag adds no value and should be removed (e.g., `--process` when the data is always available)
- A spec document describes a field that doesn't exist in the implementation

## Checklist

### 1. Source Code

- [ ] Remove field from TypeScript `interface` / `type` definition
- [ ] Remove from function signature (parameter or return type)
- [ ] Remove from function body (conditional logic, assignments)
- [ ] Update ALL callers — grep for the function name to find them
- [ ] Remove from flag validation sets (e.g., `findUnknownFlags` known-flags `Set`)

### 2. Help Text & Translation Keys

- [ ] Remove from `help.*` translation entries in `types.ts`
- [ ] Remove any translation keys that become unused (grep for the key name)
- [ ] Update the global help text if it mentions the removed flag

### 3. Documentation (all layers)

- [ ] **Spec doc** (`cli-interface-spec.md`) — remove from parameter tables, interface definitions, error handling sections
- [ ] **Command API doc** (`command-api.zh.md`) — remove from syntax, input tables, behavior descriptions
- [ ] **Per-command doc** (`v2/<command>.md`) — remove from syntax, behavior list, Result interface, readiness tables, JSON examples, text output examples, validation points
- [ ] **Cross-reference docs** (`v2/index.md`) — remove from command mapping tables, migration tables, runtime lifecycle descriptions
- [ ] **Related command docs** — grep for the removed flag/field name in ALL `.md` files under `docs/`, other commands may reference it (e.g., `stop.md` and `run.md` referenced `status --process`)
- [ ] **HTML files** — do NOT edit manually; they are auto-generated from `.md` sources (see `spec-doc-sync` skill)

### 4. Verification

- [ ] `grep` source code for the removed name — must return zero matches
- [ ] `grep` all `.md` docs for the removed name — must return zero matches
- [ ] Rebuild (`npm run build:cli`) — must compile clean
- [ ] Run tests — must pass with no regressions

## Key Insight

The most commonly missed locations are:
- **Cross-command references**: Other commands' docs often say "use `forja X --flag`" as a nextAction or cross-reference
- **Help text in translation tables**: The `help.*` entries in `types.ts` are easy to forget
- **Flag validation sets**: The `findUnknownFlags` call in the dispatcher's handler function has a `Set` of known flags
- **Readiness/diagnostic tables**: Per-command docs have tables mapping field values to states — remove the relevant row
