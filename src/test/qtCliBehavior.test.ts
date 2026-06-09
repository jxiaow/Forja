import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runQtCli } from '../qt/cli';
import { runSyncCli } from '../sync/cli';
import { runLogPath, writeRunState } from '../qt/shared/localState';
import { saveSyncSettings, DEFAULT_SYNC } from '../core/settingsIO';
import { writeServers } from '../core/serverStore';

const _tmpDirs: string[] = [];
const _oldConfigDir = process.env.FORJA_CONFIG_DIR;
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cli-config-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;
_tmpDirs.push(_testConfigDir);

after(() => {
    if (_oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = _oldConfigDir; }
    for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); }
});
beforeEach(() => { process.exitCode = undefined; });
afterEach(() => { process.exitCode = undefined; });

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cli-'));
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

test('forja sync --plan returns target server and pending files', async () => {
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

    const output = await captureStdout(() => runSyncCli(['--workspace', workspace, '--plan', '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'sync');
    assert.equal(data.mode, 'dryRun');
    assert.equal(data.server, 'dev');
    assert.equal(data.remotePath, '/remote/app');
    assert.ok(data.pending.includes(path.basename(workspace) + '/main.cpp'));
    assert.equal(process.exitCode, 0);
});

test('forja sync --plan --file only returns the selected file', async () => {
    const workspace = makeWorkspace();
    cp.execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'main.cpp'), 'int main() { return 0; }\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'src', 'other.cpp'), 'int other() { return 1; }\n', 'utf8');

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

    const output = await captureStdout(() => runSyncCli([
        '--workspace', workspace,
        '--plan',
        '--json',
        '--file', path.join('src', 'main.cpp')
    ]));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.deepEqual(data.pending, [path.basename(workspace) + '/src/main.cpp']);
    assert.equal(process.exitCode, 0);
});

test('forja sync --plan sets exit code when planning fails', async () => {
    const workspace = makeWorkspace();

    const output = await captureStdout(() => runSyncCli(['--workspace', workspace, '--plan', '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, false);
    assert.equal(data.action, 'sync');
    assert.equal(process.exitCode, 1);
});

test('forja sync status --json reports missing sync configuration', async () => {
    const workspace = makeWorkspace();
    writeServers([]);

    const output = await captureStdout(() => runSyncCli(['status', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, false);
    assert.equal(data.action, 'status');
    assert.equal(data.ready, false);
    assert.equal(data.checks.enabled, false);
    assert.equal(data.checks.servers, false);
    assert.equal(data.checks.selectedServer, false);
    assert.equal(data.checks.remotePath, false);
    assert.deepEqual(data.missing, ['enabled', 'servers', 'selectedServer', 'remotePath']);
    assert.equal(process.exitCode, 1);
});

test('forja sync status --json reports ready sync target without git repository', async () => {
    const workspace = makeWorkspace();

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

    const output = await captureStdout(() => runSyncCli(['status', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'status');
    assert.equal(data.ready, true);
    assert.equal(data.server.id, 'server-1');
    assert.equal(data.server.name, 'dev');
    assert.equal(data.remotePath, '/remote/app');
    assert.deepEqual(data.missing, []);
    assert.equal(process.exitCode, 0);
});

test('qt ps --json reports no detached run state', async () => {
    const workspace = makeWorkspace();

    const output = await captureStdout(() => runQtCli(['ps', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, false);
    assert.equal(data.action, 'ps');
    assert.equal(data.running, false);
    assert.equal(data.pid, null);
    assert.equal(data.executablePath, null);
    assert.equal(data.logFile, null);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'workspace'), false);
    assert.ok(Array.isArray(data.diagnostics));
    assert.equal(process.exitCode, 1);
});

test('qt ps --json reports stopped state with previous log path', async () => {
    const workspace = makeWorkspace();
    const logFile = runLogPath(workspace);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'line 1\nline 2\n', 'utf8');
    writeRunState(workspace, {
        pid: 99999999,
        exePath: 'demo',
        executablePath: '/tmp/missing-app',
        logFile,
        startedAt: new Date().toISOString()
    });

    const output = await captureStdout(() => runQtCli(['ps', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'ps');
    assert.equal(data.running, false);
    assert.equal(data.pid, null);
    assert.equal(data.executablePath, '/tmp/missing-app');
    assert.equal(data.logFile, logFile);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'tail'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'workspace'), false);
    assert.equal(process.exitCode, 0);
});

test('qt ps --json reports running target pid without launcher pid', async () => {
    const workspace = makeWorkspace();
    const logFile = runLogPath(workspace);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'line 1\nline 2\n', 'utf8');
    writeRunState(workspace, {
        pid: 99999999,
        exePath: 'launcher',
        executablePath: process.execPath,
        logFile,
        startedAt: new Date().toISOString()
    });

    const output = await captureStdout(() => runQtCli(['ps', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'ps');
    assert.equal(data.running, true);
    assert.equal(data.pid, process.pid);
    assert.equal(data.executablePath, process.execPath);
    assert.equal(data.logFile, logFile);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'launcherPid'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'workspace'), false);
    assert.equal(process.exitCode, 0);
});
