import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { getModeDisplayLabel } from '../ui/statusBarLabels';

test('windows mode label uses full mode and architecture text', () => {
    assert.equal(getModeDisplayLabel('debug', 'x86', true), 'Debug x86');
    assert.equal(getModeDisplayLabel('debug', 'x64', true), 'Debug x64');
    assert.equal(getModeDisplayLabel('release', 'x86', true), 'Release x86');
    assert.equal(getModeDisplayLabel('release', 'x64', true), 'Release x64');
});

test('non-windows mode label uses full mode text without architecture', () => {
    assert.equal(getModeDisplayLabel('debug', 'x64', false), 'Debug');
    assert.equal(getModeDisplayLabel('release', 'x64', false), 'Release');
});

test('status bar uses full display label instead of short label text', () => {
    const statusBarPath = path.join(process.cwd(), 'src', 'ui', 'unifiedStatusBar.ts');
    const source = fs.readFileSync(statusBarPath, 'utf8');

    assert.match(source, /getModeDisplayLabel/);
    assert.match(source, /getEffectiveProjectName/);
});

test('status bar routes actions by execution location', () => {
    const statusBarPath = path.join(process.cwd(), 'src', 'ui', 'unifiedStatusBar.ts');
    const source = fs.readFileSync(statusBarPath, 'utf8');
    const executionLocationSource = fs.readFileSync(path.join(process.cwd(), 'src', 'vscode', 'executionLocation.ts'), 'utf8');

    assert.match(source, /getExecutionLocation/);
    assert.match(source, /onExecutionLocationChange/);
    assert.match(source, /\[Qt·\$\{locationLabel\}\]/);
    assert.match(source, /compilot\.remote\.qt\.run/);
    assert.match(source, /compilot\.remote\.sdk\.build/);
    assert.match(source, /execution:remote/);
    assert.match(executionLocationSource, /workspaceState/);
    assert.match(executionLocationSource, /listeners\.forEach\(listener => listener\(current\)\)/);
});

test('project selection and logs use effective project display helpers', () => {
    const projectManagerPath = path.join(process.cwd(), 'src', 'qt', 'project', 'projectManager.ts');
    const projectManagerSource = fs.readFileSync(projectManagerPath, 'utf8');
    const configPanelPath = path.join(process.cwd(), 'src', 'ui', 'configPanel', 'index.ts');
    const configPanelSource = fs.readFileSync(configPanelPath, 'utf8');
    const messageHandlerPath = path.join(process.cwd(), 'src', 'ui', 'configPanel', 'messageHandler.ts');
    const messageHandlerSource = fs.readFileSync(messageHandlerPath, 'utf8');

    assert.match(projectManagerSource, /getProjectSelectionLabel/);
    assert.match(projectManagerSource, /切换项目 · 当前/);
    assert.match(configPanelSource, /getEffectiveProjectName/);
    assert.match(messageHandlerSource, /getEffectiveProjectName/);
});
