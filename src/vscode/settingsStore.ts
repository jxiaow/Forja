/**
 * 统一配置存储 — Qt/C++ 从 workspaceStore 读写，Sync/Remote 仍走 settingsIO。
 *
 * Qt / C++ 配置已迁移到 workroot-based workspaceStore（~/.forja/workspaces/<hash>.json）。
 * Sync / Remote 配置仍使用 settingsIO（~/.forja/projects/<hash>.json）。
 *
 * 对外暴露 Qt / C++ / Sync 三个子模块的读写 API，消费方无需感知底层存储差异。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { createLogger } from './logger';
import { ForjaSettings, QtSettings, CppSettings, SyncSettings, DEFAULT_SETTINGS, loadSyncSettings, saveSyncSettings, loadRemoteSettings, projectsDir } from '../core/settingsIO';
import { resolveProjectRoot } from './workspaceResolver';
import {
    resolveWorkroot,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    getActiveTarget,
    workspacesDir,
    type WorkspaceConfig,
    type TargetProfile,
} from '../core/workspaceStore';

export type { ForjaSettings, QtSettings, CppSettings, SyncSettings } from '../core/settingsIO';
export { DEFAULT_SETTINGS, DEFAULT_QT, DEFAULT_CPP, DEFAULT_SYNC, resolveVsDevShellPath, resolveVsDevCmdPath } from '../core/settingsIO';

const logger = createLogger('SettingsStore');

type QtKey = keyof QtSettings;
type CppKey = keyof CppSettings;
type SyncKey = keyof SyncSettings;
type SettingsListener = (section: 'qt' | 'cpp' | 'sync' | 'remote', key: string, settings: ForjaSettings) => void;

let _settings: ForjaSettings = { ...DEFAULT_SETTINGS, qt: { ...DEFAULT_SETTINGS.qt }, cpp: { ...DEFAULT_SETTINGS.cpp }, sync: { ...DEFAULT_SETTINGS.sync }, remote: { ...DEFAULT_SETTINGS.remote } };
let _loaded = false;
let _watcher: vscode.FileSystemWatcher | null = null;
const _listeners: SettingsListener[] = [];

function _getWorkspace(module: 'qt' | 'cpp' | 'sync' = 'qt'): string | null {
    const root = resolveProjectRoot(module);
    return root || null;
}

/** 从 workspace 路径解析 workroot（用于 workspaceStore 查找） */
function _resolveWorkrootForModule(module: 'qt' | 'cpp'): string | null {
    const ws = _getWorkspace(module);
    if (!ws) { return null; }
    return resolveWorkroot(ws);
}

// ── Build QtSettings from workspaceStore ──

function _buildQtSettings(config: WorkspaceConfig, target: TargetProfile | null): QtSettings {
    const prefs = config.qtModulePrefs;
    const d = DEFAULT_SETTINGS.qt;

    // Only use target if it's a Qt project — prevent cross-type contamination
    const qtTarget = target?.kind === 'qt' ? target : null;

    let pinnedProject: QtSettings['pinnedProject'] = null;
    if (qtTarget && qtTarget.project) {
        pinnedProject = { root: config.workroot, relative: qtTarget.project };
    }

    return {
        mode: qtTarget ? qtTarget.mode : d.mode,
        arch: qtTarget ? qtTarget.arch : d.arch,
        vsInstall: qtTarget?.toolchain.vsInstall ?? d.vsInstall,
        qtPath: qtTarget?.toolchain.qtPath ?? d.qtPath,
        qtVersion: qtTarget?.toolchain.qtVersion ?? d.qtVersion,
        jomPath: qtTarget?.toolchain.jomPath ?? d.jomPath,
        pinnedProject,
        target: qtTarget?.toolchain.qmakeTarget ?? d.target,
        qmakeArgs: prefs.qmakeArgs,
        cStandard: prefs.cStandard,
        cppStandard: prefs.cppStandard,
        designerPath: prefs.designerPath,
        qtSourcePath: prefs.qtSourcePath,
        manualProPath: prefs.manualProPath,
        rccProjectPath: prefs.rccProjectPath,
        scanExcludeDirs: [...prefs.scanExcludeDirs],
        customCommands: prefs.customCommands.map(c => ({ ...c })),
        fileSyncPromptEnabled: prefs.fileSyncPromptEnabled,
        qmakeReminderEnabled: prefs.qmakeReminderEnabled,
        suppressedWarnings: prefs.suppressedWarnings.length > 0 ? [...prefs.suppressedWarnings] : undefined,
    };
}

