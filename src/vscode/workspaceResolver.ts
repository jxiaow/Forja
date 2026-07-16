/**
 * 解析项目所在的 workspace folder。
 *
 * 新模型：从 workspaces.json 注册表匹配 VSCode workspace folders 到已注册 workroot。
 *
 * 解析策略：
 *   1. 读取 ~/.forja/workspaces.json 获取已注册 workroot 列表
 *   2. 对每个 VSCode workspace folder，查找匹配的 workroot（前缀匹配）
 *   3. 多 root workspace：每个 folder 独立关联 workroot，通过 active folder 决定当前操作
 *   4. 未匹配 → 返回空字符串
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { loadWorkspacesRegistry, normalizePath, workspacesRegistryPath } from '../core/workspaceStore';
import { forjaConfigDir } from '../core/settingsIO';

export type ModuleType = 'qt' | 'cpp' | 'sync';

let _resolvedQt: string | null = null;
let _resolvedCpp: string | null = null;
let _resolvedSync: string | null = null;
let _watcherRegistered = false;

function _resetResolvedRoots(): void {
    _resolvedQt = null;
    _resolvedCpp = null;
    _resolvedSync = null;
}

/** 注册 workspace folder 变化监听，自动重置缓存 */
export function registerWorkspaceWatcher(context: vscode.ExtensionContext): void {
    if (_watcherRegistered) { return; }
    _watcherRegistered = true;
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => _resetResolvedRoots())
    );

    // 监听 workspaces.json 变化，重置缓存
    const registryPath = workspacesRegistryPath();
    const configDir = forjaConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    const pattern = new vscode.RelativePattern(vscode.Uri.file(configDir), 'workspaces.json');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(() => _resetResolvedRoots());
    watcher.onDidChange(() => _resetResolvedRoots());
    watcher.onDidDelete(() => _resetResolvedRoots());
    context.subscriptions.push(watcher);
}

/**
 * 解析并缓存项目根目录。
 * 新模型下所有模块类型使用相同的 workroot 解析逻辑。
 * @param module 模块类型（保留参数以兼容调用方，实际不再区分）
 */
export function resolveProjectRoot(module: ModuleType = 'qt'): string {
    if (module === 'cpp') { return _resolveFromRegistry('cpp'); }
    if (module === 'sync') { return _resolveFromRegistry('sync'); }
    return _resolveFromRegistry('qt');
}

/** 当用户选择 Qt 项目后，更新缓存 */
export function setProjectRoot(root: string): void {
    _resolvedQt = root;
}

/** 当 C++ 项目变化后，更新缓存 */
export function setCppProjectRoot(root: string): void {
    _resolvedCpp = root;
}

/** 重置缓存（用于测试或 workspace 变化时） */
export function resetProjectRoot(): void {
    _resetResolvedRoots();
}

// ── 从 workspaces.json 注册表匹配 ──

function _resolveFromRegistry(_module: ModuleType): string {
    const cacheKey = _module === 'cpp' ? '_resolvedCpp' : _module === 'sync' ? '_resolvedSync' : '_resolvedQt';
    const cached = cacheKey === '_resolvedCpp' ? _resolvedCpp : cacheKey === '_resolvedSync' ? _resolvedSync : _resolvedQt;
    if (cached) { return cached; }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return ''; }

    const registry = loadWorkspacesRegistry();
    if (registry.workroots.length === 0) { return ''; }

    // 对每个 folder，查找匹配的 workroot（最深前缀匹配）
    for (const folder of folders) {
        const folderNorm = normalizePath(folder.uri.fsPath);
        let bestMatch: string | null = null;
        let bestLen = -1;

        for (const wr of registry.workroots) {
            const wrNorm = normalizePath(wr);
            if (folderNorm === wrNorm || folderNorm.startsWith(wrNorm + '/')) {
                if (wrNorm.length > bestLen) {
                    bestLen = wrNorm.length;
                    bestMatch = wr;
                }
            }
        }

        if (bestMatch) {
            // 返回原始 folder 路径（保持大小写）
            const result = folder.uri.fsPath;
            if (cacheKey === '_resolvedCpp') { _resolvedCpp = result; }
            else if (cacheKey === '_resolvedSync') { _resolvedSync = result; }
            else { _resolvedQt = result; }
            return result;
        }
    }

    return '';
}
