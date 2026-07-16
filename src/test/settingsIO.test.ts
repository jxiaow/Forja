import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_QT,
    DEFAULT_CPP,
    DEFAULT_SYNC,
    loadQtSettings,
    saveQtSettings,
    loadCppSettings,
    saveCppSettings,
    loadSyncSettings,
    saveSyncSettings,
    DEFAULT_REMOTE,
    loadRemoteSettings,
    saveRemoteSettings,
    projectConfigPath,
    listProjectConfigs,
} from '../core/settingsIO';
import { setOutputWriter } from '../core/loggerBase';

const _tmpDirs: string[] = [];
const _createdFiles: string[] = [];
const _oldConfigDir = process.env.FORJA_CONFIG_DIR;
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-settings-config-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;
_tmpDirs.push(_testConfigDir);

after(() => {
    if (_oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = _oldConfigDir; }
    for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); }
    for (const f of _createdFiles) { try { fs.unlinkSync(f); } catch { /* ok */ } }
});

function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-settings-'));
    _tmpDirs.push(ws);
    return ws;
}

function trackFile(filePath: string): void {
    _createdFiles.push(filePath);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function captureOutputLines<T>(fn: () => T): { result: T; lines: string[] } {
    const lines: string[] = [];
    setOutputWriter(line => lines.push(line));
    try {
        return { result: fn(), lines };
    } finally {
        setOutputWriter(null);
    }
}

// ── loadQtSettings ──

test('loadQtSettings returns defaults when no config exists', () => {
    const workspace = makeWorkspace();
    const settings = loadQtSettings(workspace);
    assert.deepEqual(settings, DEFAULT_QT);
});

test('loadQtSettings reads from ~/.forja/projects/<hash>.json', () => {
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
    assert.equal(settings.qmakeArgs, '');
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
        qmakeArgs: 'DEFINES+=FEATURE_X CONFIG+=qml_debug',
        scanExcludeDirs: ['vendor'],
        pinnedProject: { root: 'C:/ws', relative: 'app.pro' },
        fileSyncPromptEnabled: false,
        qmakeReminderEnabled: false
    }), 'utf8');

    const settings = loadQtSettings(workspace);
    assert.equal(settings.qtPath, 'D:/Qt');
    assert.equal(settings.arch, 'x64');
    assert.equal(settings.mode, 'release');
    assert.equal(settings.qmakeArgs, 'DEFINES+=FEATURE_X CONFIG+=qml_debug');
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

    const { result: settings, lines } = captureOutputLines(() => loadQtSettings(workspace));
    assert.deepEqual(settings, DEFAULT_QT);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\]/);
    assert.match(lines[0], /qt 配置读取失败/);
    assert.match(lines[0], /invalid json/i);
    assert.match(lines[0], new RegExp(escapeRegExp(filePath)));
    fs.rmSync(filePath, { force: true });
});

test('loadQtSettings uses unique child workspace config from parent directory', () => {
    const parent = makeWorkspace();
    const child = path.join(parent, 'qt_client');
    fs.mkdirSync(child, { recursive: true });
    trackFile(projectConfigPath(child, 'qt'));

    saveQtSettings(child, {
        ...DEFAULT_QT,
        qtPath: 'D:/Qt/5.15',
        mode: 'release',
        arch: 'x86',
        pinnedProject: { root: child, relative: 'client.pro' }
    });

    const loaded = loadQtSettings(parent);
    assert.equal(loaded.qtPath, 'D:/Qt/5.15');
    assert.equal(loaded.mode, 'release');
    assert.deepEqual(loaded.pinnedProject, { root: child, relative: 'client.pro' });
});

test('loadQtSettings does not guess when parent directory has multiple child configs', () => {
    const parent = makeWorkspace();
    const first = path.join(parent, 'qt_client');
    const second = path.join(parent, 'qt_tool');
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    trackFile(projectConfigPath(first, 'qt'));
    trackFile(projectConfigPath(second, 'qt'));

    saveQtSettings(first, { ...DEFAULT_QT, qtPath: 'D:/Qt/first' });
    saveQtSettings(second, { ...DEFAULT_QT, qtPath: 'D:/Qt/second' });

    const loaded = loadQtSettings(parent);
    assert.deepEqual(loaded, DEFAULT_QT);
});

// ── saveQtSettings ──