// ── Build CppSettings from workspaceStore ──

function _buildCppSettings(config: WorkspaceConfig, target: TargetProfile | null): CppSettings {
    const prefs = config.cppModulePrefs;
    const d = DEFAULT_SETTINGS.cpp;

    // Only use target if it's a C++ project — prevent cross-type contamination
    const cppTarget = target?.kind === 'cpp' ? target : null;

    return {
        mode: cppTarget ? cppTarget.mode : d.mode,
        arch: cppTarget ? cppTarget.arch : d.arch,
        vsInstall: cppTarget?.toolchain.vsInstall ?? d.vsInstall,
        pinnedProject: (cppTarget && cppTarget.project) ? cppTarget.project : null,
        scanDepth: prefs.scanDepth,
    };
}

// ── Write Qt setting back to workspaceStore ──

function _saveQtToStore(key: QtKey, value: QtSettings[QtKey]): void {
    const workroot = _resolveWorkrootForModule('qt');
    if (!workroot) { return; }

    const config = loadWorkspaceConfig(workroot);

    // QtModulePrefs fields — workspace-level, saved even without active target
    switch (key) {
        case 'qmakeArgs':
            config.qtModulePrefs.qmakeArgs = value as string;
            saveWorkspaceConfig(config); return;
        case 'cStandard':
            config.qtModulePrefs.cStandard = value as string;
            saveWorkspaceConfig(config); return;
        case 'cppStandard':
            config.qtModulePrefs.cppStandard = value as string;
            saveWorkspaceConfig(config); return;
        case 'designerPath':
            config.qtModulePrefs.designerPath = value as string;
            saveWorkspaceConfig(config); return;
        case 'qtSourcePath':
            config.qtModulePrefs.qtSourcePath = value as string;
            saveWorkspaceConfig(config); return;
        case 'manualProPath':
            config.qtModulePrefs.manualProPath = value as string;
            saveWorkspaceConfig(config); return;
        case 'rccProjectPath':
            config.qtModulePrefs.rccProjectPath = value as string;
            saveWorkspaceConfig(config); return;
        case 'scanExcludeDirs':
            config.qtModulePrefs.scanExcludeDirs = value as string[];
            saveWorkspaceConfig(config); return;
        case 'customCommands':
            config.qtModulePrefs.customCommands = value as QtSettings['customCommands'];
            saveWorkspaceConfig(config); return;
        case 'fileSyncPromptEnabled':
            config.qtModulePrefs.fileSyncPromptEnabled = value as boolean;
            saveWorkspaceConfig(config); return;
        case 'qmakeReminderEnabled':
            config.qtModulePrefs.qmakeReminderEnabled = value as boolean;
            saveWorkspaceConfig(config); return;
        case 'suppressedWarnings':
            config.qtModulePrefs.suppressedWarnings = (value as string[] | undefined) ?? [];
            saveWorkspaceConfig(config); return;
    }

    // Target-specific fields — require active target
    const targetId = config.activeTarget;
    if (!targetId) {
        logger.warn(`Qt setting '${key}' not persisted: no active target`);
        return;
    }

    const target = config.targets[targetId];
    if (!target || target.kind !== 'qt') {
        logger.warn(`Qt setting '${key}' not persisted: active target kind mismatch`);
        return;
    }

    switch (key) {
        case 'mode':
            if (value === 'debug' || value === 'release') { target.mode = value; }
            break;
        case 'arch':
            if (value === 'x86' || value === 'x64') { target.arch = value; }
            break;
        case 'qtPath':
            target.toolchain.qtPath = value as string;
            break;
        case 'qtVersion':
            target.toolchain.qtVersion = value as string;
            break;
        case 'vsInstall':
            target.toolchain.vsInstall = value as string;
            break;
        case 'jomPath':
            target.toolchain.jomPath = value as string;
            break;
        case 'target':
            target.toolchain.qmakeTarget = value as string;
            break;
        case 'pinnedProject': {
            const pp = value as QtSettings['pinnedProject'];
            target.project = pp ? pp.relative : '';
            break;
        }
    }

    saveWorkspaceConfig(config);
}

// ── Write C++ setting back to workspaceStore ──

