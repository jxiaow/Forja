import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');

test('generic CLI sync reuses the shared core ssh transport', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'sync', 'cli.ts'), 'utf-8');

    assert.match(source, /from '\.\.\/core\/sshTransport'/);
    assert.doesNotMatch(source, /function scpUpload\s*\(/);
    assert.doesNotMatch(source, /function ensureRemoteDir\s*\(/);
});

test('vscode sync transport re-exports shared core upload primitives', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'sync', 'transport.ts'), 'utf-8');

    assert.match(source, /from '\.\.\/core\/sshTransport'/);
    assert.match(source, /scpUpload/);
    assert.match(source, /ensureRemoteDir/);
    assert.match(source, /deleteRemoteFile/);
});


test('shared ssh transport has a force-kill fallback after graceful termination', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'sshTransport.ts'), 'utf-8');

    assert.match(source, /proc\.kill\(\)/);
    assert.match(source, /proc\.kill\('SIGKILL'\)/);
    assert.match(source, /exitCode === null && proc\.signalCode === null/);
});

test('shared scp upload has a timeout guard', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'sshTransport.ts'), 'utf-8');

    assert.match(source, /DEFAULT_SCP_UPLOAD_TIMEOUT_MS/);
    assert.match(source, /runCancellableProcess\('scp', args, askpass, token, DEFAULT_SCP_UPLOAD_TIMEOUT_MS\)/);
});

test('shared ssh transport supports remote file deletion', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'sshTransport.ts'), 'utf-8');

    assert.match(source, /export async function deleteRemoteFile/);
    assert.match(source, /rm -f/);
});

test('shared scp upload quotes the remote target through a helper', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'core', 'sshTransport.ts'), 'utf-8');

    assert.match(source, /quoteForRemoteShell/);
    assert.doesNotMatch(source, /process\.platform === 'win32'/);
});


test('sync vscode modules live outside the qt tree', () => {
    assert.equal(fs.existsSync(path.join(repoRoot, 'src', 'qt', 'sync')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, 'src', 'sync', 'syncWatcher.ts')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, 'src', 'qt', 'shared', 'syncCli.ts')), false);
});