test('saveQtSettings writes to ~/.forja/projects/ with workspace and type fields', () => {
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
        qmakeArgs: 'DEFINES+=FEATURE_X',
        fileSyncPromptEnabled: false,
        qmakeReminderEnabled: false
    };

    saveQtSettings(workspace, original);
    const loaded = loadQtSettings(workspace);

    assert.equal(loaded.qtPath, 'D:/Qt');
    assert.deepEqual(loaded.pinnedProject, { root: 'C:/workspace', relative: 'app/demo.pro' });
    assert.deepEqual(loaded.scanExcludeDirs, ['vendor', 'third_party']);
    assert.equal(loaded.qmakeArgs, 'DEFINES+=FEATURE_X');
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

// ── C++ ──

test('loadCppSettings returns defaults when no config exists', () => {
    const workspace = makeWorkspace();
    const settings = loadCppSettings(workspace);
    assert.deepEqual(settings, DEFAULT_CPP);
});

test('loadCppSettings warns and returns defaults when file is malformed', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'cpp');
    trackFile(filePath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, '{ invalid json !!!', 'utf8');

    const { result: settings, lines } = captureOutputLines(() => loadCppSettings(workspace));
    assert.deepEqual(settings, DEFAULT_CPP);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\]/);
    assert.match(lines[0], /cpp 配置读取失败/);
    assert.match(lines[0], /invalid json/i);
    assert.match(lines[0], new RegExp(escapeRegExp(filePath)));
    fs.rmSync(filePath, { force: true });
});

test('saveCppSettings round-trips with loadCppSettings', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'cpp'));

    saveCppSettings(workspace, { ...DEFAULT_CPP, vsInstall: 'C:/VS/2022', pinnedProject: 'my.sln' });
    const loaded = loadCppSettings(workspace);

    assert.equal(loaded.vsInstall, 'C:/VS/2022');
    assert.equal(loaded.pinnedProject, 'my.sln');
});

// ── Sync ──

test('loadSyncSettings returns defaults when no config exists', () => {
    const workspace = makeWorkspace();
    const settings = loadSyncSettings(workspace);
    assert.deepEqual(settings, DEFAULT_SYNC);
});

test('loadSyncSettings warns and returns defaults when file is malformed', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'sync');
    trackFile(filePath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, '{ invalid json !!!', 'utf8');

    const { result: settings, lines } = captureOutputLines(() => loadSyncSettings(workspace));
    assert.deepEqual(settings, DEFAULT_SYNC);

    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\]/);
    assert.match(lines[0], /sync 配置读取失败/);
    assert.match(lines[0], /invalid json/i);
    assert.match(lines[0], new RegExp(escapeRegExp(filePath)));
    fs.rmSync(filePath, { force: true });
});

test('saveSyncSettings round-trips with loadSyncSettings', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'sync'));

    saveSyncSettings(workspace, { ...DEFAULT_SYNC, enabled: true, ignore: ['*.tmp'] });
    const loaded = loadSyncSettings(workspace);

    assert.equal(loaded.enabled, true);
    assert.deepEqual(loaded.ignore, ['*.tmp']);
});

test('loadSyncSettings looks up parent directory', () => {
    const parent = makeWorkspace();
    const child = path.join(parent, 'qt_client');
    fs.mkdirSync(child, { recursive: true });

    // Save sync config for parent
    trackFile(projectConfigPath(parent, 'sync'));
    saveSyncSettings(parent, { ...DEFAULT_SYNC, enabled: true, ignore: ['build'] });

    // Load from child should find parent's config
    const loaded = loadSyncSettings(child);
    assert.equal(loaded.enabled, true);
    assert.deepEqual(loaded.ignore, ['build']);
});

test('loadSyncSettings prefers current directory over parent', () => {
    const parent = makeWorkspace();
    const child = path.join(parent, 'qt_client');
    fs.mkdirSync(child, { recursive: true });

    trackFile(projectConfigPath(parent, 'sync'));
    trackFile(projectConfigPath(child, 'sync'));

    saveSyncSettings(parent, { ...DEFAULT_SYNC, enabled: true, ignore: ['parent-ignore'] });
    saveSyncSettings(child, { ...DEFAULT_SYNC, enabled: false, ignore: ['child-ignore'] });

    const loaded = loadSyncSettings(child);
    assert.equal(loaded.enabled, false);
    assert.deepEqual(loaded.ignore, ['child-ignore']);
});

// ── Remote ──

test('saveRemoteSettings round-trips with loadRemoteSettings', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'remote'));

    saveRemoteSettings(workspace, {
        ...DEFAULT_REMOTE,
        remoteForjaBin: '/opt/forja/bin/forja',
        buildOrder: [{ target: 'qt', action: 'build', args: ['--verbose'] }],
        transfer: { deployServer: 'deploy-1', deployPath: '/opt/app', artifacts: ['build/app.exe'] }
    });
    const loaded = loadRemoteSettings(workspace);

    assert.equal(loaded.remoteForjaBin, '/opt/forja/bin/forja');
    assert.deepEqual(loaded.buildOrder, [{ target: 'qt', action: 'build', args: ['--verbose'] }]);
    assert.deepEqual(loaded.transfer, { deployServer: 'deploy-1', deployPath: '/opt/app', artifacts: ['build/app.exe'] });
});

