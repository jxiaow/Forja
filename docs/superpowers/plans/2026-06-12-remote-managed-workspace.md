# Remote Managed Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `forja remote` choose safe baseline and workspace strategies before touching a remote machine, preserving user-owned Linux workspaces while enabling managed WSL builds.

**Architecture:** Keep strategy decisions in pure `src/remote/core` modules and make pipeline consume a prepared plan. Add managed workspace metadata and repo mapping to remote settings, but do not add new VSCode command IDs in this phase. Bundle sync is only allowed for managed repos; remote-only repos are linked or checked, never overwritten.

**Tech Stack:** TypeScript strict mode, Node `node:test`, existing SSH runner/uploader abstractions, git CLI via existing runner patterns.

---

## Reviewed Design Result

The archived design in `docs/operations/remote-managed-workspace/current-remote-managed-workspace.md` is implementable with one sequencing constraint: build the planner and safety checks before wiring bundle execution into the pipeline. The current partial `bundleBaseline` WIP must be rewritten because it can remove a remote repo directory without a managed workspace proof.

## File Structure

- Create `src/remote/core/repoStrategy.ts`: repo role normalization and baseline strategy planner.
- Create `src/remote/core/managedWorkspace.ts`: remote workspace path, marker/registry commands, and deletion/reset safety checks.
- Create or rewrite `src/remote/core/bundleBaseline.ts`: bundle create/upload/apply for managed repos only.
- Create `src/remote/core/workspaceLink.ts`: symlink/mount commands for remote-only dependencies.
- Modify `src/core/settingsIO.ts`: persist optional remote managed workspace settings and repo mappings.
- Modify `src/remote/core/baseline.ts`: expose local/remote repo facts without deciding destructive fallback.
- Modify `src/remote/core/status.ts`: include plan output while keeping status read-only.
- Modify `src/remote/core/pipeline.ts`: execute `managedWorkspacePrepare`, `baselineApply`, `workspaceLink`, then overlay only allowed repos.
- Modify `scripts/build-cli.js`: include new remote core modules in CLI package.
- Add tests in `src/test/remoteManagedWorkspace.test.ts`, `src/test/remoteRepoStrategy.test.ts`, `src/test/remoteBundleBaseline.test.ts`, and pipeline-focused tests.

## Stage Checklist

### Task 1: Repo Strategy Planner

**Files:**
- Create: `src/remote/core/repoStrategy.ts`
- Test: `src/test/remoteRepoStrategy.test.ts`

- [x] Write failing tests for:
  - primary managed repo with matching commit chooses `reuse-ready`
  - primary missing managed repo chooses `bundle-clone`
  - primary managed mismatched repo with local ahead chooses `bundle-fetch`
  - existing non-managed mismatched repo chooses `blocked`
  - remote-only dependency chooses `status-only` with `overlayAllowed: false`
  - different-name dependency requires explicit mapping
- [x] Run targeted test and confirm failure due missing module.
- [x] Implement exported interfaces:
  - `RemoteRepoRole = 'primary' | 'mapped' | 'remote-only' | 'existing-remote' | 'skip'`
  - `RemoteBaselineStrategy = 'reuse-ready' | 'git-pull' | 'bundle-fetch' | 'bundle-clone' | 'status-only' | 'blocked'`
  - `planRemoteRepositories(input): RemoteRepoPlanResult`
- [x] Re-run targeted test and confirm pass.

### Task 2: Managed Workspace Safety

**Files:**
- Create: `src/remote/core/managedWorkspace.ts`
- Test: `src/test/remoteManagedWorkspace.test.ts`

- [x] Write failing tests for:
  - managed workspace path resolves under configured root
  - registry marker command is generated before destructive actions
  - non-managed path cannot be reset or deleted
  - remote-only repo cannot be deleted even when linked into workspace
- [x] Implement path/registry helpers without touching real remote state in tests.
- [x] Re-run targeted test and confirm pass.

### Task 3: Bundle Baseline Rewrite

**Files:**
- Rewrite: `src/remote/core/bundleBaseline.ts`
- Test: `src/test/remoteBundleBaseline.test.ts`

- [x] Replace the current experimental bundle logic with tests that first fail:
  - bundle is created from a temporary ref, not a raw commit argument
  - remote apply refuses non-managed repo paths
  - missing managed repo uses clone/fetch from uploaded bundle
  - local behind/diverged is blocked
