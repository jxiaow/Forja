# Forja Command Consolidation Migration And Implementation Plan

> **Superseded:** This document is the pre-v2 planning record. The authoritative implementation source is
> [`v2/index.md`](v2/index.md) and its per-command spec pages. If this file conflicts with v2, follow v2.
> Known obsolete items in this record include the 10-command surface, `forja use --target`,
> `forja use --remote`, `forja use --server`, old VSCode Command ID compatibility, and the old compatibility-first CLI policy.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-facing Qt/SDK/Remote/Sync command tree with a small intent-based command surface while preserving existing implementation capabilities behind compatibility adapters.

**Architecture:** Introduce a unified command model built around `activeTarget` and `runAt`. Qt, SDK, local, and remote become target attributes instead of first-level user commands. Existing Qt/SDK/Remote/Sync implementation modules remain the execution backends while the new top-level CLI and VSCode commands route through a shared planner.

**Tech Stack:** TypeScript strict mode, Node `node:test`, existing CLI dispatchers, existing VSCode command registration, existing settings files through `core/settingsIO.ts` and module settings stores.

---

## Final User Command Surface

The user-facing command set is:

```bash
forja status
forja init
forja list
forja use
forja build
forja run
forja stop
forja clean
forja doctor
forja sync
```

No `forja remote` user command is introduced. Remote is selected with `forja use --remote` and then consumed by `status`, `build`, `run`, `stop`, `clean`, `doctor`, and `sync`.

No top-level `qmake` or `rcc` command is introduced. Their standalone capability is preserved through `forja build qmake` and `forja build rcc`.

No top-level `qt` or `sdk` user command remains in the primary help. Existing old commands can remain registered during migration, but they become hidden compatibility routes and should not appear in normal help, nextActions, quick picks, or the VSCode command palette.

### Command Grammar

Public commands follow this shape:

```bash
forja <main-command> <action> [object] [--modifier]
```

Rules:

- Actions use positional words: `forja build qmake`, `forja doctor unlock <lock-id>`, `forja sync plan`.
- Flags only modify an action: `--json`, `--workspace`, `--remote`, `--force`, `--recursive`, `--file`.
- Do not introduce new public forms such as `forja doctor --restore`, `forja doctor --unlock`, or `forja sync --reset`.
- Compatibility parsers may keep old flag-style forms during migration, but help text, nextActions, VSCode commands, and AI-facing docs must use positional actions.
- A main command should expose at most a small, memorable action set. Current visible action budget:
  - `build`: `fresh`, `qmake`, `rcc`.
  - `sync`: `plan`, `reset`.
  - `doctor`: `fix`, `unlock`, `restore`, `reset`, `clean-untracked`.
  - Other main commands expose no visible subactions.
- Low-frequency configuration actions such as server CRUD, remote repo mapping, build-order editing, and artifact transfer configuration stay out of the primary command surface.

## Core Concepts

### Active Target

`activeTarget` is the single selected thing that build/run/clean operate on.

Shape:

```ts
interface ActiveTarget {
    kind: 'qt' | 'sdk';
    project: string;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    runAt: 'local' | 'remote';
}
```

Rules:

- `kind` is explicit once selected. Mixed Qt + SDK workspaces must not guess.
- `project` is workspace-relative when possible.
- `mode` and `arch` are shared user concepts even if a backend maps them differently.
- `runAt` is the selected execution side: `local` runs on the current machine, `remote` runs through the configured remote pipeline.
- A missing active target blocks `build`, `run`, `stop`, and `clean` with a `forja list` / `forja use` next action.

### Candidate

A candidate is something Forja can select.

Shape:

```ts
interface ForjaCandidate {
    id: string;
    kind: 'qt' | 'sdk';
    project: string;
    label: string;
    configured: boolean;
    current: boolean;
    diagnostics: Array<{ level: 'info' | 'warning' | 'error'; message: string }>;
}
```

Candidate sources:

- Qt candidates from `.pro` scanning currently used by `forja qt projects`.
- SDK candidates from `.sln` or `Makefile` scanning currently used by `forja sdk projects`.
- Current target from saved Qt/SDK settings and the new unified active target metadata.

### RunAt

Execution location is selected independently from target kind.

Values:

- `local`: use local Qt/SDK backend.
- `remote`: prepare remote workspace and execute remote Qt/SDK backend.

Rules:

- `forja use --remote` switches the current active target to remote execution.
- `forja use --local` switches it back.
- `forja status` reports whether the chosen location is ready.
- `forja doctor` performs deeper checks for the chosen location and can also show remote readiness.

### Compatibility Commands

Compatibility commands are old command IDs and CLI routes retained during migration.

Examples:

- `forja qt build`
- `forja sdk build`
- `forja remote qt build`
- VSCode command ID `forja.remote.qt.build`

Rules:

- Compatibility commands call the same underlying backend as the new commands.
- They are not shown in top-level help.
- VSCode compatibility commands are hidden from Command Palette with `when: false`.
- `nextActions` must use only new commands after the migration phase for that command is complete.

## Old To New Capability Map

