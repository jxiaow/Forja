import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_QT,
    DEFAULT_SDK,
    DEFAULT_SYNC,
    loadQtSettings,
    saveQtSettings,
    loadSdkSettings,
    saveSdkSettings,
    loadSyncSettings,
    saveSyncSettings,
    projectConfigPath,
    listProjectConfigs,
} from '../core/settingsIO';

const _tmpDirs: string[] = [];
const _createdFiles: string[] = [];

after(() => {
    for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); }
    for (const f of _createdFiles) { try { fs.unlinkSync(f); } catch { /* ok */ } }
});

function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-settings-'));
    _tmpDirs.push(ws);
    return ws;
}

function trackFile(filePath: string): void {
    _createdFiles.push(filePath);
}

// ── loadQtSettings ──

test('loadQtSettings returns defaults when no config exists', () => {
    const workspace = makeWorkspace();
    const settings = loadQtSettings(workspace);
    assert.deepEqual(settings, DEFAULT_QT);
});

test('loadQtSettings reads from ~/.compilot/projects/<hash>.json', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'qt');
    trackFile(filePath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, JSON.stringify({
        workspace,
        type: 'qt',
        qtPath: 'D:/Qt/5.15',
        mode: 'release'
    }), 'utf8');

    const settings = loadQtSettings(workspace);
    assert.equal(settings.qtPath, 'D:/Qt/5.15');
    assert.equal(settings.mode, 'release');
    // 未指定的字段使用默认值
    assert.equal(settings.arch, '');
    assert.equal(settings.cStandard, 'c11');
    assert.equal(settings.fileSyncPromptEnabled, true);
    assert.equal(settings.pinnedProject, null);
    assert.equal(settings.runtimeProcessName, '');
});

test('loadQtSettings preserves all field types correctly', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'qt');
    trackFile(filePath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, JSON.stringify({
        workspace,
        type: 'qt',
        qtPath: 'D:/Qt',
        arch: 'x64',
        mode: 'release',
        runtimeProcessName: 'XYWinQTPri',
        scanExcludeDirs: ['vendor'],
        pinnedProject: { root: 'C:/ws', relative: 'app.pro' },
        fileSyncPromptEnabled: false,
        qmakeReminderEnabled: false
    }), 'utf8');

    const settings = loadQtSettings(workspace);
    assert.equal(settings.qtPath, 'D:/Qt');
    assert.equal(settings.arch, 'x64');
    assert.equal(settings.mode, 'release');
    assert.equal(settings.runtimeProcessName, 'XYWinQTPri');
    assert.deepEqual(settings.scanExcludeDirs, ['vendor']);
    assert.deepEqual(settings.pinnedProject, { root: 'C:/ws', relative: 'app.pro' });
    assert.equal(settings.fileSyncPromptEnabled, false);
    assert.equal(settings.qmakeReminderEnabled, false);
});

test('loadQtSettings returns defaults when file is malformed', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'qt');
    trackFile(filePath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, '{ invalid json !!!', 'utf8');

    const settings = loadQtSettings(workspace);
    assert.deepEqual(settings, DEFAULT_QT);
});

// ── saveQtSettings ──

test('saveQtSettings writes to ~/.compilot/projects/ with workspace and type fields', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'qt');
    trackFile(filePath);

    saveQtSettings(workspace, { ...DEFAULT_QT, qtPath: 'C:/Qt/6.5', mode: 'release', arch: 'x64' });

    assert.equal(fs.existsSync(filePath), true);
    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(loaded.workspace, workspace);
    assert.equal(loaded.type, 'qt');
    assert.equal(loaded.qtPath, 'C:/Qt/6.5');
    assert.equal(loaded.mode, 'release');
    assert.equal(loaded.arch, 'x64');
});

test('saveQtSettings round-trips with loadQtSettings', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'qt'));

    const original = {
        ...DEFAULT_QT,
        qtPath: 'D:/Qt',
        pinnedProject: { root: 'C:/workspace', relative: 'app/demo.pro' },
        scanExcludeDirs: ['vendor', 'third_party'],
        fileSyncPromptEnabled: false,
        qmakeReminderEnabled: false
    };

    saveQtSettings(workspace, original);
    const loaded = loadQtSettings(workspace);

    assert.equal(loaded.qtPath, 'D:/Qt');
    assert.deepEqual(loaded.pinnedProject, { root: 'C:/workspace', relative: 'app/demo.pro' });
    assert.deepEqual(loaded.scanExcludeDirs, ['vendor', 'third_party']);
    assert.equal(loaded.fileSyncPromptEnabled, false);
    assert.equal(loaded.qmakeReminderEnabled, false);
});

