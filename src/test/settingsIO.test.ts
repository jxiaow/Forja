import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_SETTINGS,
    DEFAULT_QT,
    DEFAULT_SDK,
    DEFAULT_SYNC,
    loadSettings,
    saveSettings,
    settingsFilePath,
    CompilotSettings
} from '../core/settingsIO';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-settings-'));
    _tmpDirs.push(ws);
    return ws;
}

// ── loadSettings ──

test('loadSettings returns defaults when settings.json does not exist', () => {
    const workspace = makeWorkspace();
    const settings = loadSettings(workspace);
    assert.deepEqual(settings, DEFAULT_SETTINGS);
});

test('loadSettings merges partial file with defaults', () => {
    const workspace = makeWorkspace();
    const dir = path.join(workspace, '.compilot');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        qt: { qtPath: 'D:/Qt/5.15', mode: 'release' }
    }), 'utf8');

    const settings = loadSettings(workspace);
    assert.equal(settings.qt.qtPath, 'D:/Qt/5.15');
    assert.equal(settings.qt.mode, 'release');
    // 未指定的字段使用默认值（arch 默认 '' 表示运行时解析）
    assert.equal(settings.qt.arch, '');
    assert.equal(settings.qt.cStandard, 'c11');
    assert.equal(settings.qt.fileSyncPromptEnabled, true);
    assert.equal(settings.qt.pinnedProject, null);
});

test('loadSettings returns defaults when settings.json is malformed', () => {
    const workspace = makeWorkspace();
    const dir = path.join(workspace, '.compilot');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ invalid json !!!', 'utf8');

    const settings = loadSettings(workspace);
    assert.deepEqual(settings, DEFAULT_SETTINGS);
});

test('loadSettings preserves all field types correctly', () => {
    const workspace = makeWorkspace();
    const dir = path.join(workspace, '.compilot');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        qt: {
            qtPath: 'D:/Qt',
            arch: 'x64',
            mode: 'release',
            scanExcludeDirs: ['vendor'],
            pinnedProject: { root: 'C:/ws', relative: 'app.pro' },
            fileSyncPromptEnabled: false,
            qmakeReminderEnabled: false
        },
        sdk: { mode: 'debug', arch: 'x86' },
        sync: { enabled: false }
    }), 'utf8');

    const settings = loadSettings(workspace);
    assert.equal(settings.qt.qtPath, 'D:/Qt');
    assert.equal(settings.qt.arch, 'x64');
    assert.equal(settings.qt.mode, 'release');
    assert.deepEqual(settings.qt.scanExcludeDirs, ['vendor']);
    assert.deepEqual(settings.qt.pinnedProject, { root: 'C:/ws', relative: 'app.pro' });
    assert.equal(settings.qt.fileSyncPromptEnabled, false);
    assert.equal(settings.qt.qmakeReminderEnabled, false);
});

// ── saveSettings ──

test('saveSettings creates .compilot directory and writes settings.json', () => {
    const workspace = makeWorkspace();
    const settings: CompilotSettings = {
        qt: { ...DEFAULT_QT, qtPath: 'C:/Qt/6.5', vsInstall: 'C:/VS', mode: 'release', arch: 'x64' },
        sdk: { ...DEFAULT_SDK },
        sync: { ...DEFAULT_SYNC }
    };

    saveSettings(workspace, settings);

    const filePath = settingsFilePath(workspace);
    assert.equal(fs.existsSync(filePath), true);

    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(loaded.qt.qtPath, 'C:/Qt/6.5');
    assert.equal(loaded.qt.vsInstall, 'C:/VS');
    assert.equal(loaded.qt.mode, 'release');
    assert.equal(loaded.qt.arch, 'x64');
});

test('saveSettings persists and loadSettings round-trips correctly', () => {
    const workspace = makeWorkspace();
    const settings: CompilotSettings = {
        qt: {
            ...DEFAULT_QT,
            qtPath: 'D:/Qt',
            pinnedProject: { root: 'C:/workspace', relative: 'app/demo.pro' },
            scanExcludeDirs: ['vendor', 'third_party'],
            fileSyncPromptEnabled: false,
            qmakeReminderEnabled: false
        },
        sdk: { ...DEFAULT_SDK },
        sync: { ...DEFAULT_SYNC }
    };

    saveSettings(workspace, settings);
    const loaded = loadSettings(workspace);

    assert.equal(loaded.qt.qtPath, 'D:/Qt');
    assert.deepEqual(loaded.qt.pinnedProject, { root: 'C:/workspace', relative: 'app/demo.pro' });
    assert.deepEqual(loaded.qt.scanExcludeDirs, ['vendor', 'third_party']);
    assert.equal(loaded.qt.fileSyncPromptEnabled, false);
    assert.equal(loaded.qt.qmakeReminderEnabled, false);
});

test('saveSettings overwrites existing file', () => {
    const workspace = makeWorkspace();

    saveSettings(workspace, { qt: { ...DEFAULT_QT, qtPath: 'first' }, sdk: { ...DEFAULT_SDK }, sync: { ...DEFAULT_SYNC } });
    saveSettings(workspace, { qt: { ...DEFAULT_QT, qtPath: 'second' }, sdk: { ...DEFAULT_SDK }, sync: { ...DEFAULT_SYNC } });

    const loaded = loadSettings(workspace);
    assert.equal(loaded.qt.qtPath, 'second');
});

test('saveSettings writes valid JSON with 4-space indentation', () => {
    const workspace = makeWorkspace();
    saveSettings(workspace, { qt: { ...DEFAULT_QT, qtPath: 'D:/Qt' }, sdk: { ...DEFAULT_SDK }, sync: { ...DEFAULT_SYNC } });

    const raw = fs.readFileSync(settingsFilePath(workspace), 'utf8');
    assert.match(raw, /^{\n {4}"qt": {\n {8}"mode"/);
    assert.match(raw, /\n$/); // trailing newline
});

// ── settingsFilePath ──

test('settingsFilePath returns correct path under .compilot', () => {
    const result = settingsFilePath('C:/workspace');
    assert.equal(result, path.join('C:/workspace', '.compilot', 'settings.json'));
});