| Old capability | New user command | Notes |
| --- | --- | --- |
| `forja qt status` | `forja status` | Included in current target and Qt readiness sections. |
| `forja sdk status` | `forja status` | Included in current target and SDK readiness sections. |
| `forja sync status` | `forja status` | Included as sync readiness, not a separate status command. |
| `forja remote status` | `forja status` | Included as remote readiness for remote-capable workspaces. |
| `forja remote workspace status` | `forja status` | Included in remote readiness. |
| `forja remote forja-bin status` | `forja status` / `forja doctor` | Lightweight path presence in status, executable/bootstrap checks in doctor. |
| `forja remote transfer status` | `forja status` | Included as transfer readiness if transfer is configured. |
| `forja qt init` | `forja init` | Runs Qt auto-detection for Qt candidates. |
| `forja sdk init` | `forja init` | Runs SDK auto-detection for SDK candidates. |
| `forja remote bootstrap` | `forja init --remote` or guided `forja doctor fix --remote` phase | Do not expose bootstrap as a primary command. |
| `forja qt projects` | `forja list` / `forja list targets` | Targets include Qt projects. |
| `forja sdk projects` | `forja list` / `forja list targets` | Targets include SDK projects. |
| `forja qt env` | `forja list env` / `forja doctor` | Candidate list in list; deep validation in doctor. |
| `forja sdk env` | `forja list env` / `forja doctor` | Candidate list in list; deep validation in doctor. |
| `forja sync servers` | `forja list servers` | Server list becomes a list category. |
| `forja sync server` | `forja list servers --detail <id>` | Detail remains read-only. |
| `forja remote repo list` | `forja list remote-repos` or remote section in `forja list` | Only needed when remote workspace mapping is configured. |
| `forja qt use` | `forja use` | Target, mode, arch, and Qt toolchain selection. |
| `forja sdk use` | `forja use` | Target, mode, arch, and SDK toolchain selection. |
| `forja sync use` | `forja use --server ... --remote-path ...` | Server and remote path selection. |
| `forja remote workspace use` | `forja use --remote-workspace ...` | Used by guided remote setup. |
| `forja remote repo set` | `forja use --remote-repo ...` or guided config file flow | User should not need this in daily workflow. |
| `forja remote forja-bin use` | `forja use --remote-forja-bin ...` | Used only when auto bootstrap/bin discovery is insufficient. |
| `forja remote transfer set` | `forja use` advanced flow or hidden compatibility route | Low-frequency artifact transfer settings do not become visible sync subcommands. |
| `forja qt qmake` | `forja build qmake` | Run the Qt qmake build step for the active target. |
| `forja remote qt qmake` | `forja build qmake` with `runAt=remote` | Run the remote Qt qmake build step. |
| `forja qt rcc` | `forja build rcc` | Run the Qt rcc resource build step for the active target. |
| `forja qt build` | `forja build` | Local Qt target. |
| `forja sdk build` | `forja build` | Local SDK target. |
| `forja remote qt build` | `forja build` with `runAt=remote` | Remote Qt target. |
| `forja remote sdk build` | `forja build` with `runAt=remote` | Remote SDK target. |
| `forja sdk rebuild` | `forja build fresh` | SDK rebuild maps to fresh build. |
| `forja remote sdk rebuild` | `forja build fresh` with `runAt=remote` | Remote SDK fresh build. |
| `forja qt run` | `forja run` | Local Qt target. |
| `forja remote qt run` | `forja run` with `runAt=remote` | Remote Qt target. |
| `forja qt ps` | `forja status` | Runtime status belongs in status. |
| `forja remote qt ps` | `forja status` | Remote runtime status belongs in status. |
| `forja qt stop` | `forja stop` | Local Qt target. |
| `forja remote qt stop` | `forja stop` with `runAt=remote` | Remote Qt target. |
| `forja qt clean` | `forja clean` | Local Qt target. |
| `forja sdk clean` | `forja clean` | Local SDK target. |
| `forja remote qt clean` | `forja clean` with `runAt=remote` | Remote Qt target. |
| `forja remote sdk clean` | `forja clean` with `runAt=remote` | Remote SDK target. |
| `forja sync` | `forja sync` | Kept as a top-level user action. |
| `forja sync --plan` | `forja sync plan` | Preview is a sync subaction, not a flag-style command. |
| `forja sync --file` | `forja sync --file` | Kept for direct file sync. |
| `forja sync test-connection` | `forja doctor` | Connection check moves to doctor. |
| `forja remote test` | `forja doctor` | Remote execution check moves to doctor. |
| `forja remote doctor` | `forja doctor` | Unified diagnostics. |
| `forja remote unlock` | `forja doctor unlock <id>` or guided recovery | Recovery action, not normal command. |
| `forja remote restore/reset/clean-untracked` | Recovery sub-flow in `forja doctor` | These are dangerous operations and should be guided. |

## Command Specifications

### `forja status`

Purpose:

- Answer "what is the current Forja state and what should I do next?"
- Remain lightweight and read-only.
- Avoid full environment probing that can be slow or invasive.

Old capabilities absorbed:

- `qt status`
- `sdk status`
- `sync status`
- `remote status`
- runtime `ps` summaries
- transfer/workspace/forja-bin readiness summaries

CLI flow:

1. Resolve workspace from `--workspace` or current directory.
2. Load unified active target metadata.
3. Load Qt settings, SDK settings, sync settings, and remote settings.
4. Scan only enough to know if candidates exist when no active target exists.
5. If active target exists:
   - Validate selected project path exists.
   - Validate saved mode and arch are acceptable.
   - Validate selected execution location has required saved settings.
   - Include runtime state for run-capable targets.
6. If active target is missing:
   - Return `ok: false` when multiple targets exist or no target is configured.
   - Return next actions `forja list` and `forja use`.
7. Include `nextActions` using only new commands.

Supported flags:

```bash
forja status
forja status --workspace <path>
forja status --json
```

Text output shape:

```text
Forja status
Workspace: C:\repo
Target: Qt apps/client/client.pro Debug x64 local
State: ready
Next: forja build
```

JSON output shape:

```json
{
  "ok": true,
  "action": "status",
  "workspace": "C:/repo",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "readiness": {
    "target": "ready",
    "sync": "configured",
    "remote": "not-selected"
  },
  "nextActions": ["forja build"]
}
```

