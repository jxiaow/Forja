/**
 * 统一配置存储 — 配置文件位于 ~/.forja/projects/
 *
 * 纯 IO 逻辑在 settingsIO.ts 中，本模块负责 vscode 集成（workspace 路径、文件监听）。
 * 对外暴露 Qt / SDK / Sync 三个子模块的读写 API。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { createLogger } from './logger';
import { ForjaSettings, QtSettings, SdkSettings, SyncSettings, DEFAULT_SETTINGS, loadQtSettings, loadSdkSettings, loadSyncSettings, saveQtSettings, saveSdkSettings, saveSyncSettings, projectsDir } from '../core/settingsIO';
import { resolveProjectRoot } from './workspaceResolver';

export type { ForjaSettings, QtSettings, SdkSettings, SyncSettings } from '../core/settingsIO';
export { DEFAULT_SETTINGS, DEFAULT_QT, DEFAULT_SDK, DEFAULT_SYNC, resolveVsDevShellPath, resolveVsDevCmdPath } from '../core/settingsIO';

const logger = createLogger('SettingsStore');

type QtKey = keyof QtSettings;
type SdkKey = keyof SdkSettings;
type SyncKey = keyof SyncSettings;
type SettingsListener = (section: 'qt' | 'sdk' | 'sync', key: string, settings: ForjaSettings) => void;

let _settings: ForjaSettings = { ...DEFAULT_SETTINGS, qt: { ...DEFAULT_SETTINGS.qt }, sdk: { ...DEFAULT_SETTINGS.sdk }, sync: { ...DEFAULT_SETTINGS.sync } };
let _loaded = false;
let _watcher: vscode.FileSystemWatcher | null = null;
const _listeners: SettingsListener[] = [];

function _getWorkspace(module: 'qt' | 'sdk' | 'sync' = 'qt'): string | null {
    const root = resolveProjectRoot(module);
    return root || null;
}

function _load(): ForjaSettings {
    const qtWs = _getWorkspace('qt');
    const sdkWs = _getWorkspace('sdk');
    const syncWs = _getWorkspace('sync');
    return {
        qt: qtWs ? loadQtSettings(qtWs) : { ...DEFAULT_SETTINGS.qt },
        sdk: sdkWs ? loadSdkSettings(sdkWs) : { ...DEFAULT_SETTINGS.sdk },
        sync: syncWs ? loadSyncSettings(syncWs) : { ...DEFAULT_SETTINGS.sync }
    };
}

function _saveQt(): void {
    const ws = _getWorkspace('qt');
    if (!ws) { return; }
    try { saveQtSettings(ws, _settings.qt); }
    catch (e) { logger.warn(`写入 Qt 配置失败: ${e instanceof Error ? e.message : e}`); }
}

function _saveSdk(): void {
    const ws = _getWorkspace('sdk');
    if (!ws) { return; }
    try { saveSdkSettings(ws, _settings.sdk); }
    catch (e) { logger.warn(`写入 SDK 配置失败: ${e instanceof Error ? e.message : e}`); }
}

function _saveSync(): void {
    const ws = _getWorkspace('sync');
    if (!ws) { return; }
    try { saveSyncSettings(ws, _settings.sync); }
    catch (e) { logger.warn(`写入 Sync 配置失败: ${e instanceof Error ? e.message : e}`); }
}

/** 初始化配置存储，加载配置并监听文件变化 */
export function initSettingsStore(context: vscode.ExtensionContext): void {
    _settings = _load();
    _loaded = true;

    // 监听 ~/.forja/projects/ 目录下的配置文件变化
    const configDir = projectsDir();
    // 确保目录存在，否则 watcher 无法注册，首次写入不会触发 reload
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    const pattern = new vscode.RelativePattern(vscode.Uri.file(configDir), '*.json');
    _watcher = vscode.workspace.createFileSystemWatcher(pattern);
    _watcher.onDidChange(() => _reload());
    _watcher.onDidCreate(() => _reload());
    context.subscriptions.push(_watcher);

    const qtWs = _getWorkspace('qt');
    const sdkWs = _getWorkspace('sdk');
    logger.info(`配置存储已初始化 (qt: ${qtWs || 'none'}, sdk: ${sdkWs || 'none'})`);
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
    _saveQt();
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
    _saveSdk();
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
    _saveSync();
    _listeners.forEach(fn => fn('sync', key, _settings));
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
