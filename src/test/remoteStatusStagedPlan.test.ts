import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import { DEFAULT_REMOTE, projectConfigPath, saveRemoteSettings } from '../core/settingsIO';
import { resolveRemoteActionPath } from '../remote/core/config';
import { buildRemoteStatus, buildRemoteTest } from '../remote/core/status';
import { RemoteConfig, RemoteRunner } from '../remote/core/types';

const oldConfigDir = process.env.FORJA_CONFIG_DIR;

test('staged remote status keeps planning repos when remote forja is missing', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-status-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release';
    const commands: string[] = [];

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('printf forja-remote-ok')) {
                return { exitCode: 0, stdout: 'forja-remote-ok', stderr: '' };
            }
            if (command.includes('uname -s')) {
                return { exitCode: 0, stdout: 'Linux\n', stderr: '' };
            }
            if (command.includes('$(npm prefix -g)/bin/forja') && command.includes('--version')) {
                return { exitCode: 127, stdout: '', stderr: 'not found' };
            }
            if (command.includes('printf "path:%s\\n"')) {
                return { exitCode: 0, stdout: 'path:/home/xw/workspace/forja-remote/release/app\nmode:files\nmissing:true\n', stderr: '' };
            }
            if (command.includes('lock_file=')) {
                return { exitCode: 0, stdout: 'absent\n', stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const config: RemoteConfig = {
        workspace: fixture.workspace,
        server: { id: 'wsl', name: 'wsl', host: '172.31.158.44', username: 'xw', port: 22, authMode: 'password', privateKeyPath: '', password: '' },
        remotePath: '/home/xw/workspace/dev',
        ignore: []
    };

    try {
        const result = await buildRemoteStatus({ workspace: fixture.workspace, config, runner });

        assert.equal(result.overall, 'degraded');
        assert.equal(result.remotePath, stagedWorkspace);
        assert.equal(result.remotePlan?.stagedWorkspace, stagedWorkspace);
        assert.equal(result.remotePlan?.repos[0].strategy, 'bundle-clone');
        assert.equal(result.remotePlan?.repos[0].overlayAllowed, true);
        assert.equal(result.layers.find(layer => layer.name === 'remoteForja')?.ok, false);
        assert.equal(result.layers.find(layer => layer.name === 'baselinePlan')?.ok, true);
        assert.match(result.nextAction || '', /forja doctor fix --remote/);
        assert.equal(commands.some(command => command.includes(stagedWorkspace)), true);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged remote actions use the staged workspace instead of the sync remote path', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-status-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release-action-path';

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release-action-path',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    try {
        assert.equal(resolveRemoteActionPath(fixture.workspace, '/home/xw/workspace/dev'), stagedWorkspace);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('legacy managed settings still resolve staged action path', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-status-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/legacy-managed';

    const configFile = projectConfigPath(fixture.workspace, 'remote');
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({
        ...DEFAULT_REMOTE,
        workspace: fixture.workspace,
        type: 'remote',
        workspaceMode: 'managed',
        profile: 'legacy-managed',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    }, null, 4) + '\n', 'utf8');

    try {
        assert.equal(resolveRemoteActionPath(fixture.workspace, '/home/xw/workspace/dev'), stagedWorkspace);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged remote test allows missing remote forja so prepared fallback can run', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-status-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/degraded-test';

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'degraded-test',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            if (command.includes('printf forja-remote-ok')) {
                return { exitCode: 0, stdout: 'forja-remote-ok', stderr: '' };
            }
            if (command.includes('uname -s')) {
                return { exitCode: 0, stdout: 'Linux\n', stderr: '' };
            }
            if (command.includes('$(npm prefix -g)/bin/forja') && command.includes('--version')) {
                return { exitCode: 127, stdout: '', stderr: 'not found' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const config: RemoteConfig = {
        workspace: fixture.workspace,
        server: { id: 'wsl', name: 'wsl', host: '172.31.158.44', username: 'xw', port: 22, authMode: 'password', privateKeyPath: '', password: '' },
        remotePath: '/home/xw/workspace/dev',
        ignore: []
    };

    try {
        const result = await buildRemoteTest({ workspace: fixture.workspace, config, runner });

        assert.equal(result.ok, true);
        assert.equal(result.failedLayer, undefined);
        assert.match(result.diagnostics.map(item => item.message).join('\n'), /remote forja/);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

function createAheadRepo(): { root: string; workspace: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-status-repo-'));
    const origin = path.join(root, 'origin.git');
    const workspace = path.join(root, 'app');
    cp.execFileSync('git', ['init', '--bare', origin]);
    cp.execFileSync('git', ['clone', origin, workspace]);
    cp.execFileSync('git', ['config', 'user.email', 'forja@example.invalid'], { cwd: workspace });
    cp.execFileSync('git', ['config', 'user.name', 'forja'], { cwd: workspace });
    fs.writeFileSync(path.join(workspace, 'README.md'), 'initial\n');
    cp.execFileSync('git', ['add', 'README.md'], { cwd: workspace });
    cp.execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspace });
    cp.execFileSync('git', ['push', '-u', 'origin', 'master'], { cwd: workspace });
    fs.writeFileSync(path.join(workspace, 'README.md'), 'local ahead\n');
    cp.execFileSync('git', ['commit', '-am', 'local ahead'], { cwd: workspace });
    return { root, workspace };
}