Important edge cases:

- Mixed Qt and SDK workspace with no active target: do not choose; return `forja list` and `forja use`.
- Active Qt target missing `.pro`: return missing target diagnostic and `forja list`.
- Active SDK target missing `.sln`/`Makefile`: return missing target diagnostic and `forja list`.
- Remote selected but server missing: return `forja list servers` and `forja use --server <id> --remote-path <path>`.

VSCode behavior:

- Command title: `Forja: Status`.
- Status bar click can show the status quick pick first, then provide `Use Target`, `Build`, and `Doctor` actions.
- Existing `forja.remote.status` remains hidden and internally available during migration.

Tests:

- `src/test/unifiedCliStatus.test.ts`: mixed workspace without active target returns no guess.
- `src/test/unifiedCliStatus.test.ts`: active Qt target returns new nextActions.
- `src/test/unifiedCliStatus.test.ts`: remote selected with missing server reports `use --server`.
- `src/test/syncCommandIdsSource.test.ts`: command palette hides old status commands.

### `forja init`

Purpose:

- Perform first-run automatic discovery and write only values that can be determined without user judgment.
- Avoid selecting between multiple Qt/SDK targets.
- Avoid becoming a general configuration editor.

Old capabilities absorbed:

- `qt init`
- `sdk init`
- automatic portions of `qt env` and `sdk env`
- remote bootstrap only when explicitly requested by a guided flag

CLI flow:

1. Resolve workspace.
2. Scan Qt candidates.
3. Scan SDK candidates.
4. Detect Qt, VS, jom, make, and platform capabilities.
5. Save unambiguous toolchain defaults.
6. If exactly one target exists across Qt and SDK, save it as active target.
7. If more than one target exists, do not select; return `forja list` and `forja use`.
8. If `--remote` is supplied:
   - Check sync server selection and remote path.
   - If remote bin is missing and bootstrap artifact exists, run bootstrap.
   - If bootstrap cannot run, return `forja doctor --json` next action.

Supported flags:

```bash
forja init
forja init --workspace <path>
forja init --remote
forja init --plan
forja init --json
```

Text output shape:

```text
Forja init
Workspace: C:\repo
Detected:
  Qt targets: 2
  SDK targets: 1
Saved:
  mode: debug
  arch: x64
Next:
  forja list
  forja use
```

JSON output shape:

```json
{
  "ok": true,
  "action": "init",
  "workspace": "C:/repo",
  "detected": {
    "targets": 3,
    "qtCandidates": 2,
    "sdkCandidates": 1
  },
  "saved": {
    "mode": "debug",
    "arch": "x64"
  },
  "nextActions": ["forja list", "forja use"]
}
```

Important edge cases:

- Exactly one Qt target and no SDK target: save Qt target.
- Exactly one SDK target and no Qt target: save SDK target.
- One Qt and one SDK target: do not choose.
- Multiple Qt targets: do not choose.
- `--remote` without server: do not prompt in non-interactive mode; return `forja list servers` and `forja use --server`.

VSCode behavior:

- Command title: `Forja: Init`.
- Runs with progress notification.
- If multiple targets are found, open the same picker used by `Forja: Use Target`.

Tests:

- `src/test/unifiedCliInit.test.ts`: single Qt target is saved.
- `src/test/unifiedCliInit.test.ts`: one Qt and one SDK target is ambiguous.
- `src/test/unifiedCliInit.test.ts`: init never accepts explicit project/mode/toolchain flags except remote bootstrap flag.
- `src/test/cliEntrySource.test.ts`: top-level dispatcher exposes `init`.

### `forja list`

Purpose:

- Answer "what can I choose?"
- Remain read-only.
- Provide candidate lists for targets, environment tools, servers, and remote mappings.

Old capabilities absorbed:

- `qt projects`
- `sdk projects`
- `qt env`
- `sdk env`
- `sync servers`
- `sync server`
- `remote repo list`

CLI flow:

1. Resolve workspace.
2. Determine list category:
   - default category is `targets`.
   - supported categories: `targets`, `env`, `servers`, `remote-repos`.
3. For `targets`:
   - scan Qt `.pro` files.
   - scan SDK `.sln` or `Makefile` files.
   - mark current active target.
   - show local/remote readiness summary.
4. For `env`:
   - show Qt/VS/jom/make candidates.
   - do not write settings.
5. For `servers`:
   - show server IDs/names/hosts.
   - mark selected sync server.
6. For `remote-repos`:
   - show configured remote repo mappings.
   - show whether they map to local repo candidates.

Supported flags:

```bash
forja list
forja list targets
forja list env
forja list servers
forja list remote-repos
forja list servers --detail <id>
forja list --workspace <path>
forja list --json
```

Text output shape:

```text
Forja targets
* Qt   apps/client/client.pro       Debug x64 local
  SDK  sdk/NemoSDK.sln              Release x64 local
  Qt   tools/designer/designer.pro  not configured

Use:
  forja use --target apps/client/client.pro
```

JSON output shape:

```json
{
  "ok": true,
  "action": "list",
  "category": "targets",
  "targets": [
    {
      "kind": "qt",
      "project": "apps/client/client.pro",
      "current": true,
      "configured": true
    }
  ]
}
```

Important edge cases:

- No targets found: return `ok: false`, diagnostics, and `forja init`.
- Servers detail for unknown ID: return error and list available server IDs.
- `list env` on non-Windows should not show Windows-only arch choices as usable.

VSCode behavior:

- Command title: `Forja: List Targets`.
- Status bar target selector should use the same candidate model.
- Environment and server lists can appear as secondary quick picks from `Forja: Use Target`.

