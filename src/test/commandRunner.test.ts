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
        candidates: [],
        nextActions: [],
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        logFile: null,
        diagnostics: [],
        resolved: null
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
        candidates: [],
        nextActions: [],
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
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

test('runCliResult reports a helpful error when run cannot resolve executable', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-runner-'));
    const project = path.join(workspace, 'demo.pro');
    fs.writeFileSync(project, 'TARGET = demo\n', 'utf8');

    const result = await runCliResult({
        ok: true,
        action: 'run',
        mode: 'execute',
        workspace,
        project,
        commands: ['node -e "process.exit(0)"'],
        candidates: [],
        nextActions: [],
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        logFile: null,
        diagnostics: [],
        resolved: {
            mode: 'debug',
            arch: 'x86',
            qtPath: '',
            vsDevShell: '',
            qmakeTarget: ''
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics[result.diagnostics.length - 1].message, /无法确定可执行文件路径/);
    assert.match(result.nextActions[result.nextActions.length - 1], /qmake --execute/);
});
