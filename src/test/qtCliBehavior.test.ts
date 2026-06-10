import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runQtCli } from '../qt/cli';
import { runSyncCli } from '../sync/cli';
import { runLogPath, writeRunState } from '../qt/shared/localState';
import { saveQtSettings, saveSyncSettings, loadSyncSettings, DEFAULT_QT, DEFAULT_SYNC } from '../core/settingsIO';
import { writeServers } from '../core/serverStore';
import { markSyncedBatch } from '../core/syncState';

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

test('qt env text shows mode and arch candidates without mandatory json hint', async () => {
    const workspace = makeWorkspace();

    const output = await captureStdout(() => runQtCli(['env', '--workspace', workspace]));

    assert.match(output, /可用 mode:/);
    assert.match(output, /debug/);
    assert.match(output, /release/);
    assert.match(output, /可用 arch:/);
    assert.match(output, /修改: forja qt use --mode <mode> --qt-path <path> \[options\]/);
    assert.doesNotMatch(output, /修改: .*--json/);
});

test('qt projects text use hint includes optional target without mandatory json hint', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core\n', 'utf8');

    const output = await captureStdout(() => runQtCli(['projects', '--workspace', workspace]));

    assert.match(output, /修改: forja qt use --project <path> \[--target <name>\]/);
    assert.doesNotMatch(output, /修改: .*--json/);
});

test('qt init text includes env next step for auto-selected Qt path without mandatory json hints', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'a.pro'), 'TARGET = a\nQT += core\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'b.pro'), 'TARGET = b\nQT += core\n', 'utf8');

    const oldPath = process.env.FORJA_QT_PATH;
    process.env.FORJA_QT_PATH = 'D:/Qt/auto';
    try {
        const output = await captureStdout(() => runQtCli(['init', '--workspace', workspace]));

        assert.match(output, /warning: 部分配置为自动选择/);
        assert.match(output, /下一步:/);
        assert.match(output, /forja qt env/);
        assert.match(output, /forja qt projects/);
        assert.match(output, /forja qt use --project <path>/);
        assert.doesNotMatch(output, /下一步:[\s\S]*--json/);
    } finally {
        if (oldPath === undefined) { delete process.env.FORJA_QT_PATH; }
        else { process.env.FORJA_QT_PATH = oldPath; }
    }
});


test('qt status reports current target in json and text output', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core\n', 'utf8');
    saveQtSettings(workspace, {
        ...DEFAULT_QT,
        pinnedProject: { root: workspace, relative: 'demo.pro' },
        mode: 'debug',
        arch: process.platform === 'win32' ? 'x86' : 'x64',
        qtPath: 'D:/Qt'
    });

    const jsonOutput = await captureStdout(() => runQtCli(['status', '--workspace', workspace, '--json']));
    const data = JSON.parse(jsonOutput);
    assert.equal(data.ok, true);
    assert.equal(data.resolved.target, 'demo');

    const textOutput = await captureStdout(() => runQtCli(['status', '--workspace', workspace]));
    assert.match(textOutput, /Target: demo/);
});

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

test('forja sync --plan accepts absolute remote repo path for single local repo', async () => {
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

    const remoteRepoPath = '/home/xylink/hudsonbuild/workspace/workspace/linux_app_arm64_jxw';
    const output = await captureStdout(() => runSyncCli([
        '--workspace', workspace,
        '--server', 'server-1',
        '--repo', remoteRepoPath,
        '--plan',
        '--json'
    ]));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.remotePath, remoteRepoPath);
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

test('forja sync --plan reports skipped file reasons', async () => {
    const workspace = makeWorkspace();
    cp.execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'build'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'main.cpp'), 'int main() { return 0; }\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'build', 'temp.o'), 'object\n', 'utf8');

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
        ignore: ['build']
    });
    markSyncedBatch(workspace, ['src/main.cpp'], {
        serverId: 'server-1',
        serverName: 'dev',
        remotePath: '/remote/app/' + path.basename(workspace)
    });

    const output = await captureStdout(() => runSyncCli(['--workspace', workspace, '--plan', '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.deepEqual(data.pending, []);
    assert.deepEqual(data.skippedDetails, [
        { file: path.basename(workspace) + '/build/temp.o', reason: 'ignored' },
        { file: path.basename(workspace) + '/src/main.cpp', reason: 'alreadySynced' }
    ]);
});

test('forja sync --plan text lists skipped file reasons', async () => {
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
    markSyncedBatch(workspace, ['main.cpp'], {
        serverId: 'server-1',
        serverName: 'dev',
        remotePath: '/remote/app/' + path.basename(workspace)
    });

    const output = await captureStdout(() => runSyncCli(['--workspace', workspace, '--plan']));

    assert.match(output, /跳过明细:/);
    assert.match(output, new RegExp(path.basename(workspace) + '/main\\.cpp \\(alreadySynced\\)'));
});

test('forja sync reset clears sync state so files can be planned again', async () => {
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
    markSyncedBatch(workspace, ['main.cpp'], {
        serverId: 'server-1',
        serverName: 'dev',
        remotePath: '/remote/app/' + path.basename(workspace)
    });

    const resetOutput = await captureStdout(() => runSyncCli(['reset', '--workspace', workspace, '--json']));
    const resetData = JSON.parse(resetOutput);
    const planOutput = await captureStdout(() => runSyncCli(['--workspace', workspace, '--plan', '--json']));
    const planData = JSON.parse(planOutput);

    assert.equal(resetData.ok, true);
    assert.equal(resetData.action, 'reset');
    assert.ok(planData.pending.includes(path.basename(workspace) + '/main.cpp'));
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
    assert.equal(data.nextAction, 'servers');
    assert.ok(data.nextActions.includes('forja sync servers --json'));
    assert.ok(data.nextActions.includes('forja sync add-server --name <name> --host <host> --username <name> --json'));
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
    assert.equal(data.nextAction, 'sync');
    assert.ok(data.nextActions.includes('forja sync --plan --json'));
    assert.ok(data.nextActions.includes('forja sync test-connection --json'));
    assert.equal(process.exitCode, 0);
});

test('forja sync use persists selected server and remote path', async () => {
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

    const output = await captureStdout(() => runSyncCli([
        'use',
        '--workspace', workspace,
        '--server', 'server-1',
        '--remote-path', '/remote/app',
        '--enable',
        '--json'
    ]));
    const data = JSON.parse(output);
    const saved = loadSyncSettings(workspace);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'use');
    assert.equal(data.selectedServer, 'server-1');
    assert.equal(data.remotePath, '/remote/app');
    assert.equal(saved.enabled, true);
    assert.equal(saved.selectedServer, 'server-1');
    assert.equal(saved.remotePaths['server-1'], '/remote/app');
    assert.deepEqual(data.nextActions, [
        'forja sync status --json',
        'forja sync test-connection --json',
        'forja sync --plan --json'
    ]);
    assert.equal(process.exitCode, 0);
});