Tests:

- `src/test/unifiedCliList.test.ts`: default category lists both Qt and SDK targets.
- `src/test/unifiedCliList.test.ts`: current target marker is stable.
- `src/test/unifiedCliList.test.ts`: `list servers` uses global server store and hides passwords.
- `src/test/unifiedCliList.test.ts`: `list env` is read-only.

### `forja use`

Purpose:

- Select what Forja should use.
- Own all explicit choices: target, mode, arch, execution location, server, remote path, remote workspace, and remote helper path.
- Replace separate `qt use`, `sdk use`, `sync use`, and remote configuration commands in normal user workflows.

Old capabilities absorbed:

- `qt use`
- `sdk use`
- `sync use`
- `remote workspace use`
- `remote repo set`
- `remote repo remove`
- `remote forja-bin use`
- `remote transfer set`
- execution location commands in VSCode

CLI flow:

1. Resolve workspace.
2. If no arguments and terminal is interactive:
   - show target choices.
   - show mode/arch choices.
   - show local/remote choice.
   - if remote, show server and remote path choices.
   - save all confirmed values.
3. If arguments are supplied:
   - validate the provided fields.
   - update only provided fields.
   - preserve other active target fields.
4. If `--target` is provided:
   - infer kind from extension/pattern: `.pro` = Qt, `.sln`/`Makefile` = SDK.
   - reject unknown target type.
5. If `--kind` is provided without `--target`:
   - switch kind only when there is exactly one configured target for that kind.
   - otherwise return `forja list`.
6. If `--remote` or `--local` is provided:
   - update execution location.
7. If server or remote path fields are provided:
   - update sync/remote settings through existing settings stores.
8. Return `forja status` as the next action.

Supported flags:

```bash
forja use
forja use --target <project>
forja use --kind qt
forja use --kind sdk
forja use --mode debug|release
forja use --arch x86|x64
forja use --local
forja use --remote
forja use --server <id> --remote-path <path>
forja use --remote-workspace <path>
forja use --remote-forja-bin <path>
forja use --workspace <path>
forja use --json
```

Text output shape:

```text
Forja use
Selected:
  Target: Qt apps/client/client.pro
  Mode: Release x64
  Execution: remote
  Server: dev
Next:
  forja status
```

JSON output shape:

```json
{
  "ok": true,
  "action": "use",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "release",
    "arch": "x64",
    "runAt": "remote"
  },
  "nextActions": ["forja status"]
}
```

Important edge cases:

- `--remote` with no selected server: save execution location only when remote settings already exist; otherwise return diagnostic and next action `forja list servers`.
- `--target` outside workspace: reject.
- `--kind qt` in workspace with multiple Qt targets: reject with `forja list`.
- `--arch x86` on non-Windows: reject.
- `--target` switching from Qt to SDK preserves mode/arch only if valid for SDK platform.

VSCode behavior:

- Command title: `Forja: Use Target`.
- Status bar target segment opens this command.
- It replaces separate visible commands for Qt project selection, SDK project selection, and execution location.

Tests:

- `src/test/unifiedCliUse.test.ts`: target inference from `.pro`.
- `src/test/unifiedCliUse.test.ts`: target inference from `.sln`.
- `src/test/unifiedCliUse.test.ts`: mixed workspace requires target unless already active.
- `src/test/unifiedCliUse.test.ts`: `--remote` updates `runAt`.
- `src/test/unifiedCliUse.test.ts`: invalid arch is rejected on unsupported platform.

### `forja build`

Purpose:

- Build the current active target.
- Hide Qt/SDK/local/remote routing behind active target and `runAt`.
- Preserve standalone Qt qmake and rcc operations through `build` subactions.

Old capabilities absorbed:

- `qt qmake`
- `qt rcc`
- `qt build`
- `sdk build`
- `sdk rebuild`
- `remote qt qmake`
- `remote qt build`
- `remote sdk build`
- `remote sdk rebuild`

CLI flow:

1. Resolve workspace.
2. Load active target.
3. If active target is missing, return `forja list` and `forja use`.
4. Parse build action:
   - no action: normal build.
   - `fresh`: clean then build.
   - `qmake`: run only the Qt qmake step.
   - `rcc`: run only the Qt rcc resource step.
   - `--plan`: show commands without executing.
5. If active target is Qt local:
   - `qmake`: call existing qmake planner/runner only.
   - `rcc`: call existing rcc planner/runner only.
   - default build: ensure qmake when Makefile is missing/mismatched, run rcc when needed, then build.
   - `fresh`: clean, qmake, rcc if configured, then build.
6. If active target is SDK local:
   - default build: call SDK build.
   - `fresh`: call SDK rebuild if available or clean + build.
   - `qmake` / `rcc`: reject with target-step unsupported diagnostic.
7. If `runAt` is remote:
   - run remote preflight.
   - prepare remote workspace.
   - route to matching remote Qt/SDK action.
   - for `qmake` and `rcc`, route only when target kind supports the action.
8. Return build result using compact output rules.

Supported flags:

```bash
forja build
forja build fresh
forja build qmake
forja build rcc
forja build --plan
forja build --workspace <path>
forja build --json
```

Build action rules:

- `fresh`, `qmake`, and `rcc` are mutually exclusive positional actions.
- `--plan` can combine with one action.
- Unknown build actions fail with a list of supported actions.

Text output shape:

```text
Forja build succeeded
Target: Qt apps/client/client.pro Debug x64 local
Mode: build
```

JSON output shape:

```json
{
  "ok": true,
  "action": "build",
  "buildMode": "build",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "durationMs": 1200
}
```

Important edge cases:

