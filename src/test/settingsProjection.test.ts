import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildQtSettings, buildCppSettings } from '../core/settingsProjection';
import { DEFAULT_SETTINGS } from '../core/settingsIO';
import { DEFAULT_QT_MODULE_PREFS, DEFAULT_CPP_MODULE_PREFS, type WorkspaceConfig, type TargetProfile } from '../core/workspaceStore';

function _config(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
    return {
        workroot: 'C:/ws',
        activeTarget: null,
        targets: {},
        qtModulePrefs: { ...DEFAULT_QT_MODULE_PREFS },
        cppModulePrefs: { ...DEFAULT_CPP_MODULE_PREFS },
        ...overrides,
    };
}

function _target(kind: 'qt' | 'cpp', over?: Partial<TargetProfile>): TargetProfile {
    return {
        id: `${kind}-1`,
        name: kind,
        kind,
        project: kind === 'qt' ? 'app/app.pro' : 'app.sln',
        mode: 'release',
        arch: 'x64',
        toolchain: kind === 'qt'
            ? { qtPath: 'C:/Qt/5.15.2', qtVersion: '5.15.2' }
            : { vsInstall: 'C:/VS/2022' },
        ...over,
    };
}

test('Qt 视图取用 qt 目标自身的 mode/arch/toolchain/pinnedProject', () => {
    const qt = buildQtSettings(_config(), _target('qt'));
    assert.equal(qt.mode, 'release');
    assert.equal(qt.arch, 'x64');
    assert.equal(qt.qtPath, 'C:/Qt/5.15.2');
    assert.deepEqual(qt.pinnedProject, { root: 'C:/ws', relative: 'app/app.pro' });
});

test('Qt 视图不得被 cpp 活跃目标污染（跨类型隔离回归）', () => {
    const d = DEFAULT_SETTINGS.qt;
    const qt = buildQtSettings(_config(), _target('cpp'));
    assert.equal(qt.mode, d.mode);
    assert.equal(qt.arch, d.arch);
    assert.equal(qt.vsInstall, d.vsInstall);
    assert.equal(qt.qtPath, d.qtPath);
    assert.equal(qt.pinnedProject, null);
});

test('Cpp 视图不得被 qt 活跃目标污染（跨类型隔离回归）', () => {
    const d = DEFAULT_SETTINGS.cpp;
    const cpp = buildCppSettings(_config(), _target('qt'));
    assert.equal(cpp.mode, d.mode);
    assert.equal(cpp.arch, d.arch);
    assert.equal(cpp.vsInstall, d.vsInstall);
    assert.equal(cpp.pinnedProject, null);
});

test('Qt 视图在无活跃目标时回落默认值', () => {
    const d = DEFAULT_SETTINGS.qt;
    const qt = buildQtSettings(_config(), null);
    assert.equal(qt.mode, d.mode);
    assert.equal(qt.arch, d.arch);
    assert.equal(qt.pinnedProject, null);
});

test('Cpp 视图取用 cpp 目标自身值', () => {
    const cpp = buildCppSettings(_config(), _target('cpp'));
    assert.equal(cpp.mode, 'release');
    assert.equal(cpp.arch, 'x64');
    assert.equal(cpp.vsInstall, 'C:/VS/2022');
    assert.equal(cpp.pinnedProject, 'app.sln');
});

test('模块 prefs 不受目标 kind 影响，两侧始终透出', () => {
    const config = _config();
    config.qtModulePrefs.qmakeArgs = '-config debug';
    config.cppModulePrefs.cmakeConfigureArgs = ['-G', 'Ninja'];
    const qt = buildQtSettings(config, _target('cpp'));
    assert.equal(qt.qmakeArgs, '-config debug');
    const cpp = buildCppSettings(config, _target('qt'));
    assert.deepEqual(cpp.cmakeConfigureArgs, ['-G', 'Ninja']);
});

test('投影结果数组为拷贝，改返回值不影响源配置', () => {
    const config = _config();
    config.cppModulePrefs.cmakeConfigureArgs = ['-A', 'x64'];
    const cpp = buildCppSettings(config, null);
    assert.ok(cpp.cmakeConfigureArgs);
    cpp.cmakeConfigureArgs.push('mutated');
    assert.deepEqual(config.cppModulePrefs.cmakeConfigureArgs, ['-A', 'x64']);
});