test('forja sync server reports selected server details and remote path', async () => {
    const workspace = makeWorkspace();
    writeServers([{
        id: 'server-1',
        name: 'dev',
        host: '127.0.0.1',
        port: 22,
        username: 'dev',
        authMode: 'key',
        privateKeyPath: '/tmp/nonexistent-key',
        password: '',
        strictHostKeyChecking: true
    }]);
    saveSyncSettings(workspace, {
        ...DEFAULT_SYNC,
        enabled: true,
        selectedServer: 'server-1',
        remotePaths: { 'server-1': '/remote/app' },
        ignore: []
    });

    const output = await captureStdout(() => runSyncCli(['server', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'server');
    assert.equal(data.server.id, 'server-1');
    assert.equal(data.server.host, '127.0.0.1');
    assert.equal(data.server.privateKeyPath, '/tmp/nonexistent-key');
    assert.equal(data.server.strictHostKeyChecking, true);
    assert.equal(data.remotePath, '/remote/app');
    assert.equal(data.selected, true);
    assert.equal(process.exitCode, 0);
});

test('forja sync test-connection reports missing password without spawning ssh', async () => {
    const workspace = makeWorkspace();
    writeServers([{
        id: 'server-1',
        name: 'dev',
        host: '127.0.0.1',
        port: 22,
        username: 'dev',
        authMode: 'password',
        privateKeyPath: '',
        password: ''
    }]);
    saveSyncSettings(workspace, {
        ...DEFAULT_SYNC,
        enabled: true,
        selectedServer: 'server-1',
        remotePaths: { 'server-1': '/remote/app' },
        ignore: []
    });

    const output = await captureStdout(() => runSyncCli(['test-connection', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, false);
    assert.equal(data.action, 'test-connection');
    assert.match(data.diagnostics[0].message, /未提供密码/);
    assert.ok(data.nextActions.includes('设置环境变量 FORJA_SSH_PASSWORD 后重试'));
    assert.equal(process.exitCode, 1);
});

test('forja sync help documents workflow and persistent use command', async () => {
    const output = await captureStdout(() => runSyncCli(['--help']));

    assert.match(output, /forja sync use --server <id>/);
    assert.match(output, /forja sync test-connection/);
    assert.match(output, /--server .*临时/);
    assert.match(output, /use .*保存/);
});

test('forja sync server management commands update global servers', async () => {
    writeServers([]);

    const addOutput = await captureStdout(() => runSyncCli([
        'add-server',
        '--name', 'dev',
        '--host', '127.0.0.1',
        '--port', '2222',
        '--username', 'alice',
        '--auth-mode', 'key',
        '--private-key-path', '/tmp/key',
        '--json'
    ]));
    const added = JSON.parse(addOutput);
    assert.equal(added.ok, true);
    assert.equal(added.action, 'add-server');
    assert.equal(added.server.name, 'dev');
    assert.equal(added.server.port, 2222);

    const listOutput = await captureStdout(() => runSyncCli(['servers', '--json']));
    const listed = JSON.parse(listOutput);
    assert.equal(listed.ok, true);
    assert.equal(listed.action, 'servers');
    assert.equal(listed.servers.length, 1);
    assert.equal(listed.servers[0].id, added.server.id);
    assert.equal(listed.servers[0].host, '127.0.0.1');

    const updateOutput = await captureStdout(() => runSyncCli([
        'update-server',
        '--server', added.server.id,
        '--host', '10.0.0.2',
        '--port', '22',
        '--json'
    ]));
    const updated = JSON.parse(updateOutput);
    assert.equal(updated.ok, true);
    assert.equal(updated.action, 'update-server');
    assert.equal(updated.server.host, '10.0.0.2');
    assert.equal(updated.server.port, 22);

    const removeOutput = await captureStdout(() => runSyncCli([
        'remove-server',
        '--server', added.server.id,
        '--json'
    ]));
    const removed = JSON.parse(removeOutput);
    assert.equal(removed.ok, true);
    assert.equal(removed.action, 'remove-server');
    assert.equal(removed.server.id, added.server.id);
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
