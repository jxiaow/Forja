/**
 * 解析项目所在的 workspace folder。
 *
 * 解析策略（Qt 和 SDK 统一）：
 *   1. 查找 ~/.forja/projects/ 下已有的配置文件，匹配当前 workspaceFolders
 *   2. Sync fallback：单 workspace folder 时直接使用该 folder
 *   3. Qt fallback：浅层扫描找 .pro 文件
 *   4. SDK fallback：等待 sdkExtension 激活后通过 setSdkProjectRoot 设置
 *   5. 未识别到项目 → 返回空字符串
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { listProjectConfigs, projectsDir } from '../core/settingsIO';

export type ModuleType = 'qt' | 'sdk' | 'sync';

let _resolvedQt: string | null = null;
let _resolvedSdk: string | null = null;
let _resolvedSync: string | null = null;
let _watcherRegistered = false;

function _resetResolvedRoots(): void {
    _resolvedQt = null;
    _resolvedSdk = null;
    _resolvedSync = null;
}

/** 注册 workspace folder 变化监听，自动重置缓存 */
export function registerWorkspaceWatcher(context: vscode.ExtensionContext): void {
    if (_watcherRegistered) { return; }
    _watcherRegistered = true;
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => _resetResolvedRoots())
    );

    // 监听 ~/.forja/projects/ 配置文件变化，重置缓存
    const configDir = projectsDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    const pattern = new vscode.RelativePattern(vscode.Uri.file(configDir), '*.json');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(() => _resetResolvedRoots());
    watcher.onDidChange(() => _resetResolvedRoots());
    watcher.onDidDelete(() => _resetResolvedRoots());
    context.subscriptions.push(watcher);
}

/**
 * 解析并缓存项目根目录。
 * @param module 模块类型，默认 'qt'（向后兼容）
 */
export function resolveProjectRoot(module: ModuleType = 'qt'): string {
    if (module === 'sdk') { return _resolveSdk(); }
    if (module === 'sync') { return _resolveSync(); }
    return _resolveQt();
}

/** 当用户选择 Qt 项目后，更新缓存 */
export function setProjectRoot(root: string): void {
    _resolvedQt = root;
}

/** 当 SDK 项目变化后，更新缓存 */
export function setSdkProjectRoot(root: string): void {
    _resolvedSdk = root;
}

/** 重置缓存（用于测试或 workspace 变化时） */
export function resetProjectRoot(): void {
    _resetResolvedRoots();
}

// ── 从已有配置文件反查 workspace ──

/**
 * 在 ~/.forja/projects/ 下查找指定类型的配置文件，
 * 如果其中记录的 workspace 路径匹配当前打开的某个 folder，返回该路径。
 */
function _findFromExistingConfig(type: 'qt' | 'sdk' | 'sync'): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return null; }

    // 构建当前 folders 的 normalized 路径集合（用于快速匹配）
    const folderPaths = new Set(
        folders.map(f => f.uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase())
    );

    const configs = listProjectConfigs();
    for (const config of configs) {
        if (config.type !== type) { continue; }
        const normalized = config.workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        if (folderPaths.has(normalized)) {
            // 找到匹配的配置，返回原始 folder 路径（保持大小写）
            for (const folder of folders) {
                const folderNorm = folder.uri.fsPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
                if (folderNorm === normalized) {
                    return folder.uri.fsPath;
                }
            }
        }
    }
    return null;
}

// ── Qt 解析 ──

function _resolveQt(): string {
    if (_resolvedQt) { return _resolvedQt; }

    // 1. 从已有配置文件反查
    const fromConfig = _findFromExistingConfig('qt');
    if (fromConfig) {
        _resolvedQt = fromConfig;
        return _resolvedQt;
    }

    // 2. Fallback：浅层扫描找 .pro 文件
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return ''; }

    for (const folder of folders) {
        if (_hasProFile(folder.uri.fsPath)) {
            _resolvedQt = folder.uri.fsPath;
            return _resolvedQt;
        }
    }

    // 未识别到 Qt 项目 → 不返回无关目录
    return '';
}

// ── SDK 解析 ──

function _resolveSdk(): string {
    if (_resolvedSdk) { return _resolvedSdk; }

    // 1. 从已有配置文件反查
    const fromConfig = _findFromExistingConfig('sdk');
    if (fromConfig) {
        _resolvedSdk = fromConfig;
        return _resolvedSdk;
    }

    // 2. 不做文件系统扫描，等待 sdkExtension 激活后通过 setSdkProjectRoot 设置
    return '';
}

// ── Sync 解析 ──

function _resolveSync(): string {
    if (_resolvedSync) { return _resolvedSync; }

    // 1. 从已有 sync 配置文件反查
    const fromConfig = _findFromExistingConfig('sync');
    if (fromConfig) {
        _resolvedSync = fromConfig;
        return _resolvedSync;
    }

    // 2. 单 workspace folder 时，sync 作为 workspace 通用能力直接归属该 folder
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length === 1) {
        _resolvedSync = folders[0].uri.fsPath;
        return _resolvedSync;
    }

    return '';
}

// ── 辅助函数 ──

function _hasProFile(dir: string): boolean {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.pro')) {
                return true;
            }
            // 检查一级子目录
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                try {
                    const subEntries = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
                    for (const sub of subEntries) {
                        if (sub.isFile() && sub.name.endsWith('.pro')) {
                            return true;
                        }
                    }
                } catch { /* subdirectory not readable */ }
            }
        }
    } catch { /* directory not readable */ }
    return false;
}