- SDK target with `qmake`: return `ok: false`, message `current SDK target has no qmake build step`.
- SDK target with `rcc`: return `ok: false`, message `current SDK target has no rcc build step`.
- Remote selected but remote preflight fails: return doctor next action.
- Build failure: keep existing compact errors and log file behavior.

VSCode behavior:

- Command title: `Forja: Build`.
- Additional palette-visible command `Forja: Fresh Build` is optional only if product wants a one-click fresh build; otherwise keep it inside quick pick.
- `QMake` and `RCC` appear as quick-pick build options, not separate visible commands.

Tests:

- `src/test/unifiedCliBuild.test.ts`: Qt `build qmake` routes to qmake.
- `src/test/unifiedCliBuild.test.ts`: Qt `build rcc` routes to rcc.
- `src/test/unifiedCliBuild.test.ts`: SDK `build fresh` routes to rebuild semantics.
- `src/test/unifiedCliBuild.test.ts`: SDK `build qmake` fails clearly.
- `src/test/unifiedCliBuild.test.ts`: remote Qt build routes through remote prepared action.

### `forja run`

Purpose:

- Run the current active target when the target kind supports runtime execution.
- Keep build-before-run convenience for Qt targets.

Old capabilities absorbed:

- `qt run`
- `qt run --detach`
- `remote qt run`
- `remote qt runDetached`

CLI flow:

1. Resolve workspace.
2. Load active target.
3. If no active target, return `forja list` and `forja use`.
4. If active target kind is SDK:
   - return `ok: false`.
   - diagnostic says current SDK target has no run behavior.
   - next action is `forja build`.
5. If active target is Qt local:
   - ensure build prerequisites as current `qt run` does.
   - if `--detach`, run detached and return pid/log when available.
   - otherwise run foreground.
6. If active target is Qt remote:
   - run remote preflight.
   - prepare remote workspace.
   - execute remote Qt run.
   - `--detach` maps to remote detached run.
7. Return runtime status.

Supported flags:

```bash
forja run
forja run --detach
forja run --workspace <path>
forja run --json
```

Compatibility rule:

- Preserve current restriction that JSON run output requires detached mode unless foreground JSON streaming is explicitly implemented.

Text output shape:

```text
Forja run started
Target: Qt apps/client/client.pro Debug x64 local
PID: 12345
Log: C:\repo\.forja\logs\run.log
```

JSON output shape:

```json
{
  "ok": true,
  "action": "run",
  "activeTarget": {
    "kind": "qt",
    "project": "apps/client/client.pro",
    "mode": "debug",
    "arch": "x64",
    "runAt": "local"
  },
  "pid": 12345,
  "logFile": "C:/repo/.forja/logs/run.log"
}
```

Important edge cases:

- SDK target: fail with `forja build` next action.
- Qt target with stale Makefile: trigger build flow as current run does.
- Remote selected but remote preflight fails: return `forja doctor`.

VSCode behavior:

- Command title: `Forja: Run`.
- Status bar play button executes this command.
- If current target is SDK, play button should be build icon or show build action instead of run.

Tests:

- `src/test/unifiedCliRun.test.ts`: SDK target returns unsupported run diagnostic.
- `src/test/unifiedCliRun.test.ts`: Qt local run maps to existing Qt runner.
- `src/test/unifiedCliRun.test.ts`: remote Qt run maps to remote foreground/detached behavior.

### `forja stop`

Purpose:

- Stop the current active target when it has runtime state.

Old capabilities absorbed:

- `qt stop`
- `remote qt stop`

CLI flow:

1. Resolve workspace.
2. Load active target.
3. If no active target, return `forja list` and `forja use`.
4. If active target kind is SDK:
   - return `ok: false`.
   - diagnostic says SDK target has no tracked runtime process.
5. If Qt local:
   - call existing local stop logic.
6. If Qt remote:
   - call remote bridge stop.
7. Return stopped/not-running status.

Supported flags:

```bash
forja stop
forja stop --workspace <path>
forja stop --json
```

Text output shape:

```text
Forja stop
Target: Qt apps/client/client.pro local
State: stopped
```

JSON output shape:

```json
{
  "ok": true,
  "action": "stop",
  "state": "stopped"
}
```

Important edge cases:

- No prior run state: return `ok: true` with state `not-running`.
- Remote stop with missing server: return `forja doctor`.

VSCode behavior:

- Command title: `Forja: Stop`.
- Status bar stop icon executes this command.

Tests:

- `src/test/unifiedCliStop.test.ts`: local Qt stop routes to local backend.
- `src/test/unifiedCliStop.test.ts`: SDK stop is unsupported and clear.
- `src/test/unifiedCliStop.test.ts`: remote Qt stop routes to bridge action.

### `forja clean`

Purpose:

- Clean build outputs for the current active target.
- Hide local/remote and Qt/SDK routing.

Old capabilities absorbed:

- `qt clean`
- `sdk clean`
- `remote qt clean`
- `remote sdk clean`

CLI flow:

1. Resolve workspace.
2. Load active target.
3. If no active target, return `forja list` and `forja use`.
4. If Qt local, call Qt clean.
5. If SDK local, call SDK clean.
6. If remote, run remote preflight and matching remote clean.
7. Return clean result.

Supported flags:

```bash
forja clean
forja clean --plan
forja clean --workspace <path>
forja clean --json
```

Text output shape:

```text
Forja clean succeeded
Target: SDK sdk/NemoSDK.sln Release x64 local
```

JSON output shape:

```json
{
  "ok": true,
  "action": "clean",
  "activeTarget": {
    "kind": "sdk",
    "project": "sdk/NemoSDK.sln",
    "mode": "release",
    "arch": "x64",
    "runAt": "local"
  }
}
```

