# Qt Pilot CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI-first Qt Pilot interface that AI tools can call with dry-run planning, explicit execution, JSON output, and project-local `.work/qt-pilot` state.

**Architecture:** Add a VSCode-independent CLI core for argument parsing, local state, command planning, and execution. Keep the existing VSCode extension working by wrapping shared shell-plan generation from `src/platform/shellPlan.ts` inside the existing `vscode.Task` builder.

**Tech Stack:** TypeScript, Node.js `node:test`, Node `fs/path/child_process`, existing Qt Pilot platform configs and environment detection.

---

## File Structure

- Create `src/platform/shellPlan.ts`: VSCode-free `BuildConfig`, `CommandPlan`, and `createShellPlanBuilder`.
- Modify `src/platform/builder.ts`: keep the VSCode-facing `PlatformBuilder`, delegate command construction to `shellPlan.ts`.
- Modify `src/platform/platformConfig.ts`, `src/platform/win/builder.ts`, `src/platform/linux/builder.ts`: import `BuildConfig` from `shellPlan.ts`.
- Create `src/cli/types.ts`: CLI action, mode, arch, diagnostic, and JSON result types.
- Create `src/cli/args.ts`: parse `qt-pilot` command-line arguments without third-party packages.
- Create `src/coreCli/localState.ts`: read and write `.work/qt-pilot/config.json`, `.work/qt-pilot/cache.json`, logs, and `.gitignore`.
- Create `src/coreCli/qtCore.ts`: resolve effective config, project, environment, and command plans.
- Create `src/coreCli/commandRunner.ts`: dry-run and execute command plans.
- Create `src/cli/index.ts`: CLI entry point and output formatting.
- Modify `package.json`: add `bin`, compile-safe CLI entry metadata, and a `test` script.
- Create tests in `src/test/cliArgs.test.ts`, `src/test/localState.test.ts`, `src/test/shellPlan.test.ts`, `src/test/qtCore.test.ts`, and `src/test/commandRunner.test.ts`.

---

### Task 1: Extract VSCode-Free Shell Plan Generation

**Files:**
- Create: `src/platform/shellPlan.ts`
- Modify: `src/platform/builder.ts`
- Modify: `src/platform/platformConfig.ts`
- Modify: `src/platform/win/builder.ts`
- Modify: `src/platform/linux/builder.ts`
- Test: `src/test/shellPlan.test.ts`

- [ ] **Step 1: Write the failing shell plan test**

Create `src/test/shellPlan.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShellPlanBuilder, BuildConfig } from '../platform/shellPlan';
import { winConfig } from '../platform/win/builder';

const cfg: BuildConfig = {
    vsDevShell: 'C:/VS/Common7/Tools/Launch-VsDevShell.ps1',
    qtPath: 'D:/Qt/5.15.2/msvc2019',
    projectDir: 'D:/demo',
    proFile: 'demo.pro',
    arch: 'x86',
    mode: 'debug',
    qmakeTarget: ''
};

test('shell plan builder creates qmake command without vscode dependency', () => {
    const builder = createShellPlanBuilder(winConfig);
    const plan = builder.qmakeCommands(cfg);

    assert.equal(plan.matcher, '$msCompile');
    assert.deepEqual(plan.commands, [
        'call "C:/VS/Common7/Tools/VsDevCmd.bat" -arch=x86 -no_logo',
        'cd /d "D:/demo"',
        'qmake demo.pro -spec win32-msvc CONFIG+=debug CONFIG+=console CONFIG+=x86'
    ]);
});

test('shell plan builder exposes shell execution metadata', () => {
    const builder = createShellPlanBuilder(winConfig);
    const exec = builder.makeCommandLine(['one', 'two']);

    assert.equal(exec.commandLine, 'one && two');
    assert.equal(exec.shellExecutable, 'cmd.exe');
    assert.deepEqual(exec.shellArgs, ['/c']);
});
```

- [ ] **Step 2: Run the shell plan test to verify it fails**

Run:

```bash
npm run compile
node out/test/shellPlan.test.js
```

Expected: compile fails because `src/platform/shellPlan.ts` does not exist.

- [ ] **Step 3: Create the VSCode-free shell plan module**

Create `src/platform/shellPlan.ts`:

