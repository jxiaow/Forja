import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import { DEFAULT_REMOTE, saveRemoteSettings } from '../core/settingsIO';
import { executePreparedRemoteAction, prepareRemoteWorkspace } from '../remote/core/pipeline';
import { RemoteUploader } from '../remote/core/bootstrap';
import { RemoteRunner } from '../remote/core/types';

const oldConfigDir = process.env.FORJA_CONFIG_DIR;

test('staged pipeline uses bundle baseline and staged workspace before overlay', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release';
    const commands: string[] = [];
    let remoteProbeCount = 0;

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
            if (command.includes('printf "path:%s\\n"')) {
                remoteProbeCount++;
                if (remoteProbeCount === 1) {
                    return { exitCode: 0, stdout: 'path:/home/xw/workspace/forja-remote/release/app\nmode:files\nmissing:true\n', stderr: '' };
                }
                return { exitCode: 0, stdout: `path:/home/xw/workspace/forja-remote/release/app\nmode:git\ncommit:${fixture.commit}\nstatus:\n`, stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            if (command.includes('lock_dir=')) {
                return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock","targetId":"target","owner":"test","stage":"prepare","remotePath":"' + stagedWorkspace + '","repos":["app"],"startedAt":"2026-06-12T00:00:00.000Z"}\n', stderr: '' };
            }
            if (command.includes('git fetch "$bundle"')) {
                return { exitCode: 0, stdout: '/home/xw/workspace/forja-remote/release/app\n', stderr: '' };
            }
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string) {
            assert.equal(fs.existsSync(localPath), true);
        }
    };

    try {
        const result = await prepareRemoteWorkspace({
            workspace: fixture.workspace,
            remotePath: '/home/xw/workspace/dev',
            ignore: [],
            owner: 'test',
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.deepEqual(result.stages.map(item => item.stage).filter(stage => stage !== 'releaseLock'), [
            'baselinePlan',
            'acquireLock',
            'stagedWorkspacePrepare',
            'bundleBaseline',
            'workspaceLink',
            'overlaySync',
            'baselineCheck'
        ]);
        assert.ok(commands.some(command => command.includes('managed-workspaces')));
        assert.equal(commands.some(command => command.includes('git pull --ff-only')), false);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged prepared action runs readiness and remote action in the primary staged repo after prepare', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release-action';
    const commands: string[] = [];
    let remoteProbeCount = 0;
    let prepared = false;

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release-action',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('&& forja ')) {
                if (!prepared) {
                    return { exitCode: 1, stdout: '', stderr: 'workspace not prepared' };
                }
                return { exitCode: 0, stdout: '{"ok":true,"diagnostics":[],"nextActions":[]}', stderr: '' };
            }
            if (command.includes('printf "path:%s\\n"')) {
                remoteProbeCount++;
                if (remoteProbeCount === 1) {
                    return { exitCode: 0, stdout: 'path:/home/xw/workspace/forja-remote/release-action/app\nmode:files\nmissing:true\n', stderr: '' };
                }
                return { exitCode: 0, stdout: `path:/home/xw/workspace/forja-remote/release-action/app\nmode:git\ncommit:${fixture.commit}\nstatus:\n`, stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            if (command.includes('lock_dir=')) {
                return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock","targetId":"target","owner":"test","stage":"prepare","remotePath":"' + stagedWorkspace + '","repos":["app"],"startedAt":"2026-06-12T00:00:00.000Z"}\n', stderr: '' };
            }
            if (command.includes('managed-workspaces')) {
                prepared = true;
                return { exitCode: 0, stdout: '', stderr: '' };
            }
            if (command.includes('git fetch "$bundle"')) {
                return { exitCode: 0, stdout: '/home/xw/workspace/forja-remote/release-action/app\n', stderr: '' };
            }
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string) {
            assert.equal(fs.existsSync(localPath), true);
        }
    };

    try {
        const result = await executePreparedRemoteAction({
            workspace: fixture.workspace,
            remotePath: '/home/xw/workspace/dev',
            ignore: [],
            owner: 'test',
            target: 'qt',
            action: 'build',
            args: [],
            json: true,
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.equal(result.actionRemotePath, stagedWorkspace + '/app');
        assert.ok(commands.some(command => command.includes(`cd '${stagedWorkspace}/app'`) && command.includes('build')));
        assert.ok(commands.some(command => command.includes(`cd '${stagedWorkspace}/app'`) && command.includes('status')));
        assert.equal(commands.some(command => command.includes("cd '/home/xw/workspace/dev'") && command.includes('&& forja ')), false);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged pipeline restores previous overlay before reuse-ready overlay sync', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release-reuse';
    const commands: string[] = [];
    const uploads: string[] = [];
    let remoteProbeCount = 0;

    fs.writeFileSync(path.join(fixture.workspace, 'new-file.txt'), 'overlay');
    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release-reuse',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('printf "path:%s\\n"')) {
                remoteProbeCount++;
                return { exitCode: 0, stdout: `path:${stagedWorkspace}/app\nmode:git\ncommit:${fixture.commit}\nstatus:\n`, stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            if (command.includes('lock_dir=')) {
                return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock","targetId":"target","owner":"test","stage":"prepare","remotePath":"' + stagedWorkspace + '","repos":["app"],"startedAt":"2026-06-12T00:00:00.000Z"}\n', stderr: '' };
            }
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(_localPath: string, remotePath?: string) {
            if (remotePath) {
                uploads.push(remotePath);
                commands.push('UPLOAD ' + remotePath);
            }
        }
    };

    try {
        const result = await prepareRemoteWorkspace({
            workspace: fixture.workspace,
            remotePath: '/home/xw/workspace/dev',
            ignore: [],
            owner: 'test',
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.equal(remoteProbeCount, 2);
        const restoreIndex = commands.findIndex(command => command.includes('overlay.json') && command.includes('repoState.untracked'));
        const uploadIndex = commands.findIndex(command => command === 'UPLOAD ' + stagedWorkspace + '/app/new-file.txt');
        assert.notEqual(restoreIndex, -1);
        assert.notEqual(uploadIndex, -1);
        assert.ok(restoreIndex < uploadIndex);
        assert.deepEqual(uploads, [stagedWorkspace + '/app/new-file.txt']);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged prepared action uses mapped remote repo name for primary action path', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release-mapped';
    const commands: string[] = [];
    let remoteProbeCount = 0;
    const uploads: string[] = [];

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release-mapped',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'linux-app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('&& forja ')) {
                return { exitCode: 0, stdout: '{"ok":true,"diagnostics":[],"nextActions":[]}', stderr: '' };
            }
            if (command.includes('printf "path:%s\\n"')) {
                remoteProbeCount++;
                if (remoteProbeCount === 1) {
                    assert.match(command, /repo_name='linux-app'/);
                    return { exitCode: 0, stdout: 'path:/home/xw/workspace/forja-remote/release-mapped/linux-app\nmode:files\nmissing:true\n', stderr: '' };
                }
                return { exitCode: 0, stdout: `path:/home/xw/workspace/forja-remote/release-mapped/linux-app\nmode:git\ncommit:${fixture.commit}\nstatus:\n`, stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            if (command.includes('lock_dir=')) {
                return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock","targetId":"target","owner":"test","stage":"prepare","remotePath":"' + stagedWorkspace + '","repos":["linux-app"],"startedAt":"2026-06-12T00:00:00.000Z"}\n', stderr: '' };
            }
            if (command.includes('git fetch "$bundle"')) {
                return { exitCode: 0, stdout: '/home/xw/workspace/forja-remote/release-mapped/linux-app\n', stderr: '' };
            }
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string, remotePath?: string) {
            assert.equal(fs.existsSync(localPath), true);
            if (remotePath) { uploads.push(remotePath); }
        }
    };

    try {
        const result = await executePreparedRemoteAction({
            workspace: fixture.workspace,
            remotePath: '/home/xw/workspace/dev',
            ignore: [],
            owner: 'test',
            target: 'qt',
            action: 'build',
            args: [],
            json: true,
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.equal(result.actionRemotePath, stagedWorkspace + '/linux-app');
        assert.ok(commands.some(command => command.includes(`cd '${stagedWorkspace}/linux-app'`) && command.includes('build')));
        assert.equal(commands.some(command => command.includes(`cd '${stagedWorkspace}'`) && command.includes('&& forja ')), false);
        assert.ok(commands.some(command => command.includes("repo_dir='/home/xw/workspace/forja-remote/release-mapped/linux-app'")));
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged prepared action falls back to remote shell when remote forja is missing', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release-fallback';
    const commands: string[] = [];
    let remoteProbeCount = 0;
    let shellFallbackRan = false;

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release-fallback',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('&& forja ')) {
                return { exitCode: 127, stdout: '', stderr: 'not found' };
            }
            if (command.includes('printf "path:%s\\n"')) {
                remoteProbeCount++;
                if (remoteProbeCount === 1) {
                    return { exitCode: 0, stdout: 'path:/home/xw/workspace/forja-remote/release-fallback/app\nmode:files\nmissing:true\n', stderr: '' };
                }
                return { exitCode: 0, stdout: `path:/home/xw/workspace/forja-remote/release-fallback/app\nmode:git\ncommit:${fixture.commit}\nstatus:\n`, stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            if (command.includes('lock_dir=')) {
                return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock","targetId":"target","owner":"test","stage":"prepare","remotePath":"' + stagedWorkspace + '","repos":["app"],"startedAt":"2026-06-12T00:00:00.000Z"}\n', stderr: '' };
            }
            if (command.includes('git fetch "$bundle"')) {
                return { exitCode: 0, stdout: '/home/xw/workspace/forja-remote/release-fallback/app\n', stderr: '' };
            }
            if (command.includes('qmake ')) {
                shellFallbackRan = true;
                return { exitCode: 0, stdout: 'qmake ok\n', stderr: '' };
            }
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string) {
            assert.equal(fs.existsSync(localPath), true);
        }
    };

    try {
        const result = await executePreparedRemoteAction({
            workspace: fixture.workspace,
            remotePath: '/home/xw/workspace/dev',
            ignore: [],
            owner: 'test',
            target: 'qt',
            action: 'qmake',
            args: [],
            json: true,
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.equal(shellFallbackRan, true);
        assert.ok(result.stages.some(stage => stage.stage === 'remoteShellFallback' && stage.ok));
        assert.ok(commands.some(command => command.includes(`cd '${stagedWorkspace}/app'`) && command.includes('qmake')));
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged prepared action preserves remote forja build failures instead of shell fallback', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release-build-failure';
    const commands: string[] = [];
    let remoteProbeCount = 0;

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release-build-failure',
        remoteWorkspace: stagedWorkspace,
        repos: [{ localName: 'app', remoteName: 'app', role: 'primary', baseline: 'auto', overlay: true }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('&& forja ') && command.includes("'status'")) {
                return { exitCode: 0, stdout: '{"ok":true,"diagnostics":[],"nextActions":[]}', stderr: '' };
            }
            if (command.includes('&& forja ') && command.includes("'build'")) {
                return {
                    exitCode: 1,
                    stdout: '{"ok":false,"diagnostics":[{"level":"error","message":"NemoSDK.h: No such file or directory"}],"nextActions":[]}',
                    stderr: ''
                };
            }
            if (command.includes('printf "path:%s\\n"')) {
                remoteProbeCount++;
                if (remoteProbeCount === 1) {
                    return { exitCode: 0, stdout: 'path:/home/xw/workspace/forja-remote/release-build-failure/app\nmode:files\nmissing:true\n', stderr: '' };
                }
                return { exitCode: 0, stdout: `path:/home/xw/workspace/forja-remote/release-build-failure/app\nmode:git\ncommit:${fixture.commit}\nstatus:\n`, stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            if (command.includes('lock_dir=')) {
                return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock","targetId":"target","owner":"test","stage":"prepare","remotePath":"' + stagedWorkspace + '","repos":["app"],"startedAt":"2026-06-12T00:00:00.000Z"}\n', stderr: '' };
            }
            if (command.includes('git fetch "$bundle"')) {
                return { exitCode: 0, stdout: '/home/xw/workspace/forja-remote/release-build-failure/app\n', stderr: '' };
            }
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string) {
            assert.equal(fs.existsSync(localPath), true);
        }
    };

    try {
        const result = await executePreparedRemoteAction({
            workspace: fixture.workspace,
            remotePath: '/home/xw/workspace/dev',
            ignore: [],
            owner: 'test',
            target: 'qt',
            action: 'build',
            args: [],
            json: true,
            runner,
            uploader
        });

        assert.equal(result.ok, false);
        assert.equal(result.failedStage, 'remoteAction');
        assert.ok(result.stages.some(stage => stage.stage === 'remoteAction' && !stage.ok));
        assert.equal(result.stages.some(stage => stage.stage === 'remoteShellFallback'), false);
        assert.match(result.diagnostics.map(item => item.message).join('\n'), /NemoSDK/);
        assert.equal(commands.some(command => command.includes('makefile=$(find')), false);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('staged pipeline uploads configured ignored assets into mapped remote paths', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-config-'));
    process.env.FORJA_CONFIG_DIR = configDir;
    const fixture = createAheadRepo();
    const stagedWorkspace = '/home/xw/workspace/forja-remote/release-assets';
    const commands: string[] = [];
    const uploads: Array<{ localPath: string; remotePath: string }> = [];
    let remoteProbeCount = 0;

    fs.writeFileSync(path.join(fixture.workspace, '.gitignore'), 'XYMeetingKit_DLLs/\n');
    fs.mkdirSync(path.join(fixture.workspace, 'XYMeetingKit_DLLs', 'NemoSDK', 'headers'), { recursive: true });
    fs.writeFileSync(path.join(fixture.workspace, 'XYMeetingKit_DLLs', 'NemoSDK', 'headers', 'NemoSDKDefine.h'), '#pragma once\n');

    saveRemoteSettings(fixture.workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release-assets',
        remoteWorkspace: stagedWorkspace,
        repos: [{
            localName: 'app',
            remoteName: 'app',
            role: 'primary',
            baseline: 'auto',
            overlay: true,
            assets: [{
                localPath: 'XYMeetingKit_DLLs/NemoSDK/headers',
                remotePath: 'XYMeetingkit_DLLs/NemoSDK/headers'
            }]
        }]
    });

    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('printf "path:%s\\n"')) {
                remoteProbeCount++;
                if (remoteProbeCount === 1) {
                    return { exitCode: 0, stdout: 'path:/home/xw/workspace/forja-remote/release-assets/app\nmode:files\nmissing:true\n', stderr: '' };
                }
                return { exitCode: 0, stdout: `path:/home/xw/workspace/forja-remote/release-assets/app\nmode:git\ncommit:${fixture.commit}\nstatus:\n`, stderr: '' };
            }
            if (command.includes('pwd -P')) {
                return { exitCode: 0, stdout: stagedWorkspace + '\n', stderr: '' };
            }
            if (command.includes('lock_dir=')) {
                return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock","targetId":"target","owner":"test","stage":"prepare","remotePath":"' + stagedWorkspace + '","repos":["app"],"startedAt":"2026-06-12T00:00:00.000Z"}\n', stderr: '' };
            }
            if (command.includes('git fetch "$bundle"')) {
                return { exitCode: 0, stdout: '/home/xw/workspace/forja-remote/release-assets/app\n', stderr: '' };
            }
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string, remotePath: string) {
            uploads.push({ localPath, remotePath });
            assert.equal(fs.existsSync(localPath), true);
        }
    };

    try {
        const result = await prepareRemoteWorkspace({
            workspace: fixture.workspace,
            remotePath: '/home/xw/workspace/dev',
            ignore: [],
            owner: 'test',
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.ok(uploads.some(item => item.localPath.endsWith(path.join('XYMeetingKit_DLLs', 'NemoSDK', 'headers', 'NemoSDKDefine.h'))));
        assert.ok(uploads.some(item => item.remotePath === stagedWorkspace + '/app/XYMeetingkit_DLLs/NemoSDK/headers/NemoSDKDefine.h'));
        assert.ok(commands.some(command => command.includes('XYMeetingkit_DLLs/NemoSDK/headers/NemoSDKDefine.h')));
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
        fs.rmSync(configDir, { recursive: true, force: true });
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

function createAheadRepo(): { root: string; workspace: string; commit: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-pipeline-repo-'));
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
    const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
    return { root, workspace, commit };
}
