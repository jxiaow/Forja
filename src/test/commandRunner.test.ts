import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCliResult } from '../qt/shared/commandRunner';
import { readRunState } from '../qt/shared/localState';
import type { PlatformRunExecutor, PlatformRunRequest } from '../qt/platform/runExecutor';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

test('runCliResult leaves dry run results unexecuted', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const result = await runCliResult({
        ok: true,
        action: 'build',
        mode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['exit 12'],
        shellCommand: 'exit 12',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        diagnostics: [],
        resolved: null
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, null);
    assert.equal(result.logFile, null);
});

test('runCliResult executes commands and writes logs', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const result = await runCliResult({
        ok: true,
        action: 'build',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "console.log(123)"'],
        shellCommand: 'node -e "console.log(123)"',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        diagnostics: [],
        resolved: null
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /123/);
    assert.equal(result.logFile !== null, true);
    assert.equal(fs.existsSync(result.logFile as string), true);
});

test('runCliResult treats foreground app exit as successful run after build succeeds', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const result = await runCliResult({
        ok: true,
        action: 'run',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "console.log(\'build ok\')"', 'node -e "console.log(\'app closed\'); process.exit(7)"'],
        shellCommand: '',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        executablePath: path.join(workspace, 'demo.exe'),
        diagnostics: [],
        resolved: null
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /build ok/);
    assert.match(result.stdout, /app closed/);
    assert.equal(result.runtimeExitCode, 7);
    assert.equal(result.diagnostics.some(d => d.level === 'error'), false);
});

test('runCliResult resolves a relative project cwd from workspace', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const projectDir = path.join(workspace, 'src', 'app');
    fs.mkdirSync(projectDir, { recursive: true });
    const result = await runCliResult({
        ok: true,
        action: 'run',
        mode: 'execute',
        workspace,
        project: 'src/app/demo.pro',
        commands: ['node -e "process.exit(0)"', 'node -e "console.log(process.cwd())"'],
        shellCommand: '',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        executablePath: path.join(projectDir, 'demo'),
        diagnostics: [],
        resolved: null
    });

    assert.equal(result.ok, true);
    assert.match(result.stdout, new RegExp(projectDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('runCliResult still fails foreground run when build fails', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const result = await runCliResult({
        ok: true,
        action: 'run',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "console.error(\'build failed\'); process.exit(3)"', 'node -e "console.log(\'should not run\')"'],
        shellCommand: '',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        executablePath: path.join(workspace, 'demo.exe'),
        diagnostics: [],
        resolved: null
    });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 3);
    assert.match(result.stderr, /build failed/);
    assert.doesNotMatch(result.stdout, /should not run/);
    assert.equal(result.diagnostics.some(d => d.message === '编译失败'), true);
});

test('runCliResult streams platform runner output and preserves runtime exit code', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const requests: PlatformRunRequest[] = [];
    const runExecutor: PlatformRunExecutor = {
        async execute(request) {
            requests.push(request);
            request.onStdout?.(Buffer.from('desktop stdout\n'));
            request.onStderr?.(Buffer.from('desktop stderr\n'));
            return { pid: 4321, exitCode: 7 };
        }
    };

    const result = await runCliResult({
        ok: true,
        action: 'run',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "process.exit(0)"', 'this command must not execute'],
        shellCommand: '',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        executablePath: path.join(workspace, 'demo.exe'),
        diagnostics: [],
        resolved: null
    }, { runExecutor });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].detached, false);
    assert.match(result.stdout, /desktop stdout/);
    assert.match(result.stderr, /desktop stderr/);
    assert.equal(result.runtimeExitCode, 7);
});

test('runCliResult treats Ctrl+C as an intentional runtime stop', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const runExecutor: PlatformRunExecutor = {
        async execute() {
            process.emit('SIGINT');
            return { pid: 4321, exitCode: 1 };
        }
    };

    const result = await runCliResult({
        ok: true,
        action: 'run',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "process.exit(0)"', 'this command must not execute'],
        shellCommand: '',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        executablePath: path.join(workspace, 'demo.exe'),
        diagnostics: [],
        resolved: null
    }, { runExecutor });

    assert.equal(result.runtimeExitCode, 0);
    assert.equal(result.diagnostics.some(d => d.level === 'warning'), false);
});

test('runCliResult detach run returns target process pid', async (t) => {
    if (process.platform === 'win32') {
        t.skip('Windows process path lookup is covered by localState parser tests');
        return;
    }

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runner-'));
    _tmpDirs.push(workspace);
    const runner = path.join(workspace, 'target-runner.js');
    fs.writeFileSync(runner, 'setTimeout(() => {}, 5000);\n', 'utf8');

    const result = await runCliResult({
        ok: true,
        action: 'run',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "process.exit(0)"', `node "${runner}"`],
        shellCommand: '',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        executablePath: runner,
        diagnostics: [],
        resolved: null
    }, { detach: true });

    assert.equal(result.ok, true);
    assert.equal(typeof result.pid, 'number');
    assert.notEqual(result.pid, 0);
    assert.equal(readRunState(workspace)?.pid, result.pid);

    if (result.pid) {
        try { process.kill(result.pid, 'SIGTERM'); } catch { /* already exited */ }
    }
});