function _saveCppToStore(key: CppKey, value: CppSettings[CppKey]): void {
    const workroot = _resolveWorkrootForModule('cpp');
    if (!workroot) { return; }

    const config = loadWorkspaceConfig(workroot);
    const targetId = config.activeTarget;
    if (!targetId) {
        logger.warn(`C++ setting '${key}' not persisted: no active target`);
        return;
    }

    const target = config.targets[targetId];
    if (!target || target.kind !== 'cpp') {
        logger.warn(`C++ setting '${key}' not persisted: active target kind mismatch`);
        return;
    }

    switch (key) {
        case 'mode':
            if (value === 'debug' || value === 'release') { target.mode = value; }
            break;
        case 'arch':
            if (value === 'x86' || value === 'x64') { target.arch = value; }
            break;
        case 'vsInstall':
            target.toolchain.vsInstall = value as string;
            break;
        case 'pinnedProject':
            target.project = (value as string | null) ?? '';
            break;
        case 'scanDepth':
            if (typeof value === 'number') { config.cppModulePrefs.scanDepth = value; }
            break;
    }

    saveWorkspaceConfig(config);
}

// ── Load all ──

function _load(): ForjaSettings {
    const qtWorkroot = _resolveWorkrootForModule('qt');
    const cppWorkroot = _resolveWorkrootForModule('cpp');
    const syncWs = _getWorkspace('sync');

    let qt: QtSettings;
    if (qtWorkroot) {
        const config = loadWorkspaceConfig(qtWorkroot);
        const target = getActiveTarget(config);
        qt = _buildQtSettings(config, target);
    } else {
        qt = { ...DEFAULT_SETTINGS.qt };
    }

    let cpp: CppSettings;
    if (cppWorkroot) {
        const config = loadWorkspaceConfig(cppWorkroot);
        const target = getActiveTarget(config);
        cpp = _buildCppSettings(config, target);
    } else {
        cpp = { ...DEFAULT_SETTINGS.cpp };
    }

    return {
        qt,
        cpp,
        sync: syncWs ? loadSyncSettings(syncWs) : { ...DEFAULT_SETTINGS.sync },
        remote: syncWs ? loadRemoteSettings(syncWs) : { ...DEFAULT_SETTINGS.remote },
    };
}

function _saveSync(): void {
    const ws = _getWorkspace('sync');
    if (!ws) { return; }
    saveSyncSettings(ws, _settings.sync);
}

/** 初始化配置存储，加载配置并监听文件变化 */
export function initSettingsStore(context: vscode.ExtensionContext): void {
    _settings = _load();
    _loaded = true;

    // 监听配置文件变化：
    // 1. ~/.forja/projects/ — sync/remote 配置
    const configDir = projectsDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    const projectsPattern = new vscode.RelativePattern(vscode.Uri.file(configDir), '*.json');
    const projectsWatcher = vscode.workspace.createFileSystemWatcher(projectsPattern);
    projectsWatcher.onDidChange(() => _reload());
    projectsWatcher.onDidCreate(() => _reload());
    context.subscriptions.push(projectsWatcher);

    // 2. ~/.forja/workspaces/ — Qt/C++ 配置（workspaceStore）
    const wsDir = workspacesDir();
    if (!fs.existsSync(wsDir)) {
        fs.mkdirSync(wsDir, { recursive: true });
    }
    {
        const wsPattern = new vscode.RelativePattern(vscode.Uri.file(wsDir), '*.json');
        const wsWatcher = vscode.workspace.createFileSystemWatcher(wsPattern);
        wsWatcher.onDidChange(() => _reload());
        wsWatcher.onDidCreate(() => _reload());
        context.subscriptions.push(wsWatcher);
    }

    _watcher = projectsWatcher;

    const qtWs = _getWorkspace('qt');
    const cppWs = _getWorkspace('cpp');
    logger.info(`配置存储已初始化 (qt: ${qtWs || 'none'}, cpp: ${cppWs || 'none'})`);
}

