# Qt Pilot CLI Design

Date: 2026-04-30

## Goal

Qt Pilot currently works primarily through the VSCode extension host. Its build, run, status, configuration, and task execution flows are tied to VSCode APIs such as commands, tasks, workspace configuration, status bar UI, and webviews.

The goal of this design is to make Qt Pilot usable from other tools, especially AI coding tools that can run local shell commands. The first version will provide a CLI-first interface. It will not include MCP, an HTTP service, or a new graphical UI.

The CLI should support two usage modes:

- Dry run: generate and return the command plan without mutating or executing project build state.
- Execute: run the generated plan when the caller explicitly passes an execution flag.

This gives AI tools a stable way to inspect, explain, and then execute Qt project operations after user approval.

## Non-Goals

The first version will not implement:

- MCP tools.
- A local HTTP service.
- CLI debugging support.
- Qt Designer launch support.
- A complex interactive project selection UI.
- A full rewrite of the VSCode extension.

The VSCode extension should continue to work while the CLI is introduced. Reusing the new core from the VSCode extension can happen after the CLI path is stable.

## Architecture

The implementation should introduce a VSCode-independent core and a thin CLI entry layer.

Proposed structure:

```text
src/coreCli/
    qtCore.ts
    commandRunner.ts
    localState.ts
    result.ts

src/cli/
    index.ts
    args.ts
```

Responsibilities:

- `qtCore.ts`: resolve inputs, project selection, environment detection, and command plan generation.
- `commandRunner.ts`: execute command plans or return dry-run plans.
- `localState.ts`: read and write `.work/qt-pilot` local files.
- `result.ts`: define shared result and diagnostic shapes.
- `src/cli/index.ts`: CLI command dispatch.
- `src/cli/args.ts`: parse CLI arguments and validate conflicting options.

Existing modules such as `projectManager`, `envDetector`, and `platform/*` should be reused where practical, but VSCode API dependencies must not leak into the CLI core. Any shared command-generation code that currently imports `vscode` should be split so the shell command plan can be generated without constructing `vscode.Task` or `vscode.ShellExecution`.

## CLI Commands

First-version commands:

```bash
qt-pilot init
qt-pilot detect
qt-pilot projects
qt-pilot qmake
qt-pilot build
qt-pilot run
qt-pilot stop
```

Common options:

```bash
--workspace <path>
--project <path>
--mode debug|release
--arch x86|x64
--qt-path <path>
--vs-dev-shell <path>
--target <name>
--dry-run
--execute
--save-local
--json
```

Defaults:

- `--workspace` defaults to the current working directory.
- `--mode` defaults to `debug`.
- `--arch` defaults to `x86`.
- Build actions default to dry-run.
- `init` also defaults to dry-run; it only writes files when `--execute` is passed.
- `--execute` must be explicit for execution.
- `--dry-run` and `--execute` together are invalid.
- `--json` returns structured output for AI tools.

`run --execute` should build first and run only after a successful build, matching the current extension behavior.

## Local Project State

The CLI should store local state under:

```text
.work/qt-pilot/
```

The CLI should ensure `.gitignore` contains:

```gitignore
.work/
```

This keeps machine-specific paths and AI-friendly cache files inside the project without committing them.

Suggested files:

```text
.work/qt-pilot/config.json
.work/qt-pilot/cache.json
.work/qt-pilot/logs/
```

`config.json` represents local user intent:

```json
{
  "version": 1,
  "workspace": "D:/work/demo",
  "project": "D:/work/demo/demo.pro",
  "mode": "debug",
  "arch": "x86",
  "qtPath": "D:/Qt/5.15.2/msvc2019",
  "vsDevShell": "C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/Tools/Launch-VsDevShell.ps1",
  "qmakeTarget": ""
}
```

`cache.json` represents automatically detected data that can be rebuilt:

```json
{
  "version": 1,
  "updatedAt": "2026-04-30T10:20:00.000Z",
  "detected": {
    "qt": {
      "path": "D:/Qt/5.15.2/msvc2019",
      "qmake": "D:/Qt/5.15.2/msvc2019/bin/qmake.exe"
    },
    "vs": {
      "devShellPath": "C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/Tools/Launch-VsDevShell.ps1"
    },
    "projects": [
      "D:/work/demo/demo.pro"
    ]
  }
}
```

