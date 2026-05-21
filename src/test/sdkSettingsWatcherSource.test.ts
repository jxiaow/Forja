import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('SDK extension observes unified settingsStore changes instead of old workspace settings file', () => {
    const sdkExtension = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'sdkExtension.ts'), 'utf8');
    const configService = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'modules', 'configService.ts'), 'utf8');

    assert.match(sdkExtension, /onSettingsChange/);
    assert.doesNotMatch(sdkExtension, /onSettingsFileChanged/);
    assert.doesNotMatch(configService, /\.compilot\/settings\.json/);
});

test('workspace resolver watches unified project config files instead of old workspace settings file', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'vscode', 'workspaceResolver.ts'), 'utf8');

    assert.match(source, /projectsDir/);
    assert.match(source, /createFileSystemWatcher\(pattern\)/);
    assert.doesNotMatch(source, /\.compilot\/settings\.json/);
});

test('sync watcher refreshes status from unified settings changes', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'sync', 'syncWatcher.ts'), 'utf8');

    assert.match(source, /onSettingsChange/);
    assert.match(source, /section === 'sync'/);
    assert.doesNotMatch(source, /\.compilot\/settings\.json/);
});

test('developer docs describe unified sync settings storage', () => {
    const docs = fs.readFileSync(path.join(process.cwd(), 'docs', 'development.md'), 'utf8');

    assert.match(docs, /~\/\.compilot\/projects\/<hash>\.json/);
    assert.doesNotMatch(docs, /\.compilot\/settings\.json/);
});
