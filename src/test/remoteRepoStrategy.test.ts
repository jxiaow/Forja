import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepoPrecheck, RepoBaselineState } from '../remote/core/baseline';
import { planRemoteRepositories, RemoteRepoMapping } from '../remote/core/repoStrategy';

function localRepo(overrides: Partial<LocalRepoPrecheck> = {}): LocalRepoPrecheck {
    return {
        name: 'qt_client',
        dir: 'C:/workspace/qt_client',
        branch: 'release',
        upstream: 'origin/release',
        localCommit: 'local-commit',
        upstreamCommit: 'upstream-commit',
        ahead: 0,
        behind: 0,
        ok: true,
        diagnostics: [],
        ...overrides
    };
}

function remoteRepo(overrides: Partial<RepoBaselineState> = {}): RepoBaselineState {
    return {
        name: 'qt_client',
        mode: 'git',
        remotePath: '/home/xw/workspace/forja-remote/release/qt_client',
        remoteCommit: 'local-commit',
        commitAligned: true,
        preservedTracked: [],
        unknownUntracked: [],
        diagnostics: [],
        ...overrides
    };
}

test('plans reuse-ready for an aligned primary staged repo', () => {
    const result = planRemoteRepositories({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        localRepos: [localRepo()],
        remoteRepos: [remoteRepo()],
        mappings: [{ localName: 'qt_client', remoteName: 'qt_client', role: 'primary', overlay: true }]
    });

    assert.equal(result.ok, true);
    assert.equal(result.repos[0].role, 'primary');
    assert.equal(result.repos[0].strategy, 'reuse-ready');
    assert.equal(result.repos[0].overlayAllowed, true);
    assert.equal(result.repos[0].staged, true);
});

test('plans bundle-clone for a missing primary staged repo', () => {
    const result = planRemoteRepositories({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        localRepos: [localRepo({ ahead: 1, upstreamCommit: 'old-upstream' })],
        remoteRepos: [remoteRepo({ mode: 'files', missing: true, remoteCommit: undefined, commitAligned: false })],
        mappings: [{ localName: 'qt_client', remoteName: 'qt_client', role: 'primary', overlay: true }]
    });

    assert.equal(result.ok, true);
    assert.equal(result.repos[0].strategy, 'bundle-clone');
    assert.equal(result.repos[0].overlayAllowed, true);
});

test('blocks an existing non-staged repo when its baseline differs', () => {
    const result = planRemoteRepositories({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        localRepos: [localRepo()],
        remoteRepos: [remoteRepo({
            remotePath: '/home/xw/workspace/dev/qt_client',
            remoteCommit: 'linux-commit',
            commitAligned: false
        })],
        mappings: [{ localName: 'qt_client', remoteName: 'qt_client', role: 'existing-remote', overlay: false }]
    });

    assert.equal(result.ok, false);
    assert.equal(result.repos[0].strategy, 'blocked');
    assert.equal(result.repos[0].overlayAllowed, false);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /非 staged/);
});

test('keeps remote-only dependencies status-only and never overlayable', () => {
    const mapping: RemoteRepoMapping = {
        localName: 'xylib_win32',
        remoteName: 'xylib_arm64',
        role: 'remote-only',
        remotePath: '/home/xw/workspace/dev/xylib_arm64',
        overlay: false,
        mount: 'symlink'
    };
    const result = planRemoteRepositories({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        localRepos: [],
        remoteRepos: [remoteRepo({
            name: 'xylib_arm64',
            remotePath: '/home/xw/workspace/dev/xylib_arm64',
            remoteCommit: 'linux-dep',
            commitAligned: false
        })],
        mappings: [mapping]
    });

    assert.equal(result.ok, true);
    assert.equal(result.repos[0].role, 'remote-only');
    assert.equal(result.repos[0].strategy, 'status-only');
    assert.equal(result.repos[0].overlayAllowed, false);
    assert.equal(result.repos[0].mount, 'symlink');
});

test('does not auto-map different local and remote repository names', () => {
    const result = planRemoteRepositories({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        localRepos: [localRepo({ name: 'xylib_win32' })],
        remoteRepos: [remoteRepo({ name: 'xylib_arm64', remotePath: '/home/xw/workspace/dev/xylib_arm64' })],
        mappings: []
    });

    assert.equal(result.ok, false);
    assert.equal(result.repos[0].strategy, 'blocked');
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /未配置 repo 映射/);
});