`logs/` stores execution logs so AI tools and users can inspect failures without relying only on terminal scrollback.

Configuration priority:

```text
CLI arguments
> .work/qt-pilot/config.json
> .work/qt-pilot/cache.json
> environment variables
> automatic detection
> defaults
```

`init --execute --json` should create `.work/qt-pilot`, detect environment and projects, write local state, and ensure `.work/` is gitignored.

`detect --json` should report detection results without writing files by default. `--save-local` updates `cache.json`; it should only update `config.json` for values explicitly supplied through CLI arguments.

Build commands should read local state but should not rewrite it unless `--save-local` is passed.

## Execution Flow

The CLI should use this flow:

```text
Parse CLI arguments
-> read .work/qt-pilot/config.json
-> read .work/qt-pilot/cache.json
-> resolve missing values from environment variables
-> run automatic detection for unresolved values
-> resolve the .pro project
-> generate a command plan
-> return dry-run output or execute the plan
-> write execution logs
-> return JSON or human-readable text
```

Safety rules:

- `qmake`, `build`, `run`, and `stop` default to dry-run.
- `--execute` means the caller has already obtained user approval.
- The CLI should not show interactive confirmation prompts in normal AI workflows.
- `init --execute` may write `.work/qt-pilot/*` and `.gitignore`, but only inside the workspace.
- If `--workspace` does not exist, fail.
- If an explicit `--project` path is outside the workspace, fail.
- If exactly one `.pro` file is found, `init --execute` may save it as the selected project.
- If multiple `.pro` files are found and no `--project` is supplied, return a diagnostic that lists candidates and asks the caller to rerun with `--project`.

## JSON Result Contract

Successful dry-run example:

```json
{
  "ok": true,
  "action": "build",
  "mode": "dryRun",
  "workspace": "D:/work/demo",
  "project": "D:/work/demo/demo.pro",
  "commands": ["..."],
  "exitCode": null,
  "durationMs": 0,
  "stdout": "",
  "stderr": "",
  "logFile": null,
  "diagnostics": []
}
```

Successful execution example:

```json
{
  "ok": true,
  "action": "build",
  "mode": "execute",
  "workspace": "D:/work/demo",
  "project": "D:/work/demo/demo.pro",
  "commands": ["..."],
  "exitCode": 0,
  "durationMs": 12345,
  "stdout": "...",
  "stderr": "",
  "logFile": "D:/work/demo/.work/qt-pilot/logs/2026-04-30-build.log",
  "diagnostics": []
}
```

Failure example:

```json
{
  "ok": false,
  "action": "build",
  "mode": "execute",
  "workspace": "D:/work/demo",
  "project": "D:/work/demo/demo.pro",
  "commands": ["..."],
  "exitCode": 1,
  "durationMs": 12345,
  "stdout": "...",
  "stderr": "...",
  "logFile": "D:/work/demo/.work/qt-pilot/logs/2026-04-30-build.log",
  "diagnostics": [
    {
      "level": "error",
      "message": "构建失败",
      "hint": "请检查上一条 qmake 是否成功，或查看 logFile"
    }
  ]
}
```

Diagnostics should be concise and suitable for both humans and AI tools.

## Testing

Unit tests should cover:

- Argument parsing.
- Invalid `--dry-run` plus `--execute`.
- Configuration priority.
- `.work/qt-pilot/config.json` reading and writing.
- `.work/` gitignore handling.
- Dry-run command plan generation.
- JSON result shape.

Integration-style tests should cover:

- Fake workspace with a fake `.pro` file.
- `init --execute --json` creating local state.
- `detect --json` returning data without writing by default.
- `build --dry-run --json` returning commands without executing.
- `--execute` using a mock runner so tests do not require Qt or Visual Studio.

Manual verification should include:

```bash
npm run compile
npx tsc --noEmit
```

## Rollout

Suggested implementation phases:

1. Add shared CLI-safe core types and command plan generation.
2. Add local state management under `.work/qt-pilot`.
3. Add CLI argument parsing and command dispatch.
4. Add dry-run JSON output.
5. Add execution runner and logs.
6. Add tests.
7. Later, consider making the VSCode extension reuse the CLI-safe core.

The first release is successful when an AI tool can run `qt-pilot init --execute --json` once, then repeatedly use `qt-pilot build --json` for dry-run planning and `qt-pilot build --execute --json` for execution without rediscovering machine paths every time.