test('loadRemoteSettings warns and returns defaults when file is malformed', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'remote');
    trackFile(filePath);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(filePath, '{ invalid json !!!', 'utf8');

    const { result: settings, lines } = captureOutputLines(() => loadRemoteSettings(workspace));
    assert.deepEqual(settings, DEFAULT_REMOTE);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\]/);
    assert.match(lines[0], /remote 配置读取失败/);
    assert.match(lines[0], /invalid json/i);
    assert.match(lines[0], new RegExp(escapeRegExp(filePath)));
    fs.rmSync(filePath, { force: true });
});

test('saveRemoteSettings round-trips staged workspace repo mappings', () => {
    const workspace = makeWorkspace();
    trackFile(projectConfigPath(workspace, 'remote'));

    saveRemoteSettings(workspace, {
        ...DEFAULT_REMOTE,
        workspaceMode: 'staged',
        profile: 'release_6.0_3.9',
        remoteWorkspace: '/home/xw/workspace/forja-remote/release_6.0_3.9',
        repos: [
            { localName: 'qt_client', remoteName: 'qt_client', role: 'primary', baseline: 'auto', overlay: true },
            { localName: 'xylib_win32', remoteName: 'xylib_arm64', role: 'remote-only', remotePath: '/home/xw/workspace/dev/xylib_arm64', baseline: 'status-only', overlay: false, mount: 'symlink' }
        ]
    });
    const loaded = loadRemoteSettings(workspace);

    assert.equal(loaded.workspaceMode, 'staged');
    assert.equal(loaded.profile, 'release_6.0_3.9');
    assert.equal(loaded.remoteWorkspace, '/home/xw/workspace/forja-remote/release_6.0_3.9');
    assert.deepEqual(loaded.repos, [
        { localName: 'qt_client', remoteName: 'qt_client', role: 'primary', baseline: 'auto', overlay: true },
        { localName: 'xylib_win32', remoteName: 'xylib_arm64', role: 'remote-only', remotePath: '/home/xw/workspace/dev/xylib_arm64', baseline: 'status-only', overlay: false, mount: 'symlink' }
    ]);
});

test('loadRemoteSettings looks up parent directory', () => {
    const parent = makeWorkspace();
    const child = path.join(parent, 'qt_client');
    fs.mkdirSync(child, { recursive: true });
    trackFile(projectConfigPath(parent, 'remote'));

    saveRemoteSettings(parent, {
        ...DEFAULT_REMOTE,
        buildOrder: [{ target: 'cpp', action: 'build', args: [] }]
    });
    const loaded = loadRemoteSettings(child);

    assert.deepEqual(loaded.buildOrder, [{ target: 'cpp', action: 'build', args: [] }]);
});

// ── projectConfigPath ──

test('projectConfigPath returns path under configured projects dir', () => {
    const result = projectConfigPath('C:/workspace/dev/qt_client', 'qt');
    assert.match(result, /[/\\]projects[/\\][a-f0-9]{12}\.json$/);
    assert.equal(path.dirname(result), path.join(_testConfigDir, 'projects'));
});

test('projectConfigPath falls back to ~/.forja/projects/', () => {
    delete process.env.FORJA_CONFIG_DIR;
    try {
        const result = projectConfigPath('C:/workspace/dev/qt_client', 'qt');
        assert.match(result, /\.forja[/\\]projects[/\\][a-f0-9]{12}\.json$/);
    } finally {
        process.env.FORJA_CONFIG_DIR = _testConfigDir;
    }
});

test('projectConfigPath honors FORJA_CONFIG_DIR for test isolation', () => {
    const oldConfigDir = process.env.FORJA_CONFIG_DIR;
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-config-dir-'));
    _tmpDirs.push(configDir);
    process.env.FORJA_CONFIG_DIR = configDir;

    try {
        const result = projectConfigPath('C:/workspace/dev/qt_client', 'sync');
        assert.equal(path.dirname(result), path.join(configDir, 'projects'));
    } finally {
        if (oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
        else { process.env.FORJA_CONFIG_DIR = oldConfigDir; }
    }
});

test('projectConfigPath generates different hashes for different types', () => {
    const qtPath = projectConfigPath('C:/workspace', 'qt');
    const cppPath = projectConfigPath('C:/workspace', 'cpp');
    const syncPath = projectConfigPath('C:/workspace', 'sync');
    assert.notEqual(qtPath, cppPath);
    assert.notEqual(qtPath, syncPath);
    assert.notEqual(cppPath, syncPath);
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

test('listProjectConfigs warns when a project config file is malformed', () => {
    const workspace = makeWorkspace();
    const filePath = projectConfigPath(workspace, 'qt');
    trackFile(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not valid json', 'utf8');

    const { result: configs, lines } = captureOutputLines(() => listProjectConfigs());

    assert.equal(configs.some(c => c.filePath === filePath), false);
    const matchingLines = lines.filter(line => line.includes(filePath));
    assert.equal(matchingLines.length, 1);
    assert.match(matchingLines[0], /\[WARN\]/);
    assert.match(matchingLines[0], /项目配置扫描跳过损坏文件/);
});