Important edge cases:

- `--plan` must not delete or modify build outputs.
- Remote clean missing preflight should return `forja doctor`.

VSCode behavior:

- Command title: `Forja: Clean`.
- Clean appears in the unified action menu.

Tests:

- `src/test/unifiedCliClean.test.ts`: Qt clean routes to Qt backend.
- `src/test/unifiedCliClean.test.ts`: SDK clean routes to SDK backend.
- `src/test/unifiedCliClean.test.ts`: remote clean routes through remote prepared action.

### `forja doctor`

Purpose:

- Perform deep diagnostics across target, toolchain, sync, and remote execution.
- Replace separate environment, connection, test, and remote doctor commands in the primary user model.

Old capabilities absorbed:

- `qt env` diagnostic role
- `sdk env` diagnostic role
- `sync test-connection`
- `remote test`
- `remote doctor`
- guided bootstrap validation
- recovery guidance for remote lock/restore/reset/clean-untracked

CLI flow:

1. Resolve workspace.
2. Load active target and settings.
3. Run local target diagnostics:
   - Qt toolchain if target is Qt or no target exists.
   - SDK toolchain if target is SDK or no target exists.
4. Run sync diagnostics:
   - server selection.
   - remote path.
   - SSH connection when configured.
5. Run remote diagnostics when execution location is remote or `--remote` is supplied:
   - remote server reachability.
   - remote Forja bin.
   - bootstrap artifact availability.
   - remote workspace and repo mapping readiness.
6. Report fix actions using new commands.
7. If `fix` is supplied:
   - run only non-destructive fixes: bootstrap missing remote Forja bin, initialize local state directories, refresh generated metadata.
   - do not run restore/reset/clean-untracked without an explicit recovery flag.

Supported flags:

```bash
forja doctor
forja doctor --remote
forja doctor fix
forja doctor fix --remote
forja doctor --workspace <path>
forja doctor --json
```

Recovery flags:

```bash
forja doctor unlock <lock-id> [--force]
forja doctor restore <repo> <paths...>
forja doctor reset <repo> <paths...>
forja doctor clean-untracked <repo> <paths...> [--recursive]
```

Recovery rules:

- Recovery actions are explicit and never inferred.
- Recovery actions must require repo and path arguments where applicable.
- Recovery text must explain that these affect remote files.

Text output shape:

```text
Forja doctor
Target: Qt apps/client/client.pro Debug x64 remote

Local toolchain: ready
Sync: ready
Remote: missing remote Forja bin

Fix:
  forja doctor fix --remote
```

JSON output shape:

```json
{
  "ok": false,
  "action": "doctor",
  "checks": [
    { "name": "localToolchain", "status": "ready" },
    { "name": "remoteForjaBin", "status": "missing" }
  ],
  "nextActions": ["forja doctor fix --remote"]
}
```

Important edge cases:

- `doctor` may be slower than `status`; keep this expected and documented.
- `fix` must not change selected target or mode.
- Missing remote server should not attempt SSH.

VSCode behavior:

- Command title: `Forja: Doctor`.
- Runs with progress.
- Results can be shown in output channel and summarized in notification.

Tests:

- `src/test/unifiedCliDoctor.test.ts`: local target diagnostics run without SSH when local target is selected.
- `src/test/unifiedCliDoctor.test.ts`: remote diagnostics include remote test checks.
- `src/test/unifiedCliDoctor.test.ts`: `fix` does not run destructive recovery.
- `src/test/unifiedCliDoctor.test.ts`: recovery flags require repo/path.

### `forja sync`

Purpose:

- Synchronize changed files to the selected remote target.
- Keep sync as a primary command because it is a user goal, not just configuration.

Old capabilities retained or absorbed:

- `sync`
- `sync plan`
- `sync --file`
- `sync reset`
- server selection from `sync use` moves to `forja use`
- server listing from `sync servers` moves to `forja list servers`
- connection testing from `sync test-connection` moves to `forja doctor`

CLI flow:

1. Resolve workspace.
2. Load sync settings.
3. If server or remote path is missing:
   - return `forja list servers`.
   - return `forja use --server <id> --remote-path <path>`.
4. If `plan`, compute changed files and print planned operations only.
5. If `--file` is supplied, sync only specified files.
6. If `--repo` is supplied, filter or override repo target as current sync supports.
7. Execute sync.
8. Return compact result.

Supported flags:

```bash
forja sync
forja sync plan
forja sync --file <path>
forja sync --repo <name-or-path>
forja sync reset
forja sync --workspace <path>
forja sync --json
```

Removed from primary sync help:

```bash
forja sync use
forja sync servers
forja sync server
forja sync add-server
forja sync update-server
forja sync remove-server
forja sync test-connection
```

Server CRUD migration:

- During the first migration phase, keep server CRUD as compatibility commands.
- New user-facing server CRUD should not be added to the primary surface until there is a real non-interactive requirement.
- If server CRUD stays necessary for scripts, keep the existing compatibility route or add a single deliberately advanced `use` flow later; do not add several visible `sync` subcommands.
- Artifact transfer status is summarized by `forja status` and checked by `forja doctor`.
- Artifact transfer configuration is a low-frequency remote setting and is not exposed as `forja sync transfer ...`.
- Artifact transfer execution is part of `forja sync` only when enabled by existing configuration.

Text output shape:

```text
Forja sync succeeded
Server: dev
Remote path: /home/dev/workspace
Files uploaded: 3
```

JSON output shape:

```json
{
  "ok": true,
  "action": "sync",
  "server": "dev",
  "remotePath": "/home/dev/workspace",
  "uploaded": 3,
  "skipped": 0
}
```

Important edge cases:

