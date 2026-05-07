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
