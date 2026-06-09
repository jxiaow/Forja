import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');

test('package contributes only generic sync commands', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);

    assert.ok(commands.includes('forja.syncChangedFiles'));
    assert.ok(commands.includes('forja.syncTestConnection'));
    assert.ok(!commands.includes('forja.qt.syncChangedFiles'));
    assert.ok(!commands.includes('forja.qt.syncTestConnection'));
});

test('sync status bar and config panel use generic sync command ids', () => {
    const watcher = fs.readFileSync(path.join(repoRoot, 'src', 'sync', 'syncWatcher.ts'), 'utf-8');
    const messageHandler = fs.readFileSync(path.join(repoRoot, 'src', 'ui', 'configPanel', 'messageHandler.ts'), 'utf-8');

    assert.match(watcher, /forja\.syncChangedFiles/);
    assert.match(watcher, /forja\.showSyncTab/);
    assert.doesNotMatch(watcher, /forja\.qt\.syncChangedFiles/);
    assert.doesNotMatch(watcher, /forja\.qt\.showSyncTab/);
    assert.match(messageHandler, /forja\.syncChangedFiles/);
});

test('sync command accepts a resource uri for single-file sync', () => {
    const commands = fs.readFileSync(path.join(repoRoot, 'src', 'qt', 'commands.ts'), 'utf-8');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

    assert.match(commands, /\['forja\.syncChangedFiles',\s*\(uri\?: vscode\.Uri\) => executeSyncChangedFiles\(uri\)\]/);
    assert.ok(pkg.contributes.menus['explorer/context'].some((item: { command: string }) => item.command === 'forja.syncChangedFiles'));
});

test('extension registers only generic sync tab command', () => {
    const extension = fs.readFileSync(path.join(repoRoot, 'src', 'extension.ts'), 'utf-8');

    assert.match(extension, /forja\.showSyncTab/);
    assert.doesNotMatch(extension, /forja\.qt\.showSyncTab/);
});
