/**
 * 解析 Qt 项目所在的 workspace folder。
 *
 * 多文件夹工作区中，.qtpilot/ 应该生成在包含 Qt 项目的文件夹下，而非固定 workspaceFolders[0]。
 *
 * 解析优先级：
 * 1. 已有 .qtpilot/settings.json 的文件夹（说明之前已初始化过）
 * 2. 包含 .pro 文件的第一个文件夹
 * 3. fallback 到 workspaceFolders[0]
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let _resolved: string | null = null;

/** 解析并缓存项目根目录 */
export function resolveProjectRoot(): string {
    if (_resolved) { return _resolved; }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return ''; }

    // 单文件夹直接返回
    if (folders.length === 1) {
        _resolved = folders[0].uri.fsPath;
        return _resolved;
    }

    // 多文件夹：优先找已有 .qtpilot/settings.json 的
    for (const folder of folders) {
        const settingsPath = path.join(folder.uri.fsPath, '.qtpilot', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            _resolved = folder.uri.fsPath;
            return _resolved;
        }
    }

    // 其次找包含 .pro 文件的（浅层扫描，只看根目录和一级子目录）
    for (const folder of folders) {
        if (_hasProFile(folder.uri.fsPath)) {
            _resolved = folder.uri.fsPath;
            return _resolved;
        }
    }

    // fallback
    _resolved = folders[0].uri.fsPath;
    return _resolved;
}

/** 当用户选择项目后，更新缓存的项目根目录 */
export function setProjectRoot(root: string): void {
    _resolved = root;
}

/** 重置缓存（用于测试或 workspace 变化时） */
export function resetProjectRoot(): void {
    _resolved = null;
}

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
                } catch {}
            }
        }
    } catch {}
    return false;
}