function _reload(): void {
    const oldQt = JSON.stringify(_settings.qt);
    const oldCpp = JSON.stringify(_settings.cpp);
    const oldSync = JSON.stringify(_settings.sync);
    const oldRemote = JSON.stringify(_settings.remote);
    _settings = _load();
    const newQt = JSON.stringify(_settings.qt);
    const newCpp = JSON.stringify(_settings.cpp);
    const newSync = JSON.stringify(_settings.sync);
    const newRemote = JSON.stringify(_settings.remote);
    if (oldQt === newQt && oldCpp === newCpp && oldSync === newSync && oldRemote === newRemote) { return; }

    // 只通知实际有变化的 key
    if (oldQt !== newQt) {
        const oldQtParsed = JSON.parse(oldQt) as QtSettings;
        for (const key of Object.keys(_settings.qt) as QtKey[]) {
            if (JSON.stringify(oldQtParsed[key]) !== JSON.stringify(_settings.qt[key])) {
                _listeners.forEach(fn => fn('qt', key, _settings));
            }
        }
    }
    if (oldCpp !== newCpp) {
        const oldCppParsed = JSON.parse(oldCpp) as CppSettings;
        for (const key of Object.keys(_settings.cpp) as CppKey[]) {
            if (JSON.stringify(oldCppParsed[key]) !== JSON.stringify(_settings.cpp[key])) {
                _listeners.forEach(fn => fn('cpp', key, _settings));
            }
        }
    }
    if (oldSync !== newSync) {
        const oldSyncParsed = JSON.parse(oldSync) as SyncSettings;
        for (const key of Object.keys(_settings.sync) as SyncKey[]) {
            if (JSON.stringify(oldSyncParsed[key]) !== JSON.stringify(_settings.sync[key])) {
                _listeners.forEach(fn => fn('sync', key, _settings));
            }
        }
    }
    if (oldRemote !== newRemote) {
        const oldRemoteParsed = JSON.parse(oldRemote);
        for (const key of Object.keys(_settings.remote)) {
            if (JSON.stringify(oldRemoteParsed[key]) !== JSON.stringify((_settings.remote as unknown as Record<string, unknown>)[key])) {
                _listeners.forEach(fn => fn('remote', key, _settings));
            }
        }
    }
}

// ── Qt API ──

export function getQtSetting<K extends QtKey>(key: K): QtSettings[K] {
    if (!_loaded) { _settings = _load(); _loaded = true; }
    return _settings.qt[key];
}

export function setQtSetting<K extends QtKey>(key: K, value: QtSettings[K]): void {
    if (JSON.stringify(_settings.qt[key]) === JSON.stringify(value)) { return; }
    _settings.qt[key] = value;
    try {
        _saveQtToStore(key, value);
        _listeners.forEach(fn => fn('qt', key, _settings));
    } catch (e) {
        logger.warn(`写入 Qt 配置失败，内存状态已回滚: ${e instanceof Error ? e.message : e}`);
        _settings.qt = _load().qt;
    }
}

// ── C++ API ──

export function getCppSetting<K extends CppKey>(key: K): CppSettings[K] {
    if (!_loaded) { _settings = _load(); _loaded = true; }
    return _settings.cpp[key];
}

export function setCppSetting<K extends CppKey>(key: K, value: CppSettings[K]): void {
    if (JSON.stringify(_settings.cpp[key]) === JSON.stringify(value)) { return; }
    _settings.cpp[key] = value;
    try {
        _saveCppToStore(key, value);
        _listeners.forEach(fn => fn('cpp', key, _settings));
    } catch (e) {
        logger.warn(`写入 C++ 配置失败，内存状态已回滚: ${e instanceof Error ? e.message : e}`);
        _settings.cpp = _load().cpp;
    }
}

// ── Sync API ──

export function getSyncSetting<K extends SyncKey>(key: K): SyncSettings[K] {
    if (!_loaded) { _settings = _load(); _loaded = true; }
    return _settings.sync[key];
}

export function setSyncSetting<K extends SyncKey>(key: K, value: SyncSettings[K]): void {
    if (JSON.stringify(_settings.sync[key]) === JSON.stringify(value)) { return; }
    _settings.sync[key] = value;
    try {
        _saveSync();
        _listeners.forEach(fn => fn('sync', key, _settings));
    } catch (e) {
        logger.warn(`写入 Sync 配置失败，内存状态已回滚: ${e instanceof Error ? e.message : e}`);
        _settings.sync = _load().sync;
    }
}

// ── 通用 API ──

export function getAllSettings(): Readonly<ForjaSettings> {
    if (!_loaded) { _settings = _load(); _loaded = true; }
    return _settings;
}

export function onSettingsChange(listener: SettingsListener): vscode.Disposable {
    _listeners.push(listener);
    return new vscode.Disposable(() => {
        const idx = _listeners.indexOf(listener);
        if (idx >= 0) { _listeners.splice(idx, 1); }
    });
}

// ── 兼容旧接口（过渡期） ──

/** @deprecated 使用 getQtSetting 替代 */
export function getSetting<K extends QtKey>(key: K): QtSettings[K] {
    return getQtSetting(key);
}

/** @deprecated 使用 setQtSetting 替代 */
export function setSetting<K extends QtKey>(key: K, value: QtSettings[K]): void {
    setQtSetting(key, value);
}
