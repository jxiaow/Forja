import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('C++ extension observes unified settingsStore changes instead of old workspace settings file', () => {
    const cppExtension = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'cppExtension.ts'), 'utf8');
    const configService = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'modules', 'configService.ts'), 'utf8');

    assert.match(cppExtension, /onSettingsChange/);
    assert.doesNotMatch(cppExtension, /onSettingsFileChanged/);
    assert.doesNotMatch(configService, /\.forja\/settings\.json/);
});

test('workspace resolver watches workspaces.json registry instead of old project config files', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'vscode', 'workspaceResolver.ts'), 'utf8');

    assert.match(source, /forjaConfigDir/);
    assert.match(source, /workspaces\.json/);
    assert.match(source, /createFileSystemWatcher\(pattern\)/);
    assert.doesNotMatch(source, /projectsDir/);
    assert.doesNotMatch(source, /\.forja\/settings\.json/);
});

test('sync watcher refreshes status from unified settings changes', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'sync', 'syncWatcher.ts'), 'utf8');

    assert.match(source, /onSettingsChange/);
    assert.match(source, /section === 'sync'/);
    assert.doesNotMatch(source, /\.forja\/settings\.json/);
});

test('C++ state manager uses non-Windows x64 default arch before persisting config', () => {
    const platformSource = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'platform', 'index.ts'), 'utf8');
    const stateManagerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'modules', 'stateManager.ts'), 'utf8');

    assert.match(platformSource, /getDefaultArch\(\): Arch/);
    assert.match(platformSource, /return isWindows \? 'x86' : 'x64'/);
    assert.match(stateManagerSource, /private _arch: Arch = getDefaultArch\(\)/);
    assert.match(stateManagerSource, /this\._arch = getDefaultArch\(\)/);
});

test('C++ status bar updates handle config persistence failures', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'cppExtension.ts'), 'utf8');

    assert.match(source, /onCppUpdate\(\(\{ mode, arch \}\) => \{[\s\S]*?\.persistToConfig\(\)\s*\.catch\(\(e: Error\) => logError\('状态栏更新后保存 C\+\+ 配置失败', e\)\);[\s\S]*?\}\);/);
});

test('config panel rejects C++ arch writes on non-Windows platforms', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'messageHandler.ts'), 'utf8');

    assert.match(source, /getDefaultArch/);
    assert.match(source, /isWindows/);
    assert.match(source, /if \(!isWindows\)/);
    assert.match(source, /setCppSetting\('arch', getDefaultArch\(\)\)/);
});

test('config panel normalizes C++ VsDevCmd paths before saving vsInstall', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'messageHandler.ts'), 'utf8');

    assert.match(source, /case 'saveCppVsInstall'/);
    assert.match(source, /inferVsInstall\(String\(msg\.value \|\| ''\)\) \|\| String\(msg\.value \|\| ''\)/);
    assert.match(source, /setCppSetting\('vsInstall', cppVsInstall\)/);
});

test('C++ state restore clears missing or stale pinned projects', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'modules', 'stateManager.ts'), 'utf8');

    assert.match(source, /import \* as fs from 'fs'/);
    assert.match(source, /if \(!pinnedProject\)/);
    assert.match(source, /this\._currentProject = null/);
    assert.match(source, /if \(!fs\.existsSync\(resolvedPath\)\)/);
});

test('C++ builder refuses to build when current project file no longer exists', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'modules', 'cppBuilder.ts'), 'utf8');

    assert.match(source, /import \* as fs from 'fs'/);
    assert.match(source, /fs\.existsSync\(this\.stateManager\.currentProject\.path\)/);
    assert.match(source, /stateManager\.currentProject = null/);
    assert.match(source, /persistToConfig\(\)/);
});

test('developer docs describe unified sync settings storage', () => {
    const docs = fs.readFileSync(path.join(process.cwd(), 'docs', 'development.md'), 'utf8');

    assert.match(docs, /~\/\.forja\/projects\/<hash>\.json/);
    assert.doesNotMatch(docs, /\.forja\/settings\.json/);
});
