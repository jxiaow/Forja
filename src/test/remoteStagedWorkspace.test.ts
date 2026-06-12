import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertStagedRepoMutation,
    buildStagedWorkspacePrepareCommand,
    isPathInsideStagedWorkspace,
    stagedWorkspaceRepoPath
} from '../remote/core/stagedWorkspace';

test('resolves repository paths inside a staged workspace root', () => {
    const root = '/home/xw/workspace/forja-remote/release';
    const repoPath = stagedWorkspaceRepoPath(root, 'qt_client');

    assert.equal(repoPath, '/home/xw/workspace/forja-remote/release/qt_client');
    assert.equal(isPathInsideStagedWorkspace(root, repoPath), true);
    assert.equal(isPathInsideStagedWorkspace(root, '/home/xw/workspace/dev/qt_client'), false);
});

test('rejects staged repo names and paths that escape the workspace root', () => {
    const root = '/home/xw/workspace/forja-remote/release';

    assert.throws(() => stagedWorkspaceRepoPath(root, '/danger'), /repo 名称/);
    assert.throws(() => stagedWorkspaceRepoPath(root, '../danger'), /repo 名称/);
    assert.throws(() => stagedWorkspaceRepoPath(root, 'nested/danger'), /repo 名称/);
    assert.equal(isPathInsideStagedWorkspace(root, '/home/xw/workspace/forja-remote/release/../danger'), false);
});

test('staged workspace prepare command writes a registry marker before mutation', () => {
    const command = buildStagedWorkspacePrepareCommand({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        serverId: 'real-wsl',
        workspaceId: 'qt-client-release',
        repos: ['qt_client']
    });

    assert.match(command, /mkdir -p "\$HOME\/\.forja\/managed-workspaces"/);
    assert.match(command, /mkdir -p '\/home\/xw\/workspace\/forja-remote\/release'/);
    assert.match(command, /createdBy/);
    assert.match(command, /qt-client-release/);
});

test('allows mutation only for staged primary or mapped repositories', () => {
    const allowed = assertStagedRepoMutation({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        repoPath: '/home/xw/workspace/forja-remote/release/qt_client',
        role: 'primary'
    });
    const blocked = assertStagedRepoMutation({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        repoPath: '/home/xw/workspace/dev/qt_client',
        role: 'primary'
    });

    assert.equal(allowed.ok, true);
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /非 staged/);
});

test('blocks destructive mutation for remote-only repositories even inside the workspace', () => {
    const result = assertStagedRepoMutation({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        repoPath: '/home/xw/workspace/forja-remote/release/xylib_arm64',
        role: 'remote-only'
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /remote-only/);
});
