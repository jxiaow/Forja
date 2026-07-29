import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    loadWorkspacesRegistry,
    saveWorkspacesRegistry,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    resolveWorkroot,
    generateTargetId,
    getActiveTarget,
    createEmptyWorkspaceConfig,
    normalizePath,
    workspaceConfigPath,
    workspacesRegistryPath,
    type WorkspaceConfig,
} from '../core/workspaceStore';

const _tmpDirs: string[] = [];
const _oldConfigDir = process.env.FORJA_CONFIG_DIR;
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-ws-test-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;
_tmpDirs.push(_testConfigDir);

after(() => {
    if (_oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = _oldConfigDir; }
    for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); }
});

function freshConfigDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-ws-fresh-'));
    _tmpDirs.push(dir);
    process.env.FORJA_CONFIG_DIR = dir;
    return dir;
}

// ── Registry ──

test('loadWorkspacesRegistry returns empty when no file exists', () => {
    freshConfigDir();
    const reg = loadWorkspacesRegistry();
    assert.deepEqual(reg.workroots, []);
});

test('saveWorkspacesRegistry round-trips', () => {
    freshConfigDir();
    saveWorkspacesRegistry({ workroots: ['C:/Code/app', 'C:/Code/lib'] });
    const loaded = loadWorkspacesRegistry();
    assert.deepEqual(loaded.workroots, ['C:/Code/app', 'C:/Code/lib']);
});

test('loadWorkspacesRegistry throws on corrupted JSON', () => {
    freshConfigDir();
    fs.mkdirSync(path.dirname(workspacesRegistryPath()), { recursive: true });
    fs.writeFileSync(workspacesRegistryPath(), '{not valid json', 'utf8');
    assert.throws(() => loadWorkspacesRegistry(), /损坏/);
});

// ── Per-workspace config ──

test('loadWorkspaceConfig returns empty when file does not exist', () => {
    freshConfigDir();
    const config = loadWorkspaceConfig('C:/Code/myapp');
    assert.equal(config.activeTarget, null);
    assert.deepEqual(config.targets, {});
    assert.equal(config.workroot, normalizePath('C:/Code/myapp'));
});

test('saveWorkspaceConfig round-trips with all fields', () => {
    freshConfigDir();
    const workroot = 'C:/Code/myapp';
    const config: WorkspaceConfig = {
        workroot,
        activeTarget: 'qt-app-debug-x64',
        targets: {
            'qt-app-debug-x64': {
                id: 'qt-app-debug-x64',
                name: 'MyApp Debug x64',
                kind: 'qt',
                project: 'app/app.pro',
                mode: 'debug',
                arch: 'x64',
                runAt: 'local',
                toolchain: {
                    qtPath: 'C:/Qt/6.5.3/msvc2019_64',
                    qtVersion: '6.5.3',
                    vsInstall: 'C:/VS/2019/Pro',
                },
            },
        },
        qtModulePrefs: {
            qmakeArgs: 'DEFINES+=FEATURE_X',
            cStandard: 'c11',
            cppStandard: 'c++17',
            designerPath: '',
            qtSourcePath: '',
            manualProPath: '',
            rccProjectPath: '',
            scanExcludeDirs: ['vendor'],
            customCommands: [],
            suppressedWarnings: ['C4100'],
            fileSyncPromptEnabled: false,
            qmakeReminderEnabled: true,
        },
        cppModulePrefs: { scanDepth: 12 },
    };
    saveWorkspaceConfig(config);
    const loaded = loadWorkspaceConfig(workroot);
    assert.equal(loaded.activeTarget, 'qt-app-debug-x64');
    assert.equal(loaded.targets['qt-app-debug-x64'].kind, 'qt');
    assert.equal(loaded.targets['qt-app-debug-x64'].toolchain.qtPath, 'C:/Qt/6.5.3/msvc2019_64');
    assert.equal(loaded.qtModulePrefs.qmakeArgs, 'DEFINES+=FEATURE_X');
    assert.equal(loaded.qtModulePrefs.fileSyncPromptEnabled, false);
    assert.deepEqual(loaded.qtModulePrefs.scanExcludeDirs, ['vendor']);
    assert.equal(loaded.cppModulePrefs.scanDepth, 12);
});

test('loadWorkspaceConfig throws on corrupted JSON', () => {
    freshConfigDir();
    const workroot = 'C:/Code/corrupt';
    const filePath = workspaceConfigPath(workroot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{broken json!!!', 'utf8');
    assert.throws(() => loadWorkspaceConfig(workroot), /损坏/);
});

test('sanitizeWorkspaceConfig handles unknown fields gracefully', () => {
    freshConfigDir();
    const workroot = 'C:/Code/sanitize';
    const filePath = workspaceConfigPath(workroot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
        workroot,
        activeTarget: 'qt-app-debug-x64',
        schemaVersion: 1,
        unknownField: 'should be ignored',
        targets: {
            'qt-app-debug-x64': {
                id: 'qt-app-debug-x64',
                kind: 'qt',
                project: 'app.pro',
                mode: 'debug',
                arch: 'x64',
                runAt: 'local',
                extraField: true,
                toolchain: { qtPath: 'D:/Qt', unknownTool: 'ignored' },
            },
        },
        qtModulePrefs: { qmakeArgs: '', unknownPref: 42 },
    }), 'utf8');
    const loaded = loadWorkspaceConfig(workroot);
    assert.equal(loaded.activeTarget, 'qt-app-debug-x64');
    assert.equal(loaded.targets['qt-app-debug-x64'].toolchain.qtPath, 'D:/Qt');
    assert.equal((loaded.targets['qt-app-debug-x64'] as unknown as Record<string, unknown>).extraField, undefined);
});

