/**
 * 自管理配置存储 — 配置文件位于 .compilot/settings.json
 *
 * 纯 IO 逻辑在 settingsIO.ts 中，本模块负责 vscode 集成（workspace 路径、文件监听）。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';
import { CompilotSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from './settingsIO';
import { resolveProjectRoot } from './workspaceResolver';

export type { CompilotSettings } from './settingsIO';
export { DEFAULT_SETTINGS } from './settingsIO';

const logger = createLogger('SettingsStore');

type SettingsKey = keyof CompilotSettings;
type SettingsListener = (key: SettingsKey, settings: CompilotSettings) => void;

let _settings: CompilotSettings = { ...DEFAULT_SETTINGS };
let _loaded = false;
let _watcher: vscode.FileSystemWatcher | null = null;
const _listeners: SettingsListener[] = [];

function _getWorkspace(): string | null {
    const root = resolveProjectRoot();
    return root || null;
}

function _load(): CompilotSettings {
    const ws = _getWorkspace();
    if (!ws) { return { ...DEFAULT_SETTINGS }; }
    return loadSettings(ws);
}

function _save(): void {
    const ws = _getWorkspace();
    if (!ws) { return; }
    // 仅在 .compilot/ 已存在时写入，避免自动创建污染项目
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

    // 监听 .compilot/settings.json 文件变化（外部编辑时重新加载）
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
    const oldSettings = { ..._settings };
    _settings = _load();
    // 通知变化的 key
    for (const key of Object.keys(_settings) as SettingsKey[]) {
        const oldVal = JSON.stringify(oldSettings[key]);
        const newVal = JSON.stringify(_settings[key]);
        if (oldVal !== newVal) {
            _listeners.forEach(fn => fn(key, _settings));
        }
    }
}

// ── 公共 API ──

export function getSetting<K extends SettingsKey>(key: K): CompilotSettings[K] {
    if (!_loaded) {
        _settings = _load();
        _loaded = true;
    }
    return _settings[key];
}

export function setSetting<K extends SettingsKey>(key: K, value: CompilotSettings[K]): void {
    if (JSON.stringify(_settings[key]) === JSON.stringify(value)) { return; }
    _settings[key] = value;
    _save();
    _listeners.forEach(fn => fn(key, _settings));
}

export function onSettingsChange(listener: SettingsListener): vscode.Disposable {
    _listeners.push(listener);
    return new vscode.Disposable(() => {
        const idx = _listeners.indexOf(listener);
        if (idx >= 0) { _listeners.splice(idx, 1); }
    });
}

export function getAllSettings(): Readonly<CompilotSettings> {
    return _settings;
}
