import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runQtCli } from '../qt/cli';
import { runLogPath, writeRunState } from '../qt/shared/localState';
import { saveSyncSettings, DEFAULT_SYNC } from '../core/settingsIO';
import { writeServers } from '../core/serverStore';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });
beforeEach(() => { process.exitCode = undefined; });
afterEach(() => { process.exitCode = undefined; });

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-cli-'));
    _tmpDirs.push(workspace);
    return workspace;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const oldLog = console.log;
    console.log = (message?: unknown) => { chunks.push(String(message ?? '')); };
    try {
        await fn();
    } finally {
        console.log = oldLog;
    }
    return chunks.join('\n');
}

test('qt sync --plan returns target server and pending files', async () => {
    const workspace = makeWorkspace();
    cp.execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
    fs.writeFileSync(path.join(workspace, 'main.cpp'), 'int main() { return 0; }\n', 'utf8');

    writeServers([{
        id: 'server-1',
        name: 'dev',
        host: '127.0.0.1',
        port: 22,
        username: 'dev',
        authMode: 'key',
        privateKeyPath: '/tmp/nonexistent-key',
        password: ''
    }]);
    saveSyncSettings(workspace, {
        ...DEFAULT_SYNC,
        enabled: true,
        selectedServer: 'server-1',
        remotePaths: { 'server-1': '/remote/app' },
        ignore: []
    });

    const output = await captureStdout(() => runQtCli(['sync', '--workspace', workspace, '--plan', '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'sync');
    assert.equal(data.mode, 'dryRun');
    assert.equal(data.server, 'dev');
    assert.equal(data.remotePath, '/remote/app');
    assert.ok(data.pending.includes(path.basename(workspace) + '/main.cpp'));
    assert.equal(process.exitCode, 0);
});

test('qt sync --plan sets exit code when planning fails', async () => {
    const workspace = makeWorkspace();

    const output = await captureStdout(() => runQtCli(['sync', '--workspace', workspace, '--plan', '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, false);
    assert.equal(data.action, 'sync');
    assert.equal(process.exitCode, 1);
});

test('qt logs --json includes action and workspace when no log exists', async () => {
    const workspace = makeWorkspace();

    const output = await captureStdout(() => runQtCli(['logs', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, false);
    assert.equal(data.action, 'logs');
    assert.equal(data.workspace, workspace);
    assert.ok(Array.isArray(data.diagnostics));
    assert.equal(process.exitCode, 1);
});

test('qt logs --json includes action and workspace when log exists', async () => {
    const workspace = makeWorkspace();
    const logFile = runLogPath(workspace);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'line 1\nline 2\n', 'utf8');
    writeRunState(workspace, { pid: process.pid, exePath: 'demo', logFile, startedAt: new Date().toISOString() });

    const output = await captureStdout(() => runQtCli(['logs', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'logs');
    assert.equal(data.workspace, workspace);
    assert.equal(data.logFile, logFile);
    assert.match(data.tail, /line 2/);
    assert.equal(process.exitCode, 0);
});
