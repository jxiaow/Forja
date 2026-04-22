import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveProjectName, getProjectSelectionLabel } from '../core/projectDisplay';
import type { ProjectInfo } from '../project/projectManager';

function createProject(target = 'DemoApp'): ProjectInfo {
    return {
        proPath: 'C:\\workspace\\demo\\demo.pro',
        projectDir: 'demo',
        proFile: 'demo.pro',
        target,
        qtModules: ['core'],
        defines: []
    };
}

test('effective project name prefers qmake target only when a project is selected', () => {
    assert.equal(getEffectiveProjectName(createProject(), 'OverrideApp', '未选择项目'), 'OverrideApp');
    assert.equal(getEffectiveProjectName(createProject(), '', '未选择项目'), 'DemoApp');
    assert.equal(getEffectiveProjectName(null, 'OverrideApp', '未选择项目'), '未选择项目');
});

test('project selection label falls back to relative path when project info is unavailable', () => {
    assert.equal(getProjectSelectionLabel(createProject(), 'demo/demo.pro', 'demo-workspace'), '[demo-workspace] DemoApp · demo/demo.pro');
    assert.equal(getProjectSelectionLabel(null, 'demo/demo.pro', ''), 'demo/demo.pro');
});
