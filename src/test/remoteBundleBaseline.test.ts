import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cp from 'node:child_process';
import { executeBundleBaseline } from '../remote/core/bundleBaseline';
import { LocalRepoPrecheck } from '../remote/core/baseline';
import { RemoteUploader } from '../remote/core/bootstrap';
import { RemoteRepoPlan } from '../remote/core/repoStrategy';
import { RemoteRunner } from '../remote/core/types';

test('bundle baseline creates a bundle from a temporary ref and applies it to a staged repo', async () => {
    const created = createGitRepo('forja-bundle-test-');
    const uploads: string[] = [];
    const commands: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('git fetch')) {
                return { exitCode: 0, stdout: '/remote/staged/app\n', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string, remotePath: string) {
            assert.equal(fs.existsSync(localPath), true);
            uploads.push(remotePath);
        }
    };

    try {
        const result = await executeBundleBaseline({
            stagedWorkspace: '/remote/staged',
            targetId: 'target',
            localRepos: [created.local],
            plans: [repoPlan({ strategy: 'bundle-fetch', remotePath: '/remote/staged/app' })],
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.deepEqual(uploads, ['.forja/baseline/target/app.bundle']);
        assert.ok(commands.some(command => command.includes('refs/forja/baseline/target/app')));
        assert.ok(commands.some(command => command.includes('git checkout -B')));
        assert.equal(result.repos[0].remoteCommit, created.local.localCommit);
        const refCheck = cp.spawnSync('git', ['show-ref', 'refs/forja/baseline/target/app'], { cwd: created.local.dir, encoding: 'utf8' });
        assert.notEqual(refCheck.status, 0);
    } finally {
        fs.rmSync(created.root, { recursive: true, force: true });
    }
});

test('bundle baseline records the canonical repo path from the last stdout line', async () => {
    const created = createGitRepo('forja-bundle-path-');
    const runner: RemoteRunner = {
        async run(command: string) {
            if (command.includes('git fetch')) {
                return {
                    exitCode: 0,
                    stdout: 'HEAD is now at 1234567 subject\n/remote/staged/app\n',
                    stderr: ''
                };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(localPath: string) {
            assert.equal(fs.existsSync(localPath), true);
        }
    };

    try {
        const result = await executeBundleBaseline({
            stagedWorkspace: '/remote/staged',
            targetId: 'target',
            localRepos: [created.local],
            plans: [repoPlan({ strategy: 'bundle-clone', remotePath: '/remote/staged/app' })],
            runner,
            uploader
        });

        assert.equal(result.ok, true);
        assert.equal(result.repos[0].remotePath, '/remote/staged/app');
    } finally {
        fs.rmSync(created.root, { recursive: true, force: true });
    }
});

test('bundle baseline refuses non-staged repo paths', async () => {
    const created = createGitRepo('forja-bundle-block-');
    const runner: RemoteRunner = {
        async run() {
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload() {
            throw new Error('upload should not run');
        }
    };

    try {
        const result = await executeBundleBaseline({
            stagedWorkspace: '/remote/staged',
            targetId: 'target',
            localRepos: [created.local],
            plans: [repoPlan({ remotePath: '/home/xw/workspace/dev/app' })],
            runner,
            uploader
        });

        assert.equal(result.ok, false);
        assert.match(result.diagnostics.map(item => item.message).join('\n'), /非 staged/);
    } finally {
        fs.rmSync(created.root, { recursive: true, force: true });
    }
});

test('bundle baseline blocks local behind or diverged repositories', async () => {
    const created = createGitRepo('forja-bundle-behind-');
    const runner: RemoteRunner = {
        async run() {
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload() {
            throw new Error('upload should not run');
        }
    };

    try {
        const result = await executeBundleBaseline({
            stagedWorkspace: '/remote/staged',
            targetId: 'target',
            localRepos: [{ ...created.local, behind: 1 }],
            plans: [repoPlan({ strategy: 'bundle-fetch', remotePath: '/remote/staged/app' })],
            runner,
            uploader
        });

        assert.equal(result.ok, false);
        assert.match(result.diagnostics.map(item => item.message).join('\n'), /落后或分叉/);
    } finally {
        fs.rmSync(created.root, { recursive: true, force: true });
    }
});

function repoPlan(overrides: Partial<RemoteRepoPlan> = {}): RemoteRepoPlan {
    return {
        localName: 'app',
        remoteName: 'app',
        role: 'primary',
        strategy: 'bundle-fetch',
        overlayAllowed: true,
        staged: true,
        remotePath: '/remote/staged/app',
        diagnostics: [],
        ...overrides
    };
}

function createGitRepo(prefix: string): { root: string; local: LocalRepoPrecheck } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const repoDir = path.join(root, 'app');
    fs.mkdirSync(repoDir);
    cp.execFileSync('git', ['init'], { cwd: repoDir });
    cp.execFileSync('git', ['config', 'user.email', 'forja@example.invalid'], { cwd: repoDir });
    cp.execFileSync('git', ['config', 'user.name', 'forja'], { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\n');
    cp.execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
    cp.execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });
    const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
    return {
        root,
        local: {
            name: 'app',
            dir: repoDir,
            branch: 'feature',
            localCommit: commit,
            ahead: 1,
            behind: 0,
            ok: true,
            diagnostics: []
        }
    };
}
