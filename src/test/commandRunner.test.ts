import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCliResult } from '../qt/shared/commandRunner';
import { readRunState } from '../qt/shared/localState';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

test('runCliResult leaves dry run results unexecuted', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-runner-'));
    _tmpDirs.push(workspace);
    const result = await runCliResult({
        ok: true,
        action: 'build',
        mode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['exit 12'],
        shellCommand: 'exit 12',
        nextActions: [],
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
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-runner-'));
    _tmpDirs.push(workspace);
    const result = await runCliResult({
        ok: true,
        action: 'build',
        mode: 'execute',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        commands: ['node -e "console.log(123)"'],
        shellCommand: 'node -e "console.log(123)"',
        nextActions: [],
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

test('runCliResult detach run returns target process pid', async (t) => {
    if (process.platform === 'win32') {
        t.skip('Windows process path lookup is covered by localState parser tests');
        return;
    }

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-runner-'));
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
        nextActions: [],
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
