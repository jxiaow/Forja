import { test } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { isGlobPattern, globToRegex, resolveRequestedFilesForGitRoot, resolveRequestedFilesForGitRootDetailed } from '../core/syncFileSelection';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sync-test-'));
}

function mkdirp(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

test('isGlobPattern detects glob characters', () => {
    assert.strictEqual(isGlobPattern('*.cpp'), true);
    assert.strictEqual(isGlobPattern('src/**/*.ts'), true);
    assert.strictEqual(isGlobPattern('file?.txt'), true);
    assert.strictEqual(isGlobPattern('[abc].txt'), true);
    assert.strictEqual(isGlobPattern('normal/path.txt'), false);
    assert.strictEqual(isGlobPattern('path/to/file.cpp'), false);
});

test('globToRegex converts * to non-slash match', () => {
    const regex = globToRegex('*.cpp');
    assert.strictEqual(regex.test('foo.cpp'), true);
    assert.strictEqual(regex.test('bar.cpp'), true);
    assert.strictEqual(regex.test('dir/foo.cpp'), false);
});

test('globToRegex converts ** to recursive match', () => {
    const regex = globToRegex('**/*.cpp');
    assert.strictEqual(regex.test('foo.cpp'), true);
    assert.strictEqual(regex.test('dir/foo.cpp'), true);
    assert.strictEqual(regex.test('dir/sub/foo.cpp'), true);
});

test('globToRegex converts ? to single non-slash char', () => {
    const regex = globToRegex('file?.txt');
    assert.strictEqual(regex.test('file1.txt'), true);
    assert.strictEqual(regex.test('fileA.txt'), true);
    assert.strictEqual(regex.test('file.txt'), false);
    assert.strictEqual(regex.test('file12.txt'), false);
});

test('globToRegex handles character classes', () => {
    const regex = globToRegex('[abc].txt');
    assert.strictEqual(regex.test('a.txt'), true);
    assert.strictEqual(regex.test('b.txt'), true);
    assert.strictEqual(regex.test('d.txt'), false);
});

test('resolveRequestedFilesForGitRoot expands glob patterns', () => {
    const tmp = makeTempDir();
    const workspace = path.join(tmp, 'workspace');
    const gitRoot = workspace;
    mkdirp(path.join(workspace, 'src'));
    fs.writeFileSync(path.join(workspace, 'src', 'a.cpp'), '');
    fs.writeFileSync(path.join(workspace, 'src', 'b.cpp'), '');
    fs.writeFileSync(path.join(workspace, 'src', 'c.txt'), '');

    const files = resolveRequestedFilesForGitRoot(gitRoot, workspace, ['src/*.cpp']);
    assert.deepStrictEqual(files.sort(), ['src/a.cpp', 'src/b.cpp']);

    fs.rmSync(tmp, { recursive: true, force: true });
});

test('resolveRequestedFilesForGitRoot ** matches recursively', () => {
    const tmp = makeTempDir();
    const workspace = path.join(tmp, 'workspace');
    const gitRoot = workspace;
    mkdirp(path.join(workspace, 'src', 'sub'));
    fs.writeFileSync(path.join(workspace, 'src', 'a.cpp'), '');
    fs.writeFileSync(path.join(workspace, 'src', 'sub', 'b.cpp'), '');

    const files = resolveRequestedFilesForGitRoot(gitRoot, workspace, ['src/**/*.cpp']);
    assert.deepStrictEqual(files.sort(), ['src/a.cpp', 'src/sub/b.cpp']);

    fs.rmSync(tmp, { recursive: true, force: true });
});

test('resolveRequestedFilesForGitRootDetailed reports unmatched glob', () => {
    const tmp = makeTempDir();
    const workspace = path.join(tmp, 'workspace');
    const gitRoot = workspace;
    mkdirp(path.join(workspace, 'src'));
    fs.writeFileSync(path.join(workspace, 'src', 'a.txt'), '');

    const result = resolveRequestedFilesForGitRootDetailed(gitRoot, workspace, ['*.cpp']);
    assert.strictEqual(result.files.length, 0);
    assert.strictEqual(result.hasUnmatchedGlob, true);

    fs.rmSync(tmp, { recursive: true, force: true });
});

test('resolveRequestedFilesForGitRootDetailed no unmatched for matched glob', () => {
    const tmp = makeTempDir();
    const workspace = path.join(tmp, 'workspace');
    const gitRoot = workspace;
    mkdirp(path.join(workspace, 'src'));
    fs.writeFileSync(path.join(workspace, 'src', 'a.cpp'), '');

    const result = resolveRequestedFilesForGitRootDetailed(gitRoot, workspace, ['src/*.cpp']);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.hasUnmatchedGlob, false);

    fs.rmSync(tmp, { recursive: true, force: true });
});

test('resolveRequestedFilesForGitRoot non-glob path still works', () => {
    const tmp = makeTempDir();
    const workspace = path.join(tmp, 'workspace');
    const gitRoot = workspace;
    mkdirp(path.join(workspace, 'src'));
    fs.writeFileSync(path.join(workspace, 'src', 'a.cpp'), '');

    const files = resolveRequestedFilesForGitRoot(gitRoot, workspace, ['src/a.cpp']);
    assert.deepStrictEqual(files, ['src/a.cpp']);

    fs.rmSync(tmp, { recursive: true, force: true });
});
