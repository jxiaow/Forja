import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeServers } from '../core/serverStore';
import { DEFAULT_REMOTE, DEFAULT_SYNC, loadRemoteSettings, saveRemoteSettings, saveSyncSettings } from '../core/settingsIO';
import { runRemoteCli } from '../remote/cli';

const oldConfigDir = process.env.FORJA_CONFIG_DIR;
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-remote-cli-settings-'));
process.env.FORJA_CONFIG_DIR = configDir;

test.beforeEach(() => { process.exitCode = undefined; });
test.afterEach(() => { process.exitCode = undefined; });

test.after(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
    if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
});

test('remote workspace use persists staged workspace settings', async () => {
    const workspace = makeWorkspace();
    await runRemoteCli([
        'workspace',
        'use',
        '--workspace',
        workspace,
        '--mode',
        'staged',
        '--profile',
        'release',
        '--path',
        '/home/xw/workspace/forja-remote/release',
        '--json'
    ]);

    const settings = loadRemoteSettings(workspace);
    assert.equal(settings.workspaceMode, 'staged');
    assert.equal(settings.profile, 'release');
    assert.equal(settings.remoteWorkspace, '/home/xw/workspace/forja-remote/release');
});

test('remote repo set list remove and clear maintain mappings', async () => {
    const workspace = makeWorkspace();
    await runRemoteCli(['repo', 'set', '--workspace', workspace, '--local', 'qt_client', '--remote', 'qt_client', '--role', 'primary', '--overlay', 'true', '--baseline', 'auto', '--json']);
    await runRemoteCli(['repo', 'set', '--workspace', workspace, '--local', 'xylib_win32', '--remote', 'xylib_arm64', '--role', 'remote-only', '--path', '/home/xw/workspace/dev/xylib_arm64', '--overlay', 'false', '--baseline', 'status-only', '--mount', 'symlink', '--json']);

    let settings = loadRemoteSettings(workspace);
    assert.deepEqual(settings.repos, [
        { localName: 'qt_client', remoteName: 'qt_client', role: 'primary', baseline: 'auto', overlay: true },
        { localName: 'xylib_win32', remoteName: 'xylib_arm64', role: 'remote-only', remotePath: '/home/xw/workspace/dev/xylib_arm64', baseline: 'status-only', overlay: false, mount: 'symlink' }
    ]);

    await runRemoteCli(['repo', 'remove', '--workspace', workspace, '--local', 'qt_client', '--json']);
    settings = loadRemoteSettings(workspace);
    assert.deepEqual(settings.repos.map(repo => repo.localName), ['xylib_win32']);

    await runRemoteCli(['repo', 'clear', '--workspace', workspace, '--json']);
    settings = loadRemoteSettings(workspace);
    assert.deepEqual(settings.repos, []);
});

test('remote repo set persists local asset mappings for ignored dependency bundles', async () => {
    const workspace = makeWorkspace();
    await runRemoteCli([
        'repo',
        'set',
        '--workspace',
        workspace,
        '--local',
        'qt_client',
        '--remote',
        'qt_client',
        '--role',
        'primary',
        '--overlay',
        'true',
        '--baseline',
        'auto',
        '--asset',
        'XYMeetingKit_DLLs/NemoSDK/headers=XYMeetingkit_DLLs/NemoSDK/headers',
        '--json'
    ]);

    const settings = loadRemoteSettings(workspace);
    assert.deepEqual(settings.repos[0].assets, [
        {
            localPath: 'XYMeetingKit_DLLs/NemoSDK/headers',
            remotePath: 'XYMeetingkit_DLLs/NemoSDK/headers'
        }
    ]);
});

test('remote repo set rejects repo names that can escape staged workspace paths', async () => {
    const workspace = makeWorkspace();
    const output = await captureOutput(() => runRemoteCli([
        'repo',
        'set',
        '--workspace',
        workspace,
        '--local',
        'qt_client',
        '--remote',
        '../danger',
        '--role',
        'primary',
        '--json'
    ]));

    assert.equal(process.exitCode, 1);
    assert.match(output, /repo 名称不能包含路径分隔符/);
    assert.deepEqual(loadRemoteSettings(workspace).repos, []);
});

