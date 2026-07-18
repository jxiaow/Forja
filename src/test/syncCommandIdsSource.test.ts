import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');

test('package contributes only v2 commands', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);

    // v2 commands
    assert.ok(commands.includes('forja.status'));
    assert.ok(commands.includes('forja.init'));
    assert.ok(commands.includes('forja.list'));
    assert.ok(commands.includes('forja.use'));
    assert.ok(commands.includes('forja.server'));
    assert.ok(commands.includes('forja.build'));
    assert.ok(commands.includes('forja.run'));
    assert.ok(commands.includes('forja.stop'));
    assert.ok(commands.includes('forja.clean'));
    assert.ok(commands.includes('forja.doctor'));
    assert.ok(commands.includes('forja.sync'));

    // Old commands should not exist
    assert.ok(!commands.includes('forja.qt.build'));
    assert.ok(!commands.includes('forja.cpp.build'));
    assert.ok(!commands.includes('forja.remote.status'));
    assert.ok(!commands.includes('forja.syncChangedFiles'));

    // Internal/advanced commands (hidden from command palette)
    assert.ok(commands.includes('forja.syncTestConnection'));
    assert.ok(commands.includes('forja.showSyncTab'));
    assert.ok(commands.includes('forja.remoteWorkbench'));
    assert.ok(commands.includes('forja.remoteTest'));
    assert.ok(commands.includes('forja.remoteBootstrap'));
    assert.ok(commands.includes('forja.remoteTransferStatus'));
    assert.ok(commands.includes('forja.ps'));

    // Verify internal commands are hidden from command palette
    const palette = pkg.contributes.menus.commandPalette || [];
    const hiddenCommands = palette.filter((p: { when: string }) => p.when === 'false').map((p: { command: string }) => p.command);
    assert.ok(hiddenCommands.includes('forja.remoteWorkbench'));
    assert.ok(hiddenCommands.includes('forja.remoteTest'));
    assert.ok(hiddenCommands.includes('forja.remoteBootstrap'));
    assert.ok(hiddenCommands.includes('forja.remoteTransferStatus'));
    assert.ok(hiddenCommands.includes('forja.ps'));
});

test('sync command accepts a resource uri for single-file sync', () => {
    const cmds = fs.readFileSync(path.join(repoRoot, 'src', 'vscode', 'commands.ts'), 'utf-8');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

    assert.match(cmds, /forja\.sync/);
    assert.ok(pkg.contributes.menus['explorer/context'].some((item: { command: string }) => item.command === 'forja.sync'));
});

test('extension registers commands', () => {
    const extension = fs.readFileSync(path.join(repoRoot, 'src', 'extension.ts'), 'utf-8');

    assert.match(extension, /registerCommands/);
    assert.doesNotMatch(extension, /registerQtCommands/);
    assert.doesNotMatch(extension, /registerRemoteCommands/);
});

test('sync test connection quick pick resolves duplicate server names by id', () => {
    const watcher = fs.readFileSync(path.join(repoRoot, 'src', 'vscode', 'syncWatcher.ts'), 'utf-8');

    assert.match(watcher, /servers\.map\(s => \(\{[\s\S]*?serverId: s\.id[\s\S]*?\}\)\)/);
    assert.match(watcher, /servers\.find\(s => s\.id === pick\.serverId\)/);
    assert.doesNotMatch(watcher, /servers\.find\(s => s\.name === pick\.label\)/);
});

test('sync failure clears cached password on authentication errors', () => {
    const watcher = fs.readFileSync(path.join(repoRoot, 'src', 'vscode', 'syncWatcher.ts'), 'utf-8');

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
