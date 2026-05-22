# SDK CLI Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `compilot sdk use` and make SDK execution commands read only saved configuration.

**Architecture:** Keep implementation inside `src/sdk/cli/index.ts` without introducing new cross-module dependencies. Reuse existing SDK settings helpers and project validation helpers. Tests stay in `src/test/sdkCli.test.ts`.

**Tech Stack:** TypeScript, Node `node:test`, existing Compilot CLI settings storage.

---

### Task 1: SDK CLI Argument Contract

**Files:**
- Modify: `src/sdk/cli/index.ts`
- Test: `src/test/sdkCli.test.ts`

- [ ] Add failing tests that `sdk use` accepts config flags and `sdk build/rebuild/clean/init/status/env/projects` reject `--project`, `--mode`, `--arch`, and `--vs-dev-cmd` where unsupported.
- [ ] Run `npm run compile` and `node --test --test-reporter=spec out/test/sdkCli.test.js`; expected SDK tests fail on missing `use` and still-accepted execution config flags.
- [ ] Add `use` to the valid action list and an action-to-allowed-flags map.
- [ ] Run the SDK CLI test file; expected pass for argument contract tests.

### Task 2: SDK Use Persistence

**Files:**
- Modify: `src/sdk/cli/index.ts`
- Test: `src/test/sdkCli.test.ts`

- [ ] Add failing tests that `sdk use --project Makefile --mode release` persists only explicit fields and that a later `build --plan` inherits saved settings.
- [ ] Add failing tests that `sdk use --project MissingMakefile` fails with `项目文件不存在`.
- [ ] Implement the `use` branch using `loadSdkSettings`, `saveSdkSettings`, and `requireExistingProjectPath`.
- [ ] Run the SDK CLI test file; expected pass for use persistence tests.

### Task 3: Execution Requires Saved Config

**Files:**
- Modify: `src/sdk/cli/index.ts`
- Test: `src/test/sdkCli.test.ts`

- [ ] Add failing tests that `build --plan` with no SDK settings returns `ok: false` and `nextActions: ["compilot sdk status --json"]` even when exactly one SDK project exists.
- [ ] Update execution path to require a settings file and saved project before command generation.
- [ ] Keep stale pinned-project rejection behavior from the existing tests.
- [ ] Run the SDK CLI test file; expected pass.

### Task 4: Docs And Verification

**Files:**
- Modify: `docs/README-cli.md`
- Modify: `docs/cli-interface-spec.md`

- [ ] Update SDK README flow to document `status -> init/projects/env -> use -> build`.
- [ ] Update SDK interface spec actions, options, and JSON examples.
- [ ] Run `npm run compile`, `npm run lint`, and `node --test --test-concurrency=1 --test-reporter=spec out/test`.
- [ ] Commit and push the completed change.