test('remote transfer status uses the primary staged repo path for artifact sources', async () => {
    const workspace = makeWorkspace();
    writeServers([
        { id: 'build', name: 'build', host: '127.0.0.1', port: 22, username: 'xw', authMode: 'password', privateKeyPath: '', password: '' },
        { id: 'deploy', name: 'deploy', host: '127.0.0.2', port: 22, username: 'deploy', authMode: 'key', privateKeyPath: '~/.ssh/id_rsa', password: '' }
    ]);
    saveSyncSettings(workspace, {
        ...DEFAULT_SYNC,
        enabled: true,
        selectedServer: 'build',
        remotePaths: { build: '/home/xw/workspace/dev' },
        ignore: []
    });
    saveRemoteSettings(workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release',
        remoteWorkspace: '/home/xw/workspace/forja-remote/release',
        repos: [{ localName: 'qt_client', remoteName: 'qt', role: 'primary', baseline: 'auto', overlay: true }],
        transfer: { deployServer: 'deploy', deployPath: '/opt/app', artifacts: ['build_linux/release/app'] }
    });

    const output = await captureOutput(() => runRemoteCli(['transfer', 'status', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.status.plan[0].source, '/home/xw/workspace/forja-remote/release/qt/build_linux/release/app');
});

test('remote target config flags are passed through to qt use prepared flow', async () => {
    const workspace = makeWorkspace();
    const output = await captureOutput(() => runRemoteCli([
        'qt',
        'use',
        '--workspace',
        workspace,
        '--mode',
        'release',
        '--arch',
        'x64',
        '--json'
    ]));

    assert.equal(process.exitCode, 1);
    assert.doesNotMatch(output, /--mode 只能用于 remote workspace use/);
    assert.match(output, /"action": "preparedAction"/);
    assert.doesNotMatch(output, /"action": "bridge"/);
});

test('remote workspace clear preserves build-order and transfer settings', async () => {
    const workspace = makeWorkspace();
    saveRemoteSettings(workspace, {
        ...DEFAULT_REMOTE,
        buildOrder: [{ target: 'qt', action: 'build', args: [] }],
        transfer: { deployServer: 'deploy', deployPath: '/opt/app', artifacts: ['app'] },
        workspaceMode: 'staged',
        profile: 'release',
        remoteWorkspace: '/remote/release',
        repos: [{ localName: 'qt_client', remoteName: 'qt_client', role: 'primary' }]
    });

    await runRemoteCli(['workspace', 'clear', '--workspace', workspace, '--json']);

    const settings = loadRemoteSettings(workspace);
    assert.equal(settings.workspaceMode, 'legacy');
    assert.equal(settings.profile, '');
    assert.equal(settings.remoteWorkspace, '');
    assert.deepEqual(settings.repos, []);
    assert.deepEqual(settings.buildOrder, [{ target: 'qt', action: 'build', args: [] }]);
    assert.deepEqual(settings.transfer, { deployServer: 'deploy', deployPath: '/opt/app', artifacts: ['app'] });
});

test('remote forja-bin use and clear persist remote forja binary override', async () => {
    const workspace = makeWorkspace();

    await runRemoteCli(['forja-bin', 'use', '--workspace', workspace, '--path', '/home/xw/.forja/bin/forja-with-icu55', '--json']);
    let settings = loadRemoteSettings(workspace);
    assert.equal(settings.remoteForjaBin, '/home/xw/.forja/bin/forja-with-icu55');

    await runRemoteCli(['forja-bin', 'clear', '--workspace', workspace, '--json']);
    settings = loadRemoteSettings(workspace);
    assert.equal(settings.remoteForjaBin, '');
});

test('remote workspace use accepts legacy staged mode as staged compatibility', async () => {
    const workspace = makeWorkspace();

    await runRemoteCli(['workspace', 'use', '--workspace', workspace, '--mode', 'managed', '--path', '/remote/release', '--json']);

    const settings = loadRemoteSettings(workspace);
    assert.equal(settings.workspaceMode, 'staged');
});

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-remote-cli-workspace-'));
    return workspace;
}

async function captureOutput(fn: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const oldLog = console.log;
    const oldError = console.error;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
        await fn();
    } finally {
        console.log = oldLog;
        console.error = oldError;
    }
    return lines.join('\n');
}
