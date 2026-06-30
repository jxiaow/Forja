/**
 * 统一配置存储 — 配置文件位于 ~/.forja/projects/
 *
 * 纯 IO 逻辑在 settingsIO.ts 中，本模块负责 vscode 集成（workspace 路径、文件监听）。
 * 对外暴露 Qt / SDK / Sync 三个子模块的读写 API。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { createLogger } from './logger';
import { ForjaSettings, QtSettings, SdkSettings, SyncSettings, DEFAULT_SETTINGS, loadQtSettings, loadSdkSettings, loadSyncSettings, loadRemoteSettings, saveQtSettings, saveSdkSettings, saveSyncSettings, projectsDir } from '../core/settingsIO';
import { resolveProjectRoot } from './workspaceResolver';

export type { ForjaSettings, QtSettings, SdkSettings, SyncSettings } from '../core/settingsIO';
export { DEFAULT_SETTINGS, DEFAULT_QT, DEFAULT_SDK, DEFAULT_SYNC, resolveVsDevShellPath, resolveVsDevCmdPath } from '../core/settingsIO';

const logger = createLogger('SettingsStore');

type QtKey = keyof QtSettings;
type SdkKey = keyof SdkSettings;
type SyncKey = keyof SyncSettings;
type SettingsListener = (section: 'qt' | 'sdk' | 'sync' | 'remote', key: string, settings: ForjaSettings) => void;

let _settings: ForjaSettings = { ...DEFAULT_SETTINGS, qt: { ...DEFAULT_SETTINGS.qt }, sdk: { ...DEFAULT_SETTINGS.sdk }, sync: { ...DEFAULT_SETTINGS.sync }, remote: { ...DEFAULT_SETTINGS.remote } };
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
        sync: syncWs ? loadSyncSettings(syncWs) : { ...DEFAULT_SETTINGS.sync },
        remote: syncWs ? loadRemoteSettings(syncWs) : { ...DEFAULT_SETTINGS.remote }
    };
}

function _saveQt(): void {
    const ws = _getWorkspace('qt');
    if (!ws) { return; }
    saveQtSettings(ws, _settings.qt);
}

function _saveSdk(): void {
    const ws = _getWorkspace('sdk');
    if (!ws) { return; }
    saveSdkSettings(ws, _settings.sdk);
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
    const oldQt = JSON.stringify(_settings.qt);
    const oldSdk = JSON.stringify(_settings.sdk);
    const oldSync = JSON.stringify(_settings.sync);
    const oldRemote = JSON.stringify(_settings.remote);
    _settings = _load();
    const newQt = JSON.stringify(_settings.qt);
    const newSdk = JSON.stringify(_settings.sdk);
    const newSync = JSON.stringify(_settings.sync);
    const newRemote = JSON.stringify(_settings.remote);
    if (oldQt === newQt && oldSdk === newSdk && oldSync === newSync && oldRemote === newRemote) { return; }

    // 只通知实际有变化的 key
    if (oldQt !== newQt) {
        const oldQtParsed = JSON.parse(oldQt) as QtSettings;
        for (const key of Object.keys(_settings.qt) as QtKey[]) {
            if (JSON.stringify(oldQtParsed[key]) !== JSON.stringify(_settings.qt[key])) {
                _listeners.forEach(fn => fn('qt', key, _settings));
            }
        }
    }
    if (oldSdk !== newSdk) {
        const oldSdkParsed = JSON.parse(oldSdk) as SdkSettings;
        for (const key of Object.keys(_settings.sdk) as SdkKey[]) {
            if (JSON.stringify(oldSdkParsed[key]) !== JSON.stringify(_settings.sdk[key])) {
                _listeners.forEach(fn => fn('sdk', key, _settings));
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
        _saveQt();
        _listeners.forEach(fn => fn('qt', key, _settings));
    } catch (e) {
        logger.warn(`写入 Qt 配置失败，内存状态已回滚: ${e instanceof Error ? e.message : e}`);
        _settings.qt = _load().qt;
    }
}

// ── SDK API ──

export function getSdkSetting<K extends SdkKey>(key: K): SdkSettings[K] {
    if (!_loaded) { _settings = _load(); _loaded = true; }
    return _settings.sdk[key];
}

export function setSdkSetting<K extends SdkKey>(key: K, value: SdkSettings[K]): void {
    if (JSON.stringify(_settings.sdk[key]) === JSON.stringify(value)) { return; }
    _settings.sdk[key] = value;
    try {
        _saveSdk();
        _listeners.forEach(fn => fn('sdk', key, _settings));
    } catch (e) {
        logger.warn(`写入 SDK 配置失败，内存状态已回滚: ${e instanceof Error ? e.message : e}`);
        _settings.sdk = _load().sdk;
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