- `reset` clears local sync state and does not upload.
- Missing server must not attempt SSH.
- Password handling remains unchanged: prefer `FORJA_SSH_PASSWORD`.

VSCode behavior:

- Command title: `Forja: Sync Changes`.
- Explorer context menu can keep sync current file/changes entry.
- Server selection belongs in `Forja: Use Target` or a use sub-flow.

Tests:

- `src/test/unifiedCliSync.test.ts`: missing server reports new use/list next actions.
- `src/test/unifiedCliSync.test.ts`: `plan` preserves current dry-run behavior.
- `src/test/unifiedCliSync.test.ts`: old `sync status` nextActions no longer appear after migration phase.
- `src/test/syncCommandIdsSource.test.ts`: visible sync command set is generic.

## VSCode Command Surface

Visible commands after migration:

| Command ID | Title | Backend |
| --- | --- | --- |
| `forja.status` | `Forja: Status` | unified status |
| `forja.init` | `Forja: Init` | unified init |
| `forja.list` | `Forja: List Targets` | unified list targets |
| `forja.use` | `Forja: Use Target` | unified use |
| `forja.build` | `Forja: Build` | unified build |
| `forja.run` | `Forja: Run` | unified run |
| `forja.stop` | `Forja: Stop` | unified stop |
| `forja.clean` | `Forja: Clean` | unified clean |
| `forja.doctor` | `Forja: Doctor` | unified doctor |
| `forja.sync` | `Forja: Sync Changes` | sync |

Hidden compatibility IDs:

- All existing `forja.qt.*` command IDs.
- All existing `forja.sdk.*` command IDs.
- All existing `forja.remote.*` command IDs.
- Existing special context commands that are still needed internally, such as `forja.qt.openWithQtDesigner`, may remain context-visible where they are truly contextual.

VSCode constraints:

- Do not delete old command IDs in the first migration.
- Do not modify `activate` signature.
- New commands must be registered and added to `package.json`.
- Hide compatibility command palette entries with `menus.commandPalette` `when: false`.
- Keep Explorer context commands only when they are context-specific and not available through the main flow.

## Implementation File Structure

Create:

- `src/cli/unified/index.ts`: top-level unified command dispatcher functions.
- `src/cli/unified/types.ts`: active target, candidates, result types.
- `src/cli/unified/activeTarget.ts`: read/write active target metadata.
- `src/cli/unified/candidates.ts`: target/env/server candidate aggregation.
- `src/cli/unified/status.ts`: unified status planner.
- `src/cli/unified/use.ts`: unified use planner and persistence.
- `src/cli/unified/build.ts`: build routing.
- `src/cli/unified/doctor.ts`: unified diagnostics routing.
- `src/test/unifiedCliStatus.test.ts`
- `src/test/unifiedCliInit.test.ts`
- `src/test/unifiedCliList.test.ts`
- `src/test/unifiedCliUse.test.ts`
- `src/test/unifiedCliBuild.test.ts`
- `src/test/unifiedCliRun.test.ts`
- `src/test/unifiedCliDoctor.test.ts`
- `src/test/unifiedCliSync.test.ts`

Modify:

- `src/cli/index.ts`: route new top-level commands before compatibility subcommands.
- `src/qt/shared/qtCore.ts`: update nextActions to use new commands once unified status/use exist.
- `src/sdk/cli/index.ts`: expose reusable build/status functions or adapter hooks without importing VSCode.
- `src/sync/cli.ts`: keep execution but update nextActions and user help.
- `src/remote/cli/index.ts`: keep compatibility, expose reusable remote adapter hooks.
- `src/remote/vscode/commands.ts`: add unified command adapters or hide old remote commands.
- `src/qt/commands.ts`: keep old IDs, route visible commands through unified adapters where possible.
- `src/sdk/sdkExtension.ts`: keep old IDs, route visible commands through unified adapters where possible.
- `src/ui/unifiedStatusBar.ts`: replace Qt/SDK-specific visible actions with unified command calls.
- `package.json`: add new command contributions and hide old palette entries.
- `docs/README-cli.md`: replace old command tree with new user command model.
- `docs/cli-interface-spec.md`: document new public CLI contract.
- `skills/forja/README.md`: update AI-facing command usage.
- `scripts/build-cli.js`: include new unified CLI modules in CLI package.

## Migration Stages

### Stage 1: Add Unified Model Without Changing Existing Behavior

- [ ] Add active target types and storage helpers.
- [ ] Add candidate aggregation for Qt/SDK targets.
- [ ] Add tests for mixed workspaces and single-target auto selection.
- [ ] Keep old commands untouched.
- [ ] Verify with targeted tests:
  - `npm test -- --test-name-pattern=unifiedCli`
  - If test runner does not support name pattern, run `npm test` only after targeted source tests compile.

Acceptance:

- New modules compile.
- No user-visible command changes yet.
- Mixed workspace target ambiguity is represented in tests.

### Stage 2: Implement `status`, `list`, `use`, and `init`

- [ ] Add top-level CLI routes.
- [ ] Implement read-only `status`.
- [ ] Implement read-only `list`.
- [ ] Implement explicit `use`.
- [ ] Implement conservative `init`.
- [ ] Update old Qt/SDK nextActions that point to status/projects/use/env.
- [ ] Add VSCode commands for status/list/use/init.

Acceptance:

- `forja status --json` works with no active target.
- `forja list --json` lists Qt and SDK candidates.
- `forja use --target <path> --json` saves active target.
- `forja init --json` does not guess between one Qt and one SDK target.

### Stage 3: Implement Unified Execution Commands

