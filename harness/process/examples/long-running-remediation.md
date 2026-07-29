# Long-Running Remediation Example

Use this pattern when the task is larger than one local code change: repository restructuring, workspace migration, multi-module cleanup, or a remediation sequence that must survive interruptions.

## Trigger

```text
Clean up the repository structure and keep going until the current phase is done.
```

## Required First Move

Create an operations workspace before implementation:

```bash
node harness/process/operations/create-operation-docs.js repo-structure-cleanup
```

This creates:

```text
docs/operations/repo-structure-cleanup/
├── current-repo-structure-cleanup.md
├── repo-structure-cleanup-board.md
├── repo-structure-cleanup-matrix.md
└── repo-structure-cleanup-decisions.md
```

## Current Plan Shape

```md
# Current Repo Structure Cleanup

## Phase Todo

- [x] Inventory current roots and entry points.
- [ ] Move generated artifacts out of source-controlled paths.
- [ ] Update scripts and docs that reference old paths.
- [ ] Run targeted verification.

## Execution Order

1. Inventory
2. Path cleanup
3. Script/doc update
4. Verification
```

## Board Shape

```md
| ID | Priority | Status | Goal | Scope | Completion Standard |
| --- | --- | --- | --- | --- | --- |
| RSC-01 | P1 | done | Inventory roots | README, package scripts, apps | Current roots documented |
| RSC-02 | P1 | in_progress | Remove generated artifacts | ignored build output | Source tree no longer contains generated files |
| RSC-03 | P2 | todo | Update references | docs and scripts | Old paths no longer appear outside archives |
```

## Verification Matrix Shape

```md
| Work Package | Level | Command / Method | Result | Not Covered |
| --- | --- | --- | --- | --- |
| RSC-02 | smoke | `test ! -e apps/old-build-output` | pass | Does not prove production build |
| RSC-03 | format | `git diff --check` | pass | Does not prove runtime behavior |
```

## Closeout Rule

The agent may close the turn only when the phase is complete or a real blocker appears. Finishing `RSC-02` is a work package close, not a final closeout, if `RSC-03` is still actionable.