// ── Legacy isolation ──

test('workspaceStore does NOT read from legacy projects/ directory', () => {
    const dir = freshConfigDir();
    // Create a legacy projects/ directory with a config file
    const projectsDir = path.join(dir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    // Write a fake legacy config (the old format with workspace/type fields)
    const legacyHash = 'abcdef123456';
    fs.writeFileSync(path.join(projectsDir, `${legacyHash}.json`), JSON.stringify({
        workspace: 'C:/Code/legacy-app',
        type: 'qt',
        qtPath: 'D:/LegacyQt',
        mode: 'release',
        arch: 'x64',
        pinnedProject: { root: 'C:/Code/legacy-app', relative: 'app.pro' },
    }), 'utf8');

    // workspaceStore should NOT find this — it only reads workspaces.json + workspaces/
    const reg = loadWorkspacesRegistry();
    assert.deepEqual(reg.workroots, [], 'legacy projects/ must not populate registry');

    // loadWorkspaceConfig for the legacy workroot should return empty
    const config = loadWorkspaceConfig('C:/Code/legacy-app');
    assert.equal(config.activeTarget, null, 'must not read legacy config');
    assert.deepEqual(config.targets, {}, 'must not read legacy targets');
});

test('workspaceStore ignores legacy projects/ even when workspaces/ has data', () => {
    const dir = freshConfigDir();
    // Set up a valid workspace
    const workroot = 'C:/Code/modern-app';
    saveWorkspacesRegistry({ workroots: [workroot] });
    saveWorkspaceConfig({
        ...createEmptyWorkspaceConfig(workroot),
        activeTarget: 'qt-modern-debug-x64',
        targets: {
            'qt-modern-debug-x64': {
                id: 'qt-modern-debug-x64',
                name: 'Modern',
                kind: 'qt',
                project: 'app.pro',
                mode: 'debug',
                arch: 'x64',
                runAt: 'local',
                toolchain: { qtPath: 'D:/ModernQt' },
            },
        },
    });

    // Also create a legacy projects/ directory
    const projectsDir = path.join(dir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(path.join(projectsDir, 'deadbeef0000.json'), JSON.stringify({
        workspace: 'C:/Code/legacy-app',
        type: 'qt',
        qtPath: 'D:/LegacyQt',
    }), 'utf8');

    // Registry should only have the modern workroot
    const reg = loadWorkspacesRegistry();
    assert.equal(reg.workroots.length, 1);
    assert.equal(reg.workroots[0], workroot);

    // Legacy workroot should not be resolvable
    const config = loadWorkspaceConfig('C:/Code/legacy-app');
    assert.equal(config.activeTarget, null);
});

// ── Workroot resolution ──

test('resolveWorkroot returns null when no workroots registered', () => {
    freshConfigDir();
    assert.equal(resolveWorkroot('C:/Code/anything'), null);
});

test('resolveWorkroot does deepest prefix match', () => {
    freshConfigDir();
    saveWorkspacesRegistry({ workroots: ['C:/Code', 'C:/Code/myapp'] });
    // C:/Code/myapp/src should match C:/Code/myapp (deeper), not C:/Code
    assert.equal(resolveWorkroot('C:/Code/myapp/src'), 'C:/Code/myapp');
    // C:/Code/other should match C:/Code
    assert.equal(resolveWorkroot('C:/Code/other'), 'C:/Code');
});

test('resolveWorkroot does not match partial directory names', () => {
    freshConfigDir();
    saveWorkspacesRegistry({ workroots: ['C:/Code/app'] });
    // C:/Code/app-v2 should NOT match C:/Code/app
    assert.equal(resolveWorkroot('C:/Code/app-v2'), null);
});

// ── Target helpers ──

test('generateTargetId produces stable IDs', () => {
    const id = generateTargetId('qt', 'app/app.pro', 'debug', 'x64');
    assert.equal(id, 'qt-app-debug-x64');
});

test('generateTargetId appends hash on collision', () => {
    const existing = new Set(['qt-app-debug-x64']);
    const id = generateTargetId('qt', 'app/app.pro', 'debug', 'x64', existing);
    assert.notEqual(id, 'qt-app-debug-x64');
    assert.ok(id.startsWith('qt-app-debug-x64-'));
});

test('getActiveTarget returns null when no active target', () => {
    const config = createEmptyWorkspaceConfig('C:/Code/test');
    assert.equal(getActiveTarget(config), null);
});

test('getActiveTarget returns the active target profile', () => {
    const config = createEmptyWorkspaceConfig('C:/Code/test');
    config.activeTarget = 'qt-app-debug-x64';
    config.targets['qt-app-debug-x64'] = {
        id: 'qt-app-debug-x64',
        name: 'Test',
        kind: 'qt',
        project: 'app.pro',
        mode: 'debug',
        arch: 'x64',
        runAt: 'local',
        toolchain: {},
    };
    const target = getActiveTarget(config);
    assert.ok(target);
    assert.equal(target!.id, 'qt-app-debug-x64');
});
