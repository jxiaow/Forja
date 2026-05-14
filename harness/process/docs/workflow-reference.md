# Workflow Reference

This document contains the detailed AgentHarness process rules. Keep the root README short; use this file when adapting the harness to a real repository.

## Default Workflow

For every task, the agent should:

1. Select the closest template from `templates/`.
2. Decide task size: `tiny`, `normal`, or `long-running`.
3. Output Requirement gate.
4. Output Design gate.
5. Read the relevant `rules/` and project rules.
6. Implement the change.
7. Output Implementation gate.
8. Run necessary verification.
9. Output Verification gate.
10. Output Delivery gate.

Gates are not approval checkpoints by default. If there is no real blocker, the agent records the gate and continues.

## Task Sizes

| Size | Use When | Extra Requirement |
| ---- | -------- | ----------------- |
| `tiny` | Single-file wording, style, or local config changes | Still output Requirement and Design gates |
| `normal` | Regular bugs, features, refactors, or UI changes | Read relevant rules before implementation |
| `long-running` | Repository structure, workspace, migration, or multi-stage remediation | Create `docs/operations/<initiative>/` docs before implementation |

## Execution Model

AgentHarness defaults to autopilot execution:

1. If there is no real blocker, the agent continues from requirement and design through implementation, verification, and delivery.
2. Requirement and Design gates must happen before implementation. They are records, not approval pauses.
3. Long-running or multi-stage work must create phase-level todos, a checklist, and an execution order before implementation.
4. Finishing one work package is not a final closeout. The agent should continue to the next actionable item.
5. "Continue", "start", and "keep going" mean continuing the active phase by default.
6. A final closeout is allowed only when the current target is complete or a real blocker appears.
7. Durable decisions can be written to `docs/development/changes/`, but only at phase closeout, after high-risk work is complete, or when the user explicitly asks for it.
8. External skills or planning tools should not inflate the workflow. Collapse their output into the harness gates and continue unless there is a real blocker.

Real blockers are limited to:

- a command needs user authorization
- continuing would overwrite or damage existing work
- the requirement has changed enough that continuing would clearly miss the goal
- key input is missing and cannot be inferred from the repository

## Closeout Rules

Before a final closeout, the agent must decide which target type it is handling:

- `single-task`: a bounded task; close only after the requested result and necessary verification are complete.
- `staged/ongoing`: long-running remediation, migration, or multi-stage work; close only when the current phase has no actionable remaining item, or a real blocker appears.
- `continuation`: the user says "continue", "start", "keep going", or similar; inherit the active phase and continue the next item.
- `explicit-closeout`: the user asks to summarize, stop, or close; report the current verified state.

If an active operations board or checklist exists under `docs/operations/<initiative>/`, the agent must read it before final closeout and confirm that the highest-priority actionable item has been advanced.

## Long-Running Work

For migrations, repo restructures, or continuous remediation, create an operations workspace:

```bash
node harness/process/operations/create-operation-docs.js <initiative>
```

This creates:

```text
docs/operations/<initiative>/
├── current-<initiative>.md
├── <initiative>-board.md
├── <initiative>-matrix.md
└── <initiative>-decisions.md
```

Use these files as the source of truth for:

- phase goals
- work package order
- backlog state
- verification matrix
- decisions and reopen conditions

A work package finishing is not the same thing as the whole task finishing. The agent should continue to the next highest-priority item unless the phase is complete or a real blocker appears.

## Long-Running Remediation Workflow

Use this workflow for repository restructures, workspace changes, package renames, application entrypoint renames, migrations, and multi-stage remediation.

Before implementation:

1. Create or reuse `docs/operations/<initiative>/`.
2. Write the phase-level todo/checklist, execution order, non-goals, and first work package.
3. Update the board so the current highest-priority work package is explicit.

Each work package should record:

- `ID`
- goal
- scope
- risk
- verification method
- completion standard
- dependency
- status

When a package finishes:

1. Update the board.
2. Update the verification matrix.
3. Record decisions, deferrals, or reopen conditions if they changed.
4. Continue to the next item unless the phase is complete or blocked.

## Document Placement

Use two documentation layers:

- `docs/development/` for stable architecture, module, setup, and long-term maintenance docs.
- `docs/operations/` for temporary execution docs: plans, boards, checklists, verification matrices, and migration state.

Do not leave transition checklists and phase decisions mixed into stable development docs.

## Lean Output Rules

Default agent output should be compact:

- Start with one sentence: goal and first action.
- Put task type on its own line.
- Keep Requirement and Design gates to short bullets.
- Do not treat gates as a pause.
- Do not output a final closeout for a single work package if the larger goal still has work.
- In the final closeout, separate completed work, verification, unverified areas, and real remaining risk.

## Lean Execution Defaults

Default command and context usage should stay small:

1. Search only the target paths and exclude generated output such as `target/`, `node_modules/`, and `dist/`.
2. Check `git status` only for paths relevant to the current task when possible.
3. Read files by locating first, then opening a small window.
4. Truncate long outputs and keep only decision-relevant lines.
5. Prefer changed-file process checks over full lint/test runs unless the conclusion depends on a broader check.
6. If a broad check is necessary, state the reason and scope in Verification gate.

Details live in [../rules/token-efficiency.md](../rules/token-efficiency.md).

## Verification

For normal changes, prefer targeted checks:

```bash
node harness/process/automation/check-process.js --changed --summary --max-issues 5
```

For harness development, run the harness tests:

```bash
npm run harness:test
```

The process check is not a business test. It only proves that the harness-visible process files pass the checks currently implemented.

### Local Dev Server And Browser Verification

Frontend changes do not start a local dev server by default. Start one only when the verification result depends on a real browser runtime, such as a new page, broad UI redesign, responsive or interaction risk, routing behavior, screenshot review, or an explicit user request to preview.

For small wording, spacing, color-token, static style-contract, or pure logic changes, prefer static checks, unit tests, contract tests, or a build. Do not occupy a port just to prove a small change.

When a server is necessary, state the purpose, command, and expected port before starting it, then provide the URL. Before closeout, confirm whether the server should be stopped or explain why it should stay running. On port conflicts, make one reasonable port switch and clean up any failed startup residue.

Starting the server is not browser verification. The Verification gate must state the actual paths, viewports, states, and gaps that were checked.
