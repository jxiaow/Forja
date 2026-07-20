/**
 * Shared utility: get list of changed/new files via git.
 * Used by both the VSCode extension (sftpClient) and CLI (syncCli).
 * No vscode dependency.
 */
import * as cp from 'child_process';

export type GitChangeKind = 'upload' | 'delete';

export interface GitChangedFile {
    path: string;
    kind: GitChangeKind;
    status: string;
    previousPath?: string;
}

function pushUnique(changes: GitChangedFile[], next: GitChangedFile): void {
    if (changes.some(change => change.path === next.path && change.kind === next.kind)) { return; }
    changes.push(next);
}

export function parseGitStatusPorcelainZ(output: string): GitChangedFile[] {
    const parts = output.split('\0').filter(part => part.length > 0);
    const changes: GitChangedFile[] = [];

    for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (entry.length < 4) { continue; }

        const status = entry.slice(0, 2);
        const filePath = entry.slice(3);
        const isRename = status.includes('R');

        if (isRename) {
            const previousPath = parts[++i] || '';
            if (previousPath) {
                pushUnique(changes, { path: previousPath, kind: 'delete', status, previousPath });
            }
            pushUnique(changes, { path: filePath, kind: 'upload', status, previousPath: previousPath || undefined });
            continue;
        }

        if (status.includes('D')) {
            pushUnique(changes, { path: filePath, kind: 'delete', status });
        } else {
            pushUnique(changes, { path: filePath, kind: 'upload', status });
        }
    }

    return changes;
}

/**
 * Returns relative file paths that have uncommitted changes or are untracked.
 */
export function getGitChangedEntries(workspaceRoot: string): Promise<GitChangedFile[]> {
    return new Promise((resolve, reject) => {
        const cmd = 'git status --porcelain -z -uall';
        cp.exec(cmd, { cwd: workspaceRoot }, (err, stdout) => {
            if (err) {
                reject(new Error(`git 命令失败: ${err.message}`));
                return;
            }
            resolve(parseGitStatusPorcelainZ(stdout));
        });
    });
}

export async function getGitChangedFiles(workspaceRoot: string): Promise<string[]> {
    const changes = await getGitChangedEntries(workspaceRoot);
    return [...new Set(changes.map(change => change.path))];
}

/**
 * Check if a relative path matches any ignore pattern.
 * Patterns match against individual path segments.
 */
export function isIgnored(relativePath: string, ignoreList: string[]): boolean {
    const parts = relativePath.split(/[\\/]/);
    for (const pattern of ignoreList) {
        const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const wildcardRegex = pattern.includes('*')
            ? new RegExp('^' + escapedPattern.replace(/\*/g, '.*') + '$')
            : null;
        for (const part of parts) {
            if (part === pattern) { return true; }
            if (wildcardRegex?.test(part)) { return true; }
        }
    }
    return false;
}