```typescript
import { PlatformConfig } from './platformConfig';

export interface BuildConfig {
    vsDevShell: string;
    qtPath: string;
    projectDir: string;
    proFile: string;
    arch: string;
    mode: string;
    qmakeTarget: string;
}

export interface ShellCommandLine {
    commandLine: string;
    shellExecutable: string | null;
    shellArgs: string[] | null;
}

export interface CommandPlan {
    commands: string[];
    matcher: string | string[];
}

export interface ShellPlanBuilder {
    makeCommandLine(commands: string[]): ShellCommandLine;
    killApp(exeName: string): string;
    qmakeCommands(cfg: BuildConfig, extraConfigs?: string[]): CommandPlan;
    buildCommands(cfg: BuildConfig): CommandPlan;
    cleanCommands(cfg: BuildConfig): CommandPlan;
    stopCommands(exeName: string): string[];
}

export function createShellPlanBuilder(config: PlatformConfig): ShellPlanBuilder {
    function assembleCommands(cfg: BuildConfig, specificCmds: string[]): string[] {
        return [
            ...config.initCommands(cfg),
            config.cdCommand(cfg.projectDir),
            ...specificCmds
        ];
    }

    return {
        makeCommandLine(commands: string[]): ShellCommandLine {
            return {
                commandLine: commands.join(config.commandJoiner),
                shellExecutable: config.shellExecutable,
                shellArgs: config.shellArgs
            };
        },

        killApp(exeName: string): string {
            return config.killCommand(exeName);
        },

        qmakeCommands(cfg: BuildConfig, extraConfigs: string[] = []): CommandPlan {
            const modeConfigs = cfg.mode === 'debug'
                ? ['CONFIG+=debug', 'CONFIG+=console']
                : ['CONFIG+=release', 'CONFIG+=console'];
            const extra = config.qmakeExtraArgs(cfg);
            const targetArg = cfg.qmakeTarget ? ` "TARGET=${cfg.qmakeTarget}"` : '';
            const configArgs = [...modeConfigs, ...extraConfigs].join(' ');
            const qmakeCmd = `qmake ${cfg.proFile} -spec ${config.qmakeSpec} ${configArgs}${extra ? ' ' + extra : ''}${targetArg}`;
            return {
                commands: assembleCommands(cfg, [qmakeCmd]),
                matcher: config.qmakeMatcher
            };
        },

        buildCommands(cfg: BuildConfig): CommandPlan {
            return {
                commands: assembleCommands(cfg, [config.buildCommand]),
                matcher: config.buildMatcher
            };
        },

        cleanCommands(cfg: BuildConfig): CommandPlan {
            return {
                commands: assembleCommands(cfg, [config.cleanCommand]),
                matcher: config.cleanMatcher
            };
        },

        stopCommands(exeName: string): string[] {
            return config.stopCommands(exeName);
        }
    };
}
```

- [ ] **Step 4: Modify platform config imports**

In `src/platform/platformConfig.ts`, replace:

```typescript
import { BuildConfig } from './builder';
```

with:

```typescript
import { BuildConfig } from './shellPlan';
```

In `src/platform/win/builder.ts` and `src/platform/linux/builder.ts`, replace:

```typescript
import { BuildConfig } from '../builder';
```

with:

```typescript
import { BuildConfig } from '../shellPlan';
```

- [ ] **Step 5: Keep the VSCode builder as a wrapper**

Modify `src/platform/builder.ts` so it imports `BuildConfig`, `CommandPlan`, and `createShellPlanBuilder` from `shellPlan.ts`, then wraps `makeCommandLine` in `vscode.ShellExecution`:

```typescript
import * as vscode from 'vscode';
import { PlatformConfig } from './platformConfig';
import {
    BuildConfig,
    CommandPlan,
    createShellPlanBuilder
} from './shellPlan';

export { BuildConfig };

export interface PlatformBuilder {
    makeExec(commands: string[]): vscode.ShellExecution;
    killApp(exeName: string): string;
    qmakeCommands(cfg: BuildConfig, extraConfigs?: string[]): CommandPlan;
    buildCommands(cfg: BuildConfig): CommandPlan;
    cleanCommands(cfg: BuildConfig): CommandPlan;
    stopCommands(exeName: string): string[];
}

export function createBuilder(config: PlatformConfig): PlatformBuilder {
    const shellBuilder = createShellPlanBuilder(config);

    return {
        makeExec(commands: string[]): vscode.ShellExecution {
            const shell = shellBuilder.makeCommandLine(commands);
            if (shell.shellExecutable) {
                return new vscode.ShellExecution(shell.commandLine, {
                    executable: shell.shellExecutable,
                    shellArgs: shell.shellArgs || []
                });
            }
            return new vscode.ShellExecution(shell.commandLine);
        },

        killApp(exeName: string): string {
            return shellBuilder.killApp(exeName);
        },

        qmakeCommands(cfg: BuildConfig, extraConfigs?: string[]): CommandPlan {
            return shellBuilder.qmakeCommands(cfg, extraConfigs);
        },

        buildCommands(cfg: BuildConfig): CommandPlan {
            return shellBuilder.buildCommands(cfg);
        },

        cleanCommands(cfg: BuildConfig): CommandPlan {
            return shellBuilder.cleanCommands(cfg);
        },

        stopCommands(exeName: string): string[] {
            return shellBuilder.stopCommands(exeName);
        }
    };
}
```

