import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    settingsFilePath,
    QtPilotSettings
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
        qtPath: 'D:/Qt/5.15',
        mode: 'release'
    }), 'utf8');

    const settings = loadSettings(workspace);
    assert.equal(settings.qtPath, 'D:/Qt/5.15');
    assert.equal(settings.mode, 'release');
    // 未指定的字段使用默认值（arch 默认 '' 表示运行时解析）
    assert.equal(settings.arch, '');
    assert.equal(settings.cStandard, 'c11');
    assert.equal(settings.fileSyncPromptEnabled, true);
    assert.equal(settings.pinnedProject, null);
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
        qtPath: 'D:/Qt',
        arch: 'x64',
        mode: 'release',
        scanExcludeDirs: ['vendor'],
        pinnedProject: { root: 'C:/ws', relative: 'app.pro' },
        fileSyncPromptEnabled: false,
        qmakeReminderEnabled: false
    }), 'utf8');

    const settings = loadSettings(workspace);
    assert.equal(settings.qtPath, 'D:/Qt');
    assert.equal(settings.arch, 'x64');
    assert.equal(settings.mode, 'release');
    assert.deepEqual(settings.scanExcludeDirs, ['vendor']);
    assert.deepEqual(settings.pinnedProject, { root: 'C:/ws', relative: 'app.pro' });
    assert.equal(settings.fileSyncPromptEnabled, false);
    assert.equal(settings.qmakeReminderEnabled, false);
});

// ── saveSettings ──

test('saveSettings creates .compilot directory and writes settings.json', () => {
    const workspace = makeWorkspace();
    const settings: QtPilotSettings = {
        ...DEFAULT_SETTINGS,
        qtPath: 'C:/Qt/6.5',
        vsDevShellPath: 'C:/VS/Launch-VsDevShell.ps1',
        mode: 'release',
        arch: 'x64'
    };

    saveSettings(workspace, settings);

    const filePath = settingsFilePath(workspace);
    assert.equal(fs.existsSync(filePath), true);

    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(loaded.qtPath, 'C:/Qt/6.5');
    assert.equal(loaded.vsDevShellPath, 'C:/VS/Launch-VsDevShell.ps1');
    assert.equal(loaded.mode, 'release');
    assert.equal(loaded.arch, 'x64');
});

test('saveSettings persists and loadSettings round-trips correctly', () => {
    const workspace = makeWorkspace();
    const settings: QtPilotSettings = {
        ...DEFAULT_SETTINGS,
        qtPath: 'D:/Qt',
        pinnedProject: { root: 'C:/workspace', relative: 'app/demo.pro' },
        scanExcludeDirs: ['vendor', 'third_party'],
        fileSyncPromptEnabled: false,
        qmakeReminderEnabled: false
    };

    saveSettings(workspace, settings);
    const loaded = loadSettings(workspace);

    assert.equal(loaded.qtPath, 'D:/Qt');
    assert.deepEqual(loaded.pinnedProject, { root: 'C:/workspace', relative: 'app/demo.pro' });
    assert.deepEqual(loaded.scanExcludeDirs, ['vendor', 'third_party']);
    assert.equal(loaded.fileSyncPromptEnabled, false);
    assert.equal(loaded.qmakeReminderEnabled, false);
});

test('saveSettings overwrites existing file', () => {
    const workspace = makeWorkspace();

    saveSettings(workspace, { ...DEFAULT_SETTINGS, qtPath: 'first' });
    saveSettings(workspace, { ...DEFAULT_SETTINGS, qtPath: 'second' });

    const loaded = loadSettings(workspace);
    assert.equal(loaded.qtPath, 'second');
});

test('saveSettings writes valid JSON with 4-space indentation', () => {
    const workspace = makeWorkspace();
    saveSettings(workspace, { ...DEFAULT_SETTINGS, qtPath: 'D:/Qt' });

    const raw = fs.readFileSync(settingsFilePath(workspace), 'utf8');
    assert.match(raw, /^{\n {4}"qtPath": "D:\/Qt"/);
    assert.match(raw, /\n$/); // trailing newline
});

// ── settingsFilePath ──

test('settingsFilePath returns correct path under .compilot', () => {
    const result = settingsFilePath('C:/workspace');
    assert.equal(result, path.join('C:/workspace', '.compilot', 'settings.json'));
});
