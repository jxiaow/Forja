# Current Initiative Plan

> Status date: 2026-05-21

This document serves as the overview for the current initiative. Granular backlog, verification records, and decision status are split into the following operations documents:

- [Execution Board](./core-vscode-boundary-board.md): single source of truth for backlog and status
- [Verification Matrix](./core-vscode-boundary-matrix.md): verification records for each work package
- [Decision Log](./core-vscode-boundary-decisions.md): decisions, deferred items, and reopen conditions

## 1. Current Conclusion

- Primary goal: keep `src/core/` pure Node while moving VSCode-bound extension adapters into `src/vscode/`.
- Current assessment: adapter files are being migrated with behavior preserved and guarded by source-boundary tests.
- Current biggest issue: update imports and CLI packaging so no `vscode` adapter leaks into standalone CLI output.

## 2. Stage-Level Todo

### Stage 1: Adapter Boundary Migration

- Goal: move `logger`, `settingsStore`, `workspaceResolver`, and `qtState` out of `src/core/`.
- Non-goal: change configuration file format, command IDs, activation behavior, or CLI command behavior.
- Completion criteria: boundary test, TypeScript, lint, and full test suite pass.

### Stage 2: Documentation And Packaging Alignment

- Goal: keep harness rules/profile and CLI package file list aligned with the new boundary.
- Non-goal: package release or version bump.
- Completion criteria: docs reference `src/vscode/` adapters and CLI package excludes VSCode-only files.

## 3. Execution Order

1. Add boundary tests.
2. Move VSCode adapter/state files to `src/vscode/`.
3. Update imports, CLI packaging, and project rules.
4. Run verification.

Current next item: determined by the highest-priority `todo / in_progress` work package at the top of the [Execution Board](./core-vscode-boundary-board.md).