- [ ] **Step 6: Run tests and compile**

Run:

```bash
npm run compile
node out/test/shellPlan.test.js
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

```bash
git add src/platform/shellPlan.ts src/platform/builder.ts src/platform/platformConfig.ts src/platform/win/builder.ts src/platform/linux/builder.ts src/test/shellPlan.test.ts
git commit -m "feat: extract shell command planning"
```

---

### Task 2: Add CLI Types and Argument Parsing

**Files:**
- Create: `src/cli/types.ts`
- Create: `src/cli/args.ts`
- Test: `src/test/cliArgs.test.ts`

- [ ] **Step 1: Write failing CLI argument tests**

Create `src/test/cliArgs.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../cli/args';

test('parseCliArgs defaults build to dryRun and current workspace marker', () => {
    const parsed = parseCliArgs(['build']);

    assert.equal(parsed.action, 'build');
    assert.equal(parsed.executionMode, 'dryRun');
    assert.equal(parsed.mode, null);
    assert.equal(parsed.arch, null);
    assert.equal(parsed.workspace, null);
    assert.equal(parsed.json, false);
});

test('parseCliArgs accepts execute json and typed options', () => {
    const parsed = parseCliArgs([
        'run',
        '--execute',
        '--json',
        '--workspace',
        'D:/demo',
        '--project',
        'D:/demo/demo.pro',
        '--mode',
        'release',
        '--arch',
        'x64',
        '--qt-path',
        'D:/Qt',
        '--vs-dev-shell',
        'C:/VS/Launch-VsDevShell.ps1',
        '--target',
        'demo'
    ]);

    assert.equal(parsed.action, 'run');
    assert.equal(parsed.executionMode, 'execute');
    assert.equal(parsed.json, true);
    assert.equal(parsed.workspace, 'D:/demo');
    assert.equal(parsed.project, 'D:/demo/demo.pro');
    assert.equal(parsed.mode, 'release');
    assert.equal(parsed.arch, 'x64');
    assert.equal(parsed.qtPath, 'D:/Qt');
    assert.equal(parsed.vsDevShell, 'C:/VS/Launch-VsDevShell.ps1');
    assert.equal(parsed.target, 'demo');
});

test('parseCliArgs rejects dry-run and execute together', () => {
    assert.throws(
        () => parseCliArgs(['build', '--dry-run', '--execute']),
        /不能同时使用 --dry-run 和 --execute/
    );
});