- [ ] Implement `build` routing.
- [ ] Implement `build fresh`.
- [ ] Implement `build qmake`.
- [ ] Implement `build rcc`.
- [ ] Implement `run`.
- [ ] Implement `stop`.
- [ ] Implement `clean`.
- [ ] Add remote routing for selected `runAt`.
- [ ] Update status bar build/run/stop/clean calls.

Acceptance:

- `forja build --json` routes by active target.
- `forja build qmake --json` works for Qt and reports unsupported qmake step for SDK.
- `forja run --detach --json` works for Qt and fails clearly for SDK.
- Remote selected target routes through existing remote prepared/bridge actions.

### Stage 4: Implement Unified Doctor And Sync Help

- [ ] Implement `doctor` aggregation.
- [ ] Move connection tests into doctor.
- [ ] Keep `sync` execution behavior.
- [ ] Update `sync` help to remove server/config subcommands from primary workflow.
- [ ] Update `sync` missing-config nextActions to `list/use`.

Acceptance:

- `forja doctor --json` reports local target checks.
- `forja doctor --remote --json` reports remote checks without changing target.
- `forja sync plan --json` retains existing behavior.
- Missing sync configuration points to `forja list servers` and `forja use --server`.

### Stage 5: Hide Compatibility Surface

- [ ] Hide old VSCode command palette entries.
- [ ] Keep old command IDs registered.
- [ ] Update docs to show only new command surface.
- [ ] Update CLI help so old `qt`, `sdk`, `remote`, and sync config subcommands are marked compatibility or removed from primary help.
- [ ] Update AI skill docs to use new commands.

Acceptance:

- Command Palette search for `Forja` shows only the new command set plus truly contextual commands.
- `forja --help` shows the new command set.
- Old commands still execute for compatibility.

### Stage 6: Package Verification

- [ ] Run `npm run compile`.
- [ ] Run targeted node tests for unified CLI modules.
- [ ] Run `npm test`.
- [ ] Run `npm run build:cli` because CLI package gains new files.
- [ ] Do not run `npm run package:all` unless the task is explicitly packaging a release.

Acceptance:

- Compile passes.
- Tests pass.
- CLI package includes unified modules.

## Testing Matrix

| Scenario | Commands | Expected |
| --- | --- | --- |
| Empty workspace | `forja status --json` | No target, next action `forja init`. |
| One Qt target | `forja init --json` | Saves Qt active target. |
| One SDK target | `forja init --json` | Saves SDK active target. |
| One Qt + one SDK | `forja init --json` | Does not choose, next actions `forja list`, `forja use`. |
| Multiple Qt targets | `forja list --json` | Lists all `.pro` files and marks current if selected. |
| Select Qt | `forja use --target app.pro --json` | Active target kind is `qt`. |
| Select SDK | `forja use --target sdk/NemoSDK.sln --json` | Active target kind is `sdk`. |
| Qt qmake only | `forja build qmake --json` | Runs qmake route only. |
| Qt rcc only | `forja build rcc --json` | Runs rcc route only. |
| SDK qmake rejected | `forja build qmake --json` | Reports that SDK has no qmake build step. |
| SDK fresh build | `forja build fresh --json` | Uses rebuild or clean + build. |
| Qt run | `forja run --detach --json` | Returns pid/log when available. |
| SDK run rejected | `forja run --json` | Fails with `forja build` next action. |
| Remote Qt build | `forja use --remote`, `forja build --json` | Uses remote prepared Qt build. |
| Remote SDK build | `forja use --remote`, `forja build --json` | Uses remote prepared SDK build. |
| Missing remote server | `forja build --json` | Fails before SSH and points to list/use. |
| Sync missing config | `forja sync --json` | Points to list servers and use server. |
| Doctor local | `forja doctor --json` | Does not SSH unless remote selected or `--remote`. |
| Doctor remote | `forja doctor --remote --json` | Runs remote readiness checks. |

## Documentation Updates

`docs/README-cli.md` should start with the new workflow:

```bash
forja status
forja init
forja list
forja use
forja build
forja run
```

Mixed workspace example:

```bash
forja list
forja use --target apps/client/client.pro
forja build
forja use --target sdk/NemoSDK.sln
forja build fresh
```

Remote example:

```bash
forja list servers
forja use --server dev --remote-path /home/dev/workspace
forja use --remote
forja doctor --remote
forja build
```

Qt phase example:

```bash
forja build qmake
forja build rcc
forja build
```

## Compatibility Policy

First release after implementation:

- Old CLI subcommands still work.
- Old VSCode command IDs still work.
- Old commands are hidden from primary help and Command Palette.
- Old command output may include a short deprecation hint in text mode.
- JSON output should avoid noisy deprecation text unless a `warnings` field already exists.

Second release:

- Keep old command execution unless there is a strong reason to remove it.
- Do not remove published VSCode command IDs.
- Continue to hide old commands.

## Open Decisions Resolved In This Plan

- `remote` is not a top-level user command.
- `qmake` and `rcc` are not top-level user commands.
- Qt standalone phases are exposed as build subactions: `forja build qmake` and `forja build rcc`.
- `status` is lightweight and read-only.
- `doctor` is deep diagnostics and optional safe fixes.
- `list` is read-only and answers "what can I choose?"
- `use` is the only normal selection/configuration command.
- `init` only performs automatic first-run initialization and does not make ambiguous choices.

## Self-Review Notes

- Every final user command has a purpose, old-command mapping, CLI flow, flags, edge cases, VSCode behavior, and tests.
- Every old command family has a migration destination.
- No implementation step requires deleting old command IDs.
- The plan avoids `vscode` imports in CLI/shared modules by placing unified CLI logic under `src/cli/unified`.
- Remote behavior remains routed through existing remote core and VSCode adapters.
