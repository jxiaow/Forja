/**
 * Git 仓库检测 — 纯文件系统操作，不依赖 vscode。
 * 扩展和 CLI 共用。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 检测目录是否是 git 仓库（.git 目录需含 HEAD，.git 文件视为有效） */
export function isGitRepo(dir: string): boolean {
    const dotGit = path.join(dir, '.git');
    try {
        const stat = fs.statSync(dotGit);
        if (stat.isFile()) { return true; }
        if (stat.isDirectory()) { return fs.existsSync(path.join(dotGit, 'HEAD')); }
    } catch { /* not found or inaccessible */ }
    return false;
}

/**
 * 解析目录下的 git 仓库列表。
 * - 如果目录本身是 git 仓库，返回 [{ dir, name }]
 * - 如果不是，扫描直接子目录中的 git 仓库
 */
export function resolveGitRoots(dir: string): { dir: string; name: string }[] {
    if (isGitRepo(dir)) {
        return [{ dir, name: path.basename(dir) }];
    }
    const results: { dir: string; name: string }[] = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
            const subDir = path.join(dir, entry.name);
            if (isGitRepo(subDir)) {
                results.push({ dir: subDir, name: entry.name });
            }
        }
    } catch { /* directory read failure */ }
    return results;
}