- [x] Implement local temporary ref creation, bundle upload path, remote fetch/checkout command generation, and local cleanup.
- [x] Re-run bundle tests and confirm pass.

### Task 4: Workspace Link

**Files:**
- Create: `src/remote/core/workspaceLink.ts`
- Test: `src/test/remoteWorkspaceLink.test.ts`

- [x] Write failing tests for symlink command generation and remote-only protection.
- [x] Implement link preparation so managed workspace exposes Linux-only dependencies by name.
- [x] Re-run targeted test and confirm pass.

### Task 5: Settings Shape

**Files:**
- Modify: `src/core/settingsIO.ts`
- Test: existing or new settings test in `src/test`

- [x] Write failing tests for sanitizing `remote.workspaceMode`, `remote.profile`, `remote.remoteWorkspace`, and `remote.repos`.
- [x] Add optional settings fields with defaults preserving existing remote settings.
- [x] Re-run settings tests and confirm pass.

### Task 6: Status and Pipeline Integration

**Files:**
- Modify: `src/remote/core/status.ts`
- Modify: `src/remote/core/pipeline.ts`
- Modify: `src/remote/core/overlaySync.ts`
- Test: pipeline/status tests in `src/test`

- [x] Write failing tests that `remote status` reports a plan but does not call uploader or destructive runner commands.
- [x] Write failing tests that pipeline stages run in this order: `baselinePlan`, `acquireLock`, `managedWorkspacePrepare`, `baselineApply`, `workspaceLink`, `overlaySync`, `baselineCheck`.
- [x] Ensure overlay only runs for plan entries with `overlayAllowed: true`.
- [x] Re-run targeted tests and confirm pass.

### Task 7: CLI Packaging and Verification

**Files:**
- Modify: `scripts/build-cli.js`
- Test: `src/test/cliEntrySource.test.ts`

- [x] Add failing test that new remote core files are included in standalone CLI source set.
- [x] Update package assembly.
- [x] Run `npm test`.
- [x] Run `npm run build:cli`.
- [x] Run controlled WSL smoke with generated CLI:
  - `remote test --json`
  - `remote status --json`
  - managed workspace prepare/build against `/home/xw/workspace/forja-remote/<profile>`

### Task 8: Remote Shell Fallback

**Files:**
- Create: `src/remote/core/remoteShellFallback.ts`
- Modify: `src/remote/core/pipeline.ts`
- Test: `src/test/remotePipelineManagedWorkspace.test.ts`

- [x] Write failing test that managed `qt qmake` falls back to remote shell when remote Forja is missing.
- [x] Implement shell fallback for Qt `qmake/build/clean` and SDK `build/rebuild/clean`.
- [x] Pass `remoteForjaBin` setting through readiness/action bridge calls.
- [x] Run `npm test`.
- [x] Run `npm run build:cli`.
- [x] Run controlled WSL smoke with generated CLI and forced missing remote Forja path.

### Task 9: Qt Run/Ps/Stop Shell Fallback

**Files:**
- Modify: `src/remote/core/remoteShellFallback.ts`
- Test: `src/test/remoteShellFallback.test.ts`

- [x] Write failing tests that Qt `run` uses remote shell fallback, starts with `nohup`, and writes `.forja/run-state`.
- [x] Write failing tests that Qt `ps` reads `.forja/run-state` and reports whether the pid is running.
- [x] Write failing tests that Qt `stop` terminates the recorded pid and removes `.forja/run-state`.
- [x] Parse shell fallback JSON stdout into the remote action result.
- [x] Run targeted fallback tests.
- [x] Run `npm test`.
- [x] Run `npm run build:cli`.
- [x] Run controlled WSL smoke with generated CLI, forced missing remote Forja path, managed bundle baseline, `qt run`, `qt ps`, `qt stop`, and `qt ps` after stop.

## Self-Review

- Spec coverage: repo roles, strategy selection, managed registry, bundle fallback, workspace links, cleanup safety, status read-only behavior, and WSL validation are covered.
- Placeholder scan: no placeholder tasks remain.
- Type consistency: plan uses `RemoteRepoRole`, `RemoteBaselineStrategy`, and `RemoteRepoPlanResult` consistently.
