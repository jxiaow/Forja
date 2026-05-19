/**
 * 统一配置存储 — 配置文件位于 .compilot/settings.json
 *
 * 纯 IO 逻辑在 settingsIO.ts 中，本模块负责 vscode 集成（workspace 路径、文件监听）。
 * 对外暴露 Qt / SDK / Sync 三个子模块的读写 API。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';
import { CompilotSettings, QtSettings, SdkSettings, SyncSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from './settingsIO';
import { resolveProjectRoot } from './workspaceResolver';

export type { CompilotSettings, QtSettings, SdkSettings, SyncSettings } from './settingsIO';
export { DEFAULT_SETTINGS, DEFAULT_QT, DEFAULT_SDK, DEFAULT_SYNC, resolveVsDevShellPath, resolveVsDevCmdPath } from './settingsIO';

const logger = createLogger('SettingsStore');

type QtKey = keyof QtSettings;
type SdkKey = keyof SdkSettings;
type SyncKey = keyof SyncSettings;
type SettingsListener = (section: 'qt' | 'sdk' | 'sync', key: string, settings: CompilotSettings) => void;

let _settings: CompilotSettings = { ...DEFAULT_SETTINGS, qt: { ...DEFAULT_SETTINGS.qt }, sdk: { ...DEFAULT_SETTINGS.sdk }, sync: { ...DEFAULT_SETTINGS.sync } };
let _loaded = false;
let _watcher: vscode.FileSystemWatcher | null = null;
const _listeners: SettingsListener[] = [];

function _getWorkspace(): string | null {
    const root = resolveProjectRoot();
    return root || null;
}

function _load(): CompilotSettings {
    const ws = _getWorkspace();
    if (!ws) { return { qt: { ...DEFAULT_SETTINGS.qt }, sdk: { ...DEFAULT_SETTINGS.sdk }, sync: { ...DEFAULT_SETTINGS.sync } }; }
    return loadSettings(ws);
}

function _save(): void {
    const ws = _getWorkspace();
    if (!ws) { return; }
    if (!fs.existsSync(path.join(ws, '.compilot'))) { return; }
    try {
        saveSettings(ws, _settings);
    } catch (e) {
        logger.warn(`写入 settings.json 失败: ${e instanceof Error ? e.message : e}`);
    }
}

/** 初始化配置存储，加载配置并监听文件变化 */
export function initSettingsStore(context: vscode.ExtensionContext): void {
    _settings = _load();
    _loaded = true;

    const ws = _getWorkspace();
    if (ws) {
        const pattern = new vscode.RelativePattern(ws, '.compilot/settings.json');
        _watcher = vscode.workspace.createFileSystemWatcher(pattern);
        _watcher.onDidChange(() => _reload());
        _watcher.onDidCreate(() => _reload());
        context.subscriptions.push(_watcher);
    }

    logger.info(`配置存储已初始化 (root: ${ws || 'none'})`);
}

function _reload(): void {
    const oldSettings = JSON.stringify(_settings);
    _settings = _load();
    const newSettings = JSON.stringify(_settings);
    if (oldSettings === newSettings) { return; }

    // 通知变化
    for (const key of Object.keys(_settings.qt) as QtKey[]) {
        _listeners.forEach(fn => fn('qt', key, _settings));
    }
    for (const key of Object.keys(_settings.sdk) as SdkKey[]) {
        _listeners.forEach(fn => fn('sdk', key, _settings));
    }
    for (const key of Object.keys(_settings.sync) as SyncKey[]) {
        _listeners.forEach(fn => fn('sync', key, _settings));
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
    _save();
    _listeners.forEach(fn => fn('qt', key, _settings));
}

// ── SDK API ──

export function getSdkSetting<K extends SdkKey>(key: K): SdkSettings[K] {
    if (!_loaded) { _settings = _load(); _loaded = true; }
    return _settings.sdk[key];
}

export function setSdkSetting<K extends SdkKey>(key: K, value: SdkSettings[K]): void {
    if (JSON.stringify(_settings.sdk[key]) === JSON.stringify(value)) { return; }
    _settings.sdk[key] = value;
    _save();
    _listeners.forEach(fn => fn('sdk', key, _settings));
}

// ── Sync API ──

export function getSyncSetting<K extends SyncKey>(key: K): SyncSettings[K] {
    if (!_loaded) { _settings = _load(); _loaded = true; }
    return _settings.sync[key];
}

export function setSyncSetting<K extends SyncKey>(key: K, value: SyncSettings[K]): void {
    if (JSON.stringify(_settings.sync[key]) === JSON.stringify(value)) { return; }
    _settings.sync[key] = value;
    _save();
    _listeners.forEach(fn => fn('sync', key, _settings));
}

// ── 通用 API ──

export function getAllSettings(): Readonly<CompilotSettings> {
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
