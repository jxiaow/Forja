import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isGitRepo, resolveGitRoots } from '../core/gitRepoResolver';

const tmpBase = path.join(os.tmpdir(), 'forja-test-gitresolver-' + process.pid);

function setup() {
    fs.mkdirSync(tmpBase, { recursive: true });
}

function teardown() {
    fs.rmSync(tmpBase, { recursive: true, force: true });
}

test('isGitRepo returns true when .git exists', () => {
    setup();
    try {
        const repo = path.join(tmpBase, 'repo-a');
        fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
        assert.equal(isGitRepo(repo), true);
    } finally { teardown(); }
});

test('isGitRepo returns false when .git does not exist', () => {
    setup();
    try {
        const dir = path.join(tmpBase, 'no-git');
        fs.mkdirSync(dir, { recursive: true });
        assert.equal(isGitRepo(dir), false);
    } finally { teardown(); }
});

test('resolveGitRoots returns self when dir is a git repo', () => {
    setup();
    try {
        const repo = path.join(tmpBase, 'single-repo');
        fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
        const roots = resolveGitRoots(repo);
        assert.equal(roots.length, 1);
        assert.equal(roots[0].dir, repo);
        assert.equal(roots[0].name, 'single-repo');
    } finally { teardown(); }
});

test('resolveGitRoots scans subdirectories when root is not a git repo', () => {
    setup();
    try {
        const root = path.join(tmpBase, 'workspace');
        fs.mkdirSync(root, { recursive: true });
        // Create sub-repos
        fs.mkdirSync(path.join(root, 'lib-a', '.git'), { recursive: true });
        fs.mkdirSync(path.join(root, 'lib-b', '.git'), { recursive: true });
        // Create a non-repo dir
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

        const roots = resolveGitRoots(root);
        assert.equal(roots.length, 2);
        const names = roots.map(r => r.name).sort();
        assert.deepEqual(names, ['lib-a', 'lib-b']);
    } finally { teardown(); }
});

test('resolveGitRoots skips dot-prefixed directories', () => {
    setup();
    try {
        const root = path.join(tmpBase, 'ws-dot');
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(path.join(root, '.hidden', '.git'), { recursive: true });
        fs.mkdirSync(path.join(root, 'visible', '.git'), { recursive: true });

        const roots = resolveGitRoots(root);
        assert.equal(roots.length, 1);
        assert.equal(roots[0].name, 'visible');
    } finally { teardown(); }
});

test('resolveGitRoots returns empty array when no git repos found', () => {
    setup();
    try {
        const root = path.join(tmpBase, 'empty-ws');
        fs.mkdirSync(path.join(root, 'dir-a'), { recursive: true });
        fs.mkdirSync(path.join(root, 'dir-b'), { recursive: true });

        const roots = resolveGitRoots(root);
        assert.equal(roots.length, 0);
    } finally { teardown(); }
});
