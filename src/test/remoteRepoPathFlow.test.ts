import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRemoteBranchSync } from '../remote/core/branchSync';
import { executeRemoteOverlaySync } from '../remote/core/overlaySync';
import { RemoteUploader } from '../remote/core/bootstrap';
import { RemoteRunner } from '../remote/core/types';

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
