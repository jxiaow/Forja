import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeRemoteBranchSync } from '../remote/core/branchSync';
import { buildLocalOverlayPlan, executeRemoteOverlaySync } from '../remote/core/overlaySync';
import { RemoteUploader } from '../remote/core/bootstrap';
import { RemoteRunner } from '../remote/core/types';

test('remote overlay plan expands staged renames into old delete and new upload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-remote-overlay-'));
    const workspace = path.join(root, 'app');
    fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });

    try {
        const result = await buildLocalOverlayPlan({
            workspace,
            ignore: [],
            git: {
                async exec() {
                    return { exitCode: 0, stdout: 'R  src/old.cpp -> src/new.cpp\n', stderr: '' };
                }
            }
        });

        assert.equal(result.ok, true);
        assert.deepEqual(result.repos[0].trackedUploads.map(item => item.path), ['src/new.cpp']);
        assert.deepEqual(result.repos[0].deletedTracked, ['src/old.cpp']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('remote branch sync uses resolved repository root from baseline', async () => {
    const commands: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };

    const result = await executeRemoteBranchSync({
        remotePath: '/remote/base',
        targetId: 'target',
        repos: [{
            name: 'forja',
            mode: 'git',
            remotePath: '/remote/root',
            branch: 'dev',
            preservedTracked: [],
            unknownUntracked: [],
            diagnostics: []
        }],
        runner
    });

    assert.equal(result.ok, true);
    assert.ok(commands.some(command => command.includes("cd '/remote/root' && git fetch --prune")));
    assert.ok(commands.every(command => !command.includes("'/remote/base'/'forja'")));
});

test('remote branch sync preserves both sides of a remote tracked rename', async () => {
    const commands: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('git status --porcelain -uno')) {
                return { exitCode: 0, stdout: 'R  src/old.cpp -> src/new.cpp\n', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };

    const result = await executeRemoteBranchSync({
        remotePath: '/remote/base',
        targetId: 'target',
        repos: [{
            name: 'forja',
            mode: 'git',
            remotePath: '/remote/root',
            branch: 'dev',
            preservedTracked: [],
            unknownUntracked: [],
            diagnostics: []
        }],
        runner
    });

    const stashCommand = commands.find(command => command.includes('git stash push'));
    assert.equal(result.ok, true);
    assert.match(stashCommand || '', /src\/old\.cpp/);
    assert.match(stashCommand || '', /src\/new\.cpp/);
});

test('remote overlay sync uploads into resolved repository root', async () => {
    const uploads: string[] = [];
    const commands: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(_localPath: string, remotePath: string) {
            uploads.push(remotePath);
        }
    };

    const result = await executeRemoteOverlaySync({
        remotePath: '/remote/base',
        targetId: 'target',
        repoRemotePaths: { forja: '/remote/root' },
        plan: {
            ok: true,
            action: 'overlayPlan',
            diagnostics: [],
            repos: [{
                name: 'forja',
                dir: '/local/forja',
                trackedUploads: [{ path: 'src/a.ts', localPath: '/local/forja/src/a.ts' }],
                untrackedUploads: [],
                deletedTracked: [],
                skipped: []
            }]
        },
        runner,
        uploader
    });

    assert.equal(result.ok, true);
    assert.deepEqual(uploads, ['/remote/root/src/a.ts']);
    assert.ok(commands.some(command => command.includes("mkdir -p") && command.includes("'/remote/root/src'")));
});

test('remote overlay sync creates parent directories for nested untracked uploads', async () => {
    const commands: string[] = [];
    const uploads: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(_localPath: string, remotePath: string) {
            uploads.push(remotePath);
        }
    };

    const result = await executeRemoteOverlaySync({
        remotePath: '/remote/base',
        targetId: 'target',
        repoRemotePaths: { forja: '/remote/root' },
        plan: {
            ok: true,
            action: 'overlayPlan',
            diagnostics: [],
            repos: [{
                name: 'forja',
                dir: '/local/forja',
                trackedUploads: [],
                untrackedUploads: [{ path: '.kiro/hooks/qss-qrc-build.kiro.hook', localPath: '/local/forja/.kiro/hooks/qss-qrc-build.kiro.hook' }],
                deletedTracked: [],
                skipped: []
            }]
        },
        runner,
        uploader
    });

    assert.equal(result.ok, true);
    assert.deepEqual(uploads, ['/remote/root/.kiro/hooks/qss-qrc-build.kiro.hook']);
    assert.ok(commands.some(command => command.includes("mkdir -p") && command.includes("'/remote/root/.kiro/hooks'")));
});

test('remote overlay sync blocks unknown untracked remote collisions before upload', async () => {
    const uploads: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            if (command.includes('unknown untracked remote path')) {
                return { exitCode: 1, stdout: '', stderr: 'unknown untracked remote path: generated/cache.bin' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(_localPath: string, remotePath: string) {
            uploads.push(remotePath);
        }
    };

    const result = await executeRemoteOverlaySync({
        remotePath: '/remote/base',
        targetId: 'target',
        repoRemotePaths: { forja: '/remote/root' },
        plan: {
            ok: true,
            action: 'overlayPlan',
            diagnostics: [],
            repos: [{
                name: 'forja',
                dir: '/local/forja',
                trackedUploads: [],
                untrackedUploads: [{ path: 'generated/cache.bin', localPath: '/local/forja/generated/cache.bin' }],
                deletedTracked: [],
                skipped: []
            }]
        },
        runner,
        uploader
    });

    assert.equal(result.ok, false);
    assert.deepEqual(uploads, []);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /unknown untracked remote path/);
});

test('remote overlay sync records completed uploads when a later upload fails', async () => {
    const commands: string[] = [];
    const uploads: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(_localPath: string, remotePath: string) {
            uploads.push(remotePath);
            if (remotePath.endsWith('/src/b.ts')) {
                throw new Error('upload failed');
            }
        }
    };

    const result = await executeRemoteOverlaySync({
        remotePath: '/remote/base',
        targetId: 'target',
        repoRemotePaths: { forja: '/remote/root' },
        plan: {
            ok: true,
            action: 'overlayPlan',
            diagnostics: [],
            repos: [{
                name: 'forja',
                dir: '/local/forja',
                trackedUploads: [
                    { path: 'src/a.ts', localPath: '/local/forja/src/a.ts' },
                    { path: 'src/b.ts', localPath: '/local/forja/src/b.ts' }
                ],
                untrackedUploads: [],
                deletedTracked: [],
                skipped: []
            }]
        },
        runner,
        uploader
    });

    const manifestCommand = commands.find(command => command.includes('overlay.json') && command.includes('src/a.ts'));
    assert.equal(result.ok, false);
    assert.deepEqual(uploads, ['/remote/root/src/a.ts', '/remote/root/src/b.ts']);
    assert.notEqual(manifestCommand, undefined);
    assert.doesNotMatch(manifestCommand || '', /src\/b\.ts/);
});
