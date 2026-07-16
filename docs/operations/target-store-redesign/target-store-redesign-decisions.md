# Decision Log

> Status date: 2026-07-09

This file records key conclusions, deferral reasons, and reopen conditions during the current initiative.

## DEC-001 Workspace-scoped target store

- Date: 2026-07-09
- Conclusion: Target data is scoped by workspace. Every target operation must resolve workspace before reading or writing target data.
- Reason: `project` paths, scanner results, toolchain choices, remote settings, and build/run behavior all depend on workspace root.
- Impact: CLI without an explicit workspace must resolve from cwd; VSCode must use workspace/project root resolver. Target profiles are not shared across workspaces.
- Reopen condition: A future requirement explicitly needs global reusable target templates across multiple workspaces.

## DEC-002 Multiple saved targets, one active target

- Date: 2026-07-09
- Conclusion: Store many target profiles under `targets`, but keep a single `activeTargetId`.
- Reason: 用户需要保留多个 target，但 build/run/status 必须有唯一当前目标，避免 Qt/SDK 双当前状态互相覆盖。
- Impact: `activeTarget`, Qt `pinnedProject`, SDK `pinnedProject`, and `targetToolchains` become legacy migration sources, not long-term target facts.
- Reopen condition: Product requirement changes to parallel active targets or per-module active target semantics.

## DEC-003 Explicit saved profiles, scanned candidates stay transient

- Date: 2026-07-09
- Conclusion: Scanned project files remain candidates. They enter `targets` store only when user selects/saves them.
- Reason: Auto-saving every scanned project would pollute configuration and make cleanup noisy in large workspaces.
- Impact: `forja list targets` should be able to show both saved profiles and unsaved candidates; only saved profiles can become active via `activeTargetId`.
- Reopen condition: A future UX requires automatically materializing all candidates for bulk profile management.

## DEC-004 Target fields move out of Qt/SDK settings

- Date: 2026-07-09
- Conclusion: `project`, `mode`, `arch`, `runAt`, target-specific toolchain, and `qmakeTarget` belong to TargetStore.
- Reason: These fields define a target profile. Keeping them in Qt/SDK settings duplicates state and causes stale reads.
- Impact: Qt/SDK settings keep module preferences only. Existing fields are migrated and then deprecated.
- Reopen condition: A target field is proven to be global module preference rather than profile-specific state.