test('saveQtSettings overwrites existing file', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'qt'));

    saveQtSettings(workspace, { ...DEFAULT_QT, qtPath: 'first' });
    saveQtSettings(workspace, { ...DEFAULT_QT, qtPath: 'second' });

    const loaded = loadQtSettings(workspace);
    assert.equal(loaded.qtPath, 'second');
});

// ── SDK ──

test('loadSdkSettings returns defaults when no config exists', () => {
    const workspace = makeWorkspace();
    const settings = loadSdkSettings(workspace);
    assert.deepEqual(settings, DEFAULT_SDK);
});

test('saveSdkSettings round-trips with loadSdkSettings', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'sdk'));

    saveSdkSettings(workspace, { ...DEFAULT_SDK, vsInstall: 'C:/VS/2022', pinnedProject: 'my.sln' });
    const loaded = loadSdkSettings(workspace);

    assert.equal(loaded.vsInstall, 'C:/VS/2022');
    assert.equal(loaded.pinnedProject, 'my.sln');
});

// ── Sync ──

test('loadSyncSettings returns defaults when no config exists', () => {
    const workspace = makeWorkspace();
    const settings = loadSyncSettings(workspace);
    assert.deepEqual(settings, DEFAULT_SYNC);
});

test('saveSyncSettings round-trips with loadSyncSettings', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'sync'));

    saveSyncSettings(workspace, { ...DEFAULT_SYNC, enabled: true, selectedServer: 'dev-server' });
    const loaded = loadSyncSettings(workspace);

    assert.equal(loaded.enabled, true);
    assert.equal(loaded.selectedServer, 'dev-server');
});

test('loadSyncSettings looks up parent directory', () => {
    const parent = makeWorkspace();
    const child = path.join(parent, 'qt_client');
    fs.mkdirSync(child, { recursive: true });

    // Save sync config for parent
    trackFile(projectConfigPath(parent, 'sync'));
    saveSyncSettings(parent, { ...DEFAULT_SYNC, enabled: true, selectedServer: 'parent-server' });

    // Load from child should find parent's config
    const loaded = loadSyncSettings(child);
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.selectedServer, 'parent-server');
});

test('loadSyncSettings prefers current directory over parent', () => {
    const parent = makeWorkspace();
    const child = path.join(parent, 'qt_client');
    fs.mkdirSync(child, { recursive: true });

    trackFile(projectConfigPath(parent, 'sync'));
    trackFile(projectConfigPath(child, 'sync'));

    saveSyncSettings(parent, { ...DEFAULT_SYNC, enabled: true, selectedServer: 'parent-server' });
    saveSyncSettings(child, { ...DEFAULT_SYNC, enabled: true, selectedServer: 'child-server' });

    const loaded = loadSyncSettings(child);
    assert.equal(loaded.selectedServer, 'child-server');
});

// ── projectConfigPath ──

test('projectConfigPath returns path under ~/.compilot/projects/', () => {
    const result = projectConfigPath('C:/workspace/dev/qt_client', 'qt');
    assert.match(result, /\.compilot[/\\]projects[/\\][a-f0-9]{12}\.json$/);
});

test('projectConfigPath generates different hashes for different types', () => {
    const qtPath = projectConfigPath('C:/workspace', 'qt');
    const sdkPath = projectConfigPath('C:/workspace', 'sdk');
    const syncPath = projectConfigPath('C:/workspace', 'sync');
    assert.notEqual(qtPath, sdkPath);
    assert.notEqual(qtPath, syncPath);
    assert.notEqual(sdkPath, syncPath);
});

test('projectConfigPath is case-insensitive on path', () => {
    const lower = projectConfigPath('c:/workspace/dev', 'qt');
    const upper = projectConfigPath('C:/Workspace/Dev', 'qt');
    assert.equal(lower, upper);
});

// ── listProjectConfigs ──

test('listProjectConfigs returns saved configs', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'qt'));

    saveQtSettings(workspace, { ...DEFAULT_QT, qtPath: 'test' });
    const configs = listProjectConfigs();
    const found = configs.find(c => c.workspace === workspace && c.type === 'qt');
    assert.ok(found, 'should find the saved qt config');
});
