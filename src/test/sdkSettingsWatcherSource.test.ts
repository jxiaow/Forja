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

test('SDK state manager uses non-Windows x64 default arch before persisting config', () => {
    const platformSource = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'platform', 'index.ts'), 'utf8');
    const stateManagerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'modules', 'stateManager.ts'), 'utf8');

    assert.match(platformSource, /getDefaultArch\(\): Arch/);
    assert.match(platformSource, /return isWindows \? 'x86' : 'x64'/);
    assert.match(stateManagerSource, /private _arch: Arch = getDefaultArch\(\)/);
    assert.match(stateManagerSource, /this\._arch = getDefaultArch\(\)/);
});

test('config panel rejects SDK arch writes on non-Windows platforms', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'messageHandler.ts'), 'utf8');

    assert.match(source, /getDefaultArch/);
    assert.match(source, /isWindows/);
    assert.match(source, /if \(!isWindows\)/);
    assert.match(source, /setSdkSetting\('arch', getDefaultArch\(\)\)/);
});

test('config panel normalizes SDK VsDevCmd paths before saving vsInstall', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'messageHandler.ts'), 'utf8');

    assert.match(source, /case 'saveSdkVsInstall'/);
    assert.match(source, /inferVsInstall\(String\(msg\.value \|\| ''\)\) \|\| String\(msg\.value \|\| ''\)/);
    assert.match(source, /setSdkSetting\('vsInstall', sdkVsInstall\)/);
});

test('SDK state restore clears missing or stale pinned projects', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'modules', 'stateManager.ts'), 'utf8');

    assert.match(source, /import \* as fs from 'fs'/);
    assert.match(source, /if \(!pinnedProject\)/);
    assert.match(source, /this\._currentProject = null/);
    assert.match(source, /if \(!fs\.existsSync\(resolvedPath\)\)/);
});

test('SDK builder refuses to build when current project file no longer exists', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'modules', 'sdkBuilder.ts'), 'utf8');

    assert.match(source, /import \* as fs from 'fs'/);
    assert.match(source, /fs\.existsSync\(this\.stateManager\.currentProject\.path\)/);
    assert.match(source, /stateManager\.currentProject = null/);
    assert.match(source, /persistToConfig\(\)/);
});

test('developer docs describe unified sync settings storage', () => {
    const docs = fs.readFileSync(path.join(process.cwd(), 'docs', 'development.md'), 'utf8');

    assert.match(docs, /~\/\.compilot\/projects\/<hash>\.json/);
    assert.doesNotMatch(docs, /\.compilot\/settings\.json/);
});
