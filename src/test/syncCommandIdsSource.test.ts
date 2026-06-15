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

test('internal registered commands have contributed metadata and stay hidden from command palette', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);
    const hiddenPaletteCommands = (pkg.contributes.menus.commandPalette || [])
        .filter((item: { when?: string }) => item.when === 'false')
        .map((item: { command: string }) => item.command);

    assert.ok(commands.includes('forja.showSyncTab'));
    assert.ok(commands.includes('forja.qt.loadManualProject'));
    assert.ok(hiddenPaletteCommands.includes('forja.showSyncTab'));
    assert.ok(hiddenPaletteCommands.includes('forja.qt.loadManualProject'));
    assert.ok(hiddenPaletteCommands.includes('forja.qt.runCustomCommand'));
});

test('sync test connection quick pick resolves duplicate server names by id', () => {
    const watcher = fs.readFileSync(path.join(repoRoot, 'src', 'sync', 'syncWatcher.ts'), 'utf-8');

    assert.match(watcher, /servers\.map\(s => \(\{[\s\S]*?serverId: s\.id[\s\S]*?\}\)\)/);
    assert.match(watcher, /servers\.find\(s => s\.id === pick\.serverId\)/);
    assert.doesNotMatch(watcher, /servers\.find\(s => s\.name === pick\.label\)/);
});

test('sync failure clears cached password on authentication errors', () => {
    const watcher = fs.readFileSync(path.join(repoRoot, 'src', 'sync', 'syncWatcher.ts'), 'utf-8');

    assert.match(watcher, /isAuthenticationError/);
    assert.match(watcher, /if \(isAuthenticationError\(msg\)\) \{\s*clearPasswordCache\(\);\s*\}/);
});

test('sync cli and vscode sync reuse shared git changed file collection', () => {
    const cli = fs.readFileSync(path.join(repoRoot, 'src', 'sync', 'cli.ts'), 'utf-8');
    const sftp = fs.readFileSync(path.join(repoRoot, 'src', 'sync', 'sftpClient.ts'), 'utf-8');

    assert.match(cli, /from '\.\.\/core\/gitChangedFiles'/);
    assert.match(sftp, /from '\.\.\/core\/gitChangedFiles'/);
    assert.doesNotMatch(cli, /function getGitChangedFiles\s*\(/);
    assert.doesNotMatch(sftp, /function getGitChangedFiles\s*\(/);
});
