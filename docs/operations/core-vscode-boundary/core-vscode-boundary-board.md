# Execution Board

> Status date: 2026-05-21

This file is the single source of truth for the current initiative's backlog and status.

## Usage Rules

- Only advance one work package to closeable state at a time
- Work packages must have a fixed `ID`
- Status values: `todo` / `in_progress` / `done` / `blocked` / `deferred`
- After completion, must sync [Verification Matrix](./core-vscode-boundary-matrix.md)
- If new architectural conclusions, deferred items, or reopen conditions arise, must sync [Decision Log](./core-vscode-boundary-decisions.md)

## Current Execution Order

1. CORE_VSCODE_BOUNDARY-01
2. CORE_VSCODE_BOUNDARY-02

## Work Packages

| ID      | Priority | Status      | Goal | Scope | Risk   | Completion criteria | Dependencies | Next step |
| ------- | -------- | ----------- | ---- | ----- | ------ | ------------------- | ------------ | --------- |
| CORE_VSCODE_BOUNDARY-01 | P1       | done | Move VSCode adapters out of core | `src/core`, `src/vscode`, imports, CLI package list | medium | `src/core` has no `vscode` imports and CLI package excludes VSCode adapters | none | Closed |
| CORE_VSCODE_BOUNDARY-02 | P2       | done | Align project rules/profile | `harness/project` docs | low | rules point to `src/vscode` adapters and pure `src/core` boundary | CORE_VSCODE_BOUNDARY-01 | Closed |

## Current Work Package Details

### CORE_VSCODE_BOUNDARY-01

- Goal: enforce a pure Node `src/core/` boundary.
- Not doing this round: change persisted config format, command IDs, or release packaging.
- Current progress: complete; boundary tests, lint, TypeScript, and full test suite pass.