test('parseCliArgs rejects unknown action', () => {
    assert.throws(
        () => parseCliArgs(['deploy']),
        /未知命令/
    );
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npm run compile
node out/test/cliArgs.test.js
```

Expected: compile fails because `src/cli/args.ts` and `src/cli/types.ts` do not exist.

- [ ] **Step 3: Add CLI shared types**

Create `src/cli/types.ts`:

```typescript
export type CliAction = 'init' | 'detect' | 'projects' | 'qmake' | 'build' | 'run' | 'stop';
export type CliExecutionMode = 'dryRun' | 'execute';
export type CliBuildMode = 'debug' | 'release';
export type CliArch = 'x86' | 'x64';
export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface CliOptions {
    action: CliAction;
    executionMode: CliExecutionMode;
    workspace: string | null;
    project: string | null;
    mode: CliBuildMode | null;
    arch: CliArch | null;
    qtPath: string | null;
    vsDevShell: string | null;
    target: string | null;
    saveLocal: boolean;
    json: boolean;
}

export interface CliDiagnostic {
    level: DiagnosticLevel;
    message: string;
    hint?: string;
}

export interface CliResult {
    ok: boolean;
    action: CliAction;
    mode: CliExecutionMode;
    workspace: string;
    project: string | null;
    commands: string[];
    exitCode: number | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    logFile: string | null;
    diagnostics: CliDiagnostic[];
}
```

- [ ] **Step 4: Add the argument parser**

Create `src/cli/args.ts`:

```typescript
import {
    CliAction,
    CliArch,
    CliBuildMode,
    CliExecutionMode,
    CliOptions
} from './types';

const actions = new Set<string>(['init', 'detect', 'projects', 'qmake', 'build', 'run', 'stop']);

function readValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} 需要一个值`);
    }
    return value;
}

function parseMode(value: string): CliBuildMode {
    if (value === 'debug' || value === 'release') {
        return value;
    }
    throw new Error('--mode 只支持 debug 或 release');
}

function parseArch(value: string): CliArch {
    if (value === 'x86' || value === 'x64') {
        return value;
    }
    throw new Error('--arch 只支持 x86 或 x64');
}

export function parseCliArgs(args: string[]): CliOptions {
    const actionText = args[0];
    if (!actionText || !actions.has(actionText)) {
        throw new Error(`未知命令: ${actionText || ''}`);
    }

    let explicitDryRun = false;
    let explicitExecute = false;
    let executionMode: CliExecutionMode = 'dryRun';
    const options: CliOptions = {
        action: actionText as CliAction,
        executionMode,
        workspace: null,
        project: null,
        mode: null,
        arch: null,
        qtPath: null,
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: false
    };

    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--workspace':
                options.workspace = readValue(args, i, arg);
                i++;
                break;
            case '--project':
                options.project = readValue(args, i, arg);
                i++;
                break;
            case '--mode':
                options.mode = parseMode(readValue(args, i, arg));
                i++;
                break;
            case '--arch':
                options.arch = parseArch(readValue(args, i, arg));
                i++;
                break;
            case '--qt-path':
                options.qtPath = readValue(args, i, arg);
                i++;
                break;
            case '--vs-dev-shell':
                options.vsDevShell = readValue(args, i, arg);
                i++;
                break;
            case '--target':
                options.target = readValue(args, i, arg);
                i++;
                break;
            case '--dry-run':
                explicitDryRun = true;
                executionMode = 'dryRun';
                break;
            case '--execute':
                explicitExecute = true;
                executionMode = 'execute';
                break;
            case '--save-local':
                options.saveLocal = true;
                break;
            case '--json':
                options.json = true;
                break;
            default:
                throw new Error(`未知参数: ${arg}`);
        }
    }

    if (explicitDryRun && explicitExecute) {
        throw new Error('不能同时使用 --dry-run 和 --execute');
    }

    options.executionMode = executionMode;
    return options;
}
```

- [ ] **Step 5: Run the argument tests**

Run:

```bash
npm run compile
node out/test/cliArgs.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/types.ts src/cli/args.ts src/test/cliArgs.test.ts
git commit -m "feat: add cli argument parsing"
```

---

### Task 3: Add Local Project State

**Files:**
- Create: `src/coreCli/localState.ts`
- Test: `src/test/localState.test.ts`

- [ ] **Step 1: Write failing local state tests**

Create `src/test/localState.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureLocalStateDir,
    ensureWorkGitignored,
    readLocalConfig,
    writeLocalConfig,
    writeLocalCache
} from '../coreCli/localState';

function makeWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-local-state-'));
}

test('local state writes and reads config under .work/qt-pilot', () => {
    const workspace = makeWorkspace();
    ensureLocalStateDir(workspace);
    writeLocalConfig(workspace, {
        version: 1,
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        qmakeTarget: ''
    });

    const config = readLocalConfig(workspace);
    assert.equal(config?.workspace, workspace);
    assert.equal(config?.mode, 'debug');
});

test('ensureWorkGitignored appends .work once', () => {
    const workspace = makeWorkspace();
    ensureWorkGitignored(workspace);
    ensureWorkGitignored(workspace);

    const gitignore = fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8');
    assert.equal(gitignore.split('.work/').length - 1, 1);
});

test('writeLocalCache records detected data separately from config', () => {
    const workspace = makeWorkspace();
    writeLocalCache(workspace, {
        version: 1,
        updatedAt: '2026-04-30T00:00:00.000Z',
        detected: {
            qt: { path: 'D:/Qt', qmake: 'D:/Qt/bin/qmake.exe' },
            vs: { devShellPath: 'C:/VS/Launch-VsDevShell.ps1' },
            projects: [path.join(workspace, 'demo.pro')]
        }
    });

    assert.equal(fs.existsSync(path.join(workspace, '.work', 'qt-pilot', 'cache.json')), true);
    assert.equal(fs.existsSync(path.join(workspace, '.work', 'qt-pilot', 'config.json')), false);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npm run compile
node out/test/localState.test.js
```

Expected: compile fails because `src/coreCli/localState.ts` does not exist.

- [ ] **Step 3: Implement local state helpers**

Create `src/coreCli/localState.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { CliArch, CliBuildMode } from '../cli/types';

export interface LocalConfig {
    version: 1;
    workspace: string;
    project: string;
    mode: CliBuildMode;
    arch: CliArch;
    qtPath: string;
    vsDevShell: string;
    qmakeTarget: string;
}

export interface LocalCache {
    version: 1;
    updatedAt: string;
    detected: {
        qt: { path: string; qmake: string } | null;
        vs: { devShellPath: string } | null;
        projects: string[];
    };
}

export function localRoot(workspace: string): string {
    return path.join(workspace, '.work', 'qt-pilot');
}

export function configPath(workspace: string): string {
    return path.join(localRoot(workspace), 'config.json');
}

export function cachePath(workspace: string): string {
    return path.join(localRoot(workspace), 'cache.json');
}

export function logsDir(workspace: string): string {
    return path.join(localRoot(workspace), 'logs');
}

export function ensureLocalStateDir(workspace: string): void {
    fs.mkdirSync(localRoot(workspace), { recursive: true });
    fs.mkdirSync(logsDir(workspace), { recursive: true });
}

function readJson<T>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function readLocalConfig(workspace: string): LocalConfig | null {
    return readJson<LocalConfig>(configPath(workspace));
}

export function writeLocalConfig(workspace: string, config: LocalConfig): void {
    writeJson(configPath(workspace), config);
}

export function readLocalCache(workspace: string): LocalCache | null {
    return readJson<LocalCache>(cachePath(workspace));
}

export function writeLocalCache(workspace: string, cache: LocalCache): void {
    writeJson(cachePath(workspace), cache);
}

export function ensureWorkGitignored(workspace: string): void {
    const gitignorePath = path.join(workspace, '.gitignore');
    const existing = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, 'utf8')
        : '';
    const lines = existing.split(/\r?\n/).map(line => line.trim());
    if (lines.includes('.work/')) {
        return;
    }
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, `${existing}${prefix}.work/\n`, 'utf8');
}
```

- [ ] **Step 4: Run local state tests**

Run:

```bash
npm run compile
node out/test/localState.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/coreCli/localState.ts src/test/localState.test.ts
git commit -m "feat: add local cli state"
```

---

### Task 4: Add CLI Core Resolution and Command Planning

**Files:**
- Create: `src/coreCli/qtCore.ts`
- Test: `src/test/qtCore.test.ts`

- [ ] **Step 1: Write failing core planning tests**

Create `src/test/qtCore.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createActionPlan } from '../coreCli/qtCore';
import { writeLocalConfig } from '../coreCli/localState';

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-core-'));
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core gui widgets\n', 'utf8');
    return workspace;
}

test('createActionPlan uses local config when CLI args are omitted', async () => {
    const workspace = makeWorkspace();
    const project = path.join(workspace, 'demo.pro');
    writeLocalConfig(workspace, {
        version: 1,
        workspace,
        project,
        mode: 'release',
        arch: 'x64',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        qmakeTarget: ''
    });

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: null,
        mode: null,
        arch: null,
        qtPath: null,
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.workspace, workspace);
    assert.equal(result.project, project);
    assert.match(result.commands.join('\n'), /jom/);
});

test('createActionPlan reports multiple projects without explicit project', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'other.pro'), 'TARGET = other\n', 'utf8');

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: null,
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].level, 'error');
    assert.match(result.diagnostics[0].message, /发现多个 .pro 文件/);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npm run compile
node out/test/qtCore.test.js
```

Expected: compile fails because `src/coreCli/qtCore.ts` does not exist.

- [ ] **Step 3: Implement core planning**

Create `src/coreCli/qtCore.ts` with these exported functions and behavior:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { CliOptions, CliResult } from '../cli/types';
import { detectEnv } from '../env/envDetector';
import { scanProFiles } from '../project/projectManager';
import { createShellPlanBuilder } from '../platform/shellPlan';
import { winConfig } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import {
    LocalCache,
    LocalConfig,
    ensureLocalStateDir,
    ensureWorkGitignored,
    readLocalCache,
    readLocalConfig,
    writeLocalCache,
    writeLocalConfig
} from './localState';

function emptyResult(options: CliOptions, workspace: string): CliResult {
    return {
        ok: false,
        action: options.action,
        mode: options.executionMode,
        workspace,
        project: null,
        commands: [],
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        logFile: null,
        diagnostics: []
    };
}

function resolveWorkspace(input: string | null): string {
    return path.resolve(input || process.cwd());
}

function insideWorkspace(workspace: string, filePath: string): boolean {
    const rel = path.relative(workspace, filePath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveProject(workspace: string, options: CliOptions, config: LocalConfig | null): { project: string | null; error: string | null } {
    const explicitProject = options.project ? path.resolve(options.project) : null;
    if (explicitProject) {
        if (!insideWorkspace(workspace, explicitProject)) {
            return { project: null, error: '.pro 文件必须位于 workspace 内' };
        }
        return { project: explicitProject, error: null };
    }
    if (config?.project && fs.existsSync(config.project)) {
        return { project: config.project, error: null };
    }
    const found = scanProFiles(workspace).map(rel => path.join(workspace, rel));
    if (found.length === 1) {
        return { project: found[0], error: null };
    }
    if (found.length > 1) {
        return { project: null, error: `发现多个 .pro 文件: ${found.join(', ')}。请使用 --project 指定。` };
    }
    return { project: null, error: '未找到 .pro 文件。请使用 --project 指定。' };
}

async function detectAndCache(workspace: string, options: CliOptions): Promise<LocalCache> {
    const env = await detectEnv(options.qtPath || undefined, options.vsDevShell || undefined);
    const qtPath = env.qt?.path || options.qtPath || '';
    const cache: LocalCache = {
        version: 1,
        updatedAt: new Date().toISOString(),
        detected: {
            qt: qtPath ? {
                path: qtPath,
                qmake: path.join(qtPath, 'bin', process.platform === 'win32' ? 'qmake.exe' : 'qmake')
            } : null,
            vs: env.vs?.devShellPath ? { devShellPath: env.vs.devShellPath } : null,
            projects: scanProFiles(workspace).map(rel => path.join(workspace, rel))
        }
    };
    return cache;
}

export async function createActionPlan(options: CliOptions): Promise<CliResult> {
    const workspace = resolveWorkspace(options.workspace);
    const result = emptyResult(options, workspace);

    if (!fs.existsSync(workspace)) {
        result.diagnostics.push({ level: 'error', message: `workspace 不存在: ${workspace}` });
        return result;
    }

    const config = readLocalConfig(workspace);
    const cache = readLocalCache(workspace);
    const projectResult = resolveProject(workspace, options, config);
    if (projectResult.error) {
        result.diagnostics.push({ level: 'error', message: projectResult.error });
        return result;
    }

    const project = projectResult.project;
    const projectDir = project ? path.dirname(project) : workspace;
    const proFile = project ? path.basename(project) : '';
    const mode = options.mode || config?.mode || 'debug';
    const arch = options.arch || config?.arch || 'x86';
    const qtPath = options.qtPath || config?.qtPath || cache?.detected.qt?.path || process.env.QT_PILOT_QT_PATH || '';
    const vsDevShell = options.vsDevShell || config?.vsDevShell || cache?.detected.vs?.devShellPath || process.env.QT_PILOT_VS_DEV_SHELL || '';
    const qmakeTarget = options.target || config?.qmakeTarget || '';

    if (options.action === 'init') {
        if (options.executionMode === 'execute') {
            ensureLocalStateDir(workspace);
            ensureWorkGitignored(workspace);
            const detected = await detectAndCache(workspace, options);
            writeLocalCache(workspace, detected);
            if (project) {
                writeLocalConfig(workspace, {
                    version: 1,
                    workspace,
                    project,
                    mode,
                    arch,
                    qtPath: qtPath || detected.detected.qt?.path || '',
                    vsDevShell: vsDevShell || detected.detected.vs?.devShellPath || '',
                    qmakeTarget
                });
            }
        }
        return { ...result, ok: true, project, diagnostics: [] };
    }

    const shellBuilder = createShellPlanBuilder(process.platform === 'win32' ? winConfig : linuxConfig);
    const buildConfig = { vsDevShell, qtPath, projectDir, proFile, arch, mode, qmakeTarget };
    let commands: string[] = [];
    if (options.action === 'qmake') {
        commands = shellBuilder.qmakeCommands(buildConfig).commands;
    } else if (options.action === 'build' || options.action === 'run') {
        commands = shellBuilder.buildCommands(buildConfig).commands;
    } else if (options.action === 'stop') {
        commands = shellBuilder.stopCommands(path.basename(project || 'app', '.pro'));
    } else if (options.action === 'detect' || options.action === 'projects') {
        const detected = await detectAndCache(workspace, options);
        if (options.saveLocal) {
            ensureLocalStateDir(workspace);
            writeLocalCache(workspace, detected);
        }
        return { ...result, ok: true, project, diagnostics: [], commands: [] };
    }

    return {
        ...result,
        ok: true,
        project,
        commands,
        diagnostics: []
    };
}
```

- [ ] **Step 4: Run core tests**

Run:

```bash
npm run compile
node out/test/qtCore.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/coreCli/qtCore.ts src/test/qtCore.test.ts
git commit -m "feat: add cli command planning core"
```

---

### Task 5: Add Command Runner

**Files:**
- Create: `src/coreCli/commandRunner.ts`
- Test: `src/test/commandRunner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `src/test/commandRunner.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCliResult } from '../coreCli/commandRunner';

test('runCliResult leaves dry run results unexecuted', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-runner-'));
    const result = await runCliResult({
        ok: true,
        action: 'build',
        mode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['exit 12'],
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        logFile: null,
        diagnostics: []
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, null);
    assert.equal(result.logFile, null);
});

test('runCliResult executes commands and writes logs', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-runner-'));
    const result = await runCliResult({
        ok: true,
        action: 'build',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "console.log(123)"'],
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        logFile: null,
        diagnostics: []
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /123/);
    assert.equal(result.logFile !== null, true);
    assert.equal(fs.existsSync(result.logFile as string), true);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npm run compile
node out/test/commandRunner.test.js
```

Expected: compile fails because `src/coreCli/commandRunner.ts` does not exist.

- [ ] **Step 3: Implement the runner**

Create `src/coreCli/commandRunner.ts`:

```typescript
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CliResult } from '../cli/types';
import { ensureLocalStateDir, logsDir } from './localState';

function logFileFor(workspace: string, action: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(logsDir(workspace), `${stamp}-${action}.log`);
}

function execute(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.exec(commandLine, { cwd, windowsHide: true }, (error, stdout, stderr) => {
            const exitCode = typeof (error as cp.ExecException | null)?.code === 'number'
                ? ((error as cp.ExecException).code as number)
                : 0;
            resolve({ exitCode, stdout, stderr });
        });
    });
}

export async function runCliResult(result: CliResult): Promise<CliResult> {
    if (!result.ok || result.mode === 'dryRun') {
        return result;
    }

    const started = Date.now();
    const commandLine = result.commands.join(process.platform === 'win32' ? ' && ' : ' && ');
    const executed = await execute(commandLine, result.workspace);
    const durationMs = Date.now() - started;
    ensureLocalStateDir(result.workspace);
    const filePath = logFileFor(result.workspace, result.action);
    fs.writeFileSync(filePath, [
        `$ ${commandLine}`,
        '',
        executed.stdout,
        executed.stderr
    ].join('\n'), 'utf8');

    return {
        ...result,
        ok: executed.exitCode === 0,
        exitCode: executed.exitCode,
        durationMs,
        stdout: executed.stdout,
        stderr: executed.stderr,
        logFile: filePath,
        diagnostics: executed.exitCode === 0
            ? result.diagnostics
            : [
                ...result.diagnostics,
                {
                    level: 'error',
                    message: '命令执行失败',
                    hint: '请查看 logFile 中的 stdout 和 stderr'
                }
            ]
    };
}
```

- [ ] **Step 4: Run runner tests**

Run:

```bash
npm run compile
node out/test/commandRunner.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/coreCli/commandRunner.ts src/test/commandRunner.test.ts
git commit -m "feat: add cli command runner"
```

---

### Task 6: Add CLI Entry Point and Package Metadata

**Files:**
- Create: `src/cli/index.ts`
- Modify: `package.json`
- Test: `src/test/cliEntrySource.test.ts`

- [ ] **Step 1: Write failing entry source test**

Create `src/test/cliEntrySource.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('package exposes qt-pilot bin entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.bin['qt-pilot'], './out/cli/index.js');
});

test('cli entry handles parse errors as json when requested', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /parseCliArgs/);
    assert.match(source, /JSON\.stringify/);
    assert.match(source, /process\.exitCode = 1/);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npm run compile
node out/test/cliEntrySource.test.js
```

Expected: compile or test fails because the CLI entry and `bin` metadata are missing.

- [ ] **Step 3: Add CLI entry point**

Create `src/cli/index.ts`:

```typescript
#!/usr/bin/env node
import { parseCliArgs } from './args';
import { CliResult } from './types';
import { createActionPlan } from '../coreCli/qtCore';
import { runCliResult } from '../coreCli/commandRunner';

function textOutput(result: CliResult): string {
    const status = result.ok ? '成功' : '失败';
    const lines = [
        `Qt Pilot ${result.action} ${status}`,
        `模式: ${result.mode}`,
        `工作区: ${result.workspace}`
    ];
    if (result.project) {
        lines.push(`项目: ${result.project}`);
    }
    if (result.commands.length > 0) {
        lines.push('命令:');
        for (const cmd of result.commands) {
            lines.push(`  ${cmd}`);
        }
    }
    for (const diagnostic of result.diagnostics) {
        lines.push(`${diagnostic.level}: ${diagnostic.message}`);
        if (diagnostic.hint) {
            lines.push(`hint: ${diagnostic.hint}`);
        }
    }
    return lines.join('\n');
}

async function main(argv: string[]): Promise<void> {
    let wantsJson = argv.includes('--json');
    try {
        const options = parseCliArgs(argv);
        wantsJson = options.json;
        const planned = await createActionPlan(options);
        const result = await runCliResult(planned);
        if (wantsJson) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(textOutput(result));
        }
        process.exitCode = result.ok ? 0 : 1;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (wantsJson) {
            console.log(JSON.stringify({
                ok: false,
                diagnostics: [{ level: 'error', message }]
            }, null, 2));
        } else {
            console.error(message);
        }
        process.exitCode = 1;
    }
}

void main(process.argv.slice(2));
```

- [ ] **Step 4: Modify package metadata**

In `package.json`, add:

```json
"bin": {
  "qt-pilot": "./out/cli/index.js"
}
```

Also add a test script:

```json
"test": "npm run compile && node --test out/test/*.test.js"
```

Keep existing scripts unchanged.

- [ ] **Step 5: Run CLI entry tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts package.json package-lock.json src/test/cliEntrySource.test.ts
git commit -m "feat: add qt pilot cli entry"
```

---

### Task 7: Verify CLI Scenarios Manually

**Files:**
- Modify only if earlier verification exposes a defect.

- [ ] **Step 1: Compile**

Run:

```bash
npm run compile
```

Expected: TypeScript emits to `out/` with no errors.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: every `node:test` test passes.

- [ ] **Step 3: Smoke test dry-run JSON parse error**

Run:

```bash
node out/cli/index.js build --dry-run --execute --json
```

Expected: exit code `1`, JSON output with `ok: false`, and diagnostic message `不能同时使用 --dry-run 和 --execute`.

- [ ] **Step 4: Smoke test projects without workspace mutation**

Run:

```bash
node out/cli/index.js projects --workspace . --json
```

Expected: JSON output with `ok: true` if project resolution succeeds or `ok: false` with a clear diagnostic. The command must not create `.work/qt-pilot` unless `--save-local` or `init --execute` is used.

- [ ] **Step 5: Smoke test init writes local state**

Run:

```bash
node out/cli/index.js init --workspace . --execute --json
```

Expected: JSON output with `ok: true`, `.work/qt-pilot/config.json` or `.work/qt-pilot/cache.json` exists, and `.gitignore` contains `.work/`.

- [ ] **Step 6: Clean smoke-test local state from the repo workspace**

Run:

```bash
Remove-Item -LiteralPath .work -Recurse -Force
```

Expected: `.work` is removed from the repo workspace after smoke testing. Keep `.gitignore` changes only if they were already part of the implementation decision and are intended for the repo.

- [ ] **Step 7: Commit final verification fixes**

If manual verification required fixes, commit them:

```bash
git add src package.json package-lock.json .gitignore
git commit -m "fix: stabilize qt pilot cli"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

Spec coverage:

- CLI-first interface: Tasks 2, 4, and 6.
- Dry-run default and explicit execution: Tasks 2, 4, and 5.
- JSON result contract: Tasks 2, 5, and 6.
- `.work/qt-pilot` local state and `.work/` gitignore: Task 3 and Task 7.
- Reuse existing command generation without VSCode dependency: Task 1.
- No MCP, HTTP service, debug, or Designer support: omitted from tasks by design.

Type consistency:

- `CliExecutionMode` uses `dryRun` and `execute`.
- `CliOptions.executionMode` feeds `CliResult.mode`.
- `BuildConfig` is exported from `src/platform/shellPlan.ts` and re-exported from `src/platform/builder.ts` for existing imports.
- `LocalConfig.qmakeTarget` maps to `BuildConfig.qmakeTarget`.

Verification:

- Run `npm run compile`.
- Run `npm test`.
- Run the three CLI smoke commands in Task 7.
