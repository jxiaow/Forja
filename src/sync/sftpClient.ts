/**
 * SFTP/SCP 同步编排层 — 组合 resolver、transport、serverStore 提供完整同步功能。
 * 依赖 vscode（密码输入弹窗）。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { createLogger } from '../core/logger';
import { filterNeedsSync, markSyncedBatch } from './syncState';
import { ServerConfig } from './serverStore';
import { ResolvedSyncConfig } from './resolver';
import { scpUpload, ensureRemoteDir } from './transport';
import { testConnection } from './transport';

const logger = createLogger('SftpClient');

// ── Re-exports（保持现有消费者不变） ──

export { ServerConfig, ProjectSyncConfig } from './serverStore';
export { readServers, readProjectSyncConfig, writeProjectSyncConfig, getServerByName } from './serverStore';
export { addServer, removeServer, writeServers, updateProjectSyncField } from './serverStore';
export { ResolvedSyncConfig, getResolvedConfig } from './resolver';
export { testConnection } from './transport';

// ── 密码处理 ──

const _passwordCache: Map<string, string> = new Map();

export async function askPassword(server: ServerConfig): Promise<string | null> {
    const key = `${server.username}@${server.host}`;

    // 缓存
    if (_passwordCache.has(key)) { return _passwordCache.get(key)!; }

    // 从 serverStore 读取（已解密）
    if (server.password) {
        _passwordCache.set(key, server.password);
        return server.password;
    }

    // 弹窗输入
    const pwd = await vscode.window.showInputBox({
        prompt: `输入 ${key} 的密码`,
        password: true,
        ignoreFocusOut: true
    });
    if (pwd) { _passwordCache.set(key, pwd); }
    return pwd ?? null;
}

export function clearPasswordCache(): void {
    _passwordCache.clear();
}

// ── Git diff ──

export function getGitChangedFiles(workspaceRoot: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const isWin = process.platform === 'win32';
        const sep = isWin ? ' & ' : ' ; ';
        const cmd = `git diff --name-only HEAD${sep}git diff --name-only --cached${sep}git ls-files --others --exclude-standard`;
        cp.exec(cmd, { cwd: workspaceRoot }, (err, stdout) => {
            if (err) {
                cp.exec('git status --porcelain -uall', { cwd: workspaceRoot }, (err2, stdout2) => {
                    if (err2) {
                        reject(new Error(`git 命令失败: ${err2.message}`));
                        return;
                    }
                    const files = stdout2.trim().split('\n')
                        .filter(line => line.length > 3)
                        .map(line => line.substring(3).trim())
                        .filter(f => f.length > 0);
                    resolve([...new Set(files)]);
                });
                return;
            }
            const files = stdout.trim().split('\n')
                .map(f => f.trim())
                .filter(f => f.length > 0);
            resolve([...new Set(files)]);
        });
    });
}

// ── 忽略判断 ──

function isIgnored(relativePath: string, ignoreList: string[]): boolean {
    const parts = relativePath.split(/[\\/]/);
    for (const pattern of ignoreList) {
        for (const part of parts) {
            if (part === pattern) { return true; }
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                if (regex.test(part)) { return true; }
            }
        }
    }
    return false;
}

// ── 公开接口 ──

export interface SyncResult {
    uploaded: string[];
    skipped: string[];
    failed: { file: string; error: string }[];
}

export async function syncChangedFiles(resolved: ResolvedSyncConfig, workspaceRoot: string): Promise<SyncResult> {
    const { server, remotePath, ignore } = resolved;
    const result: SyncResult = { uploaded: [], skipped: [], failed: [] };

    let password: string | null = null;
    if (server.authMode === 'password') {
        password = await askPassword(server);
        if (!password) {
            throw new Error('未输入密码，取消同步');
        }
    }

    const changedFiles = await getGitChangedFiles(workspaceRoot);
    if (changedFiles.length === 0) { return result; }

    const notIgnored: string[] = [];
    for (const f of changedFiles) {
        if (isIgnored(f, ignore)) { result.skipped.push(f); }
        else { notIgnored.push(f); }
    }

    const needSync = filterNeedsSync(workspaceRoot, notIgnored);
    const alreadySynced = notIgnored.filter(f => !needSync.includes(f));
    result.skipped.push(...alreadySynced);

    if (needSync.length === 0) { return result; }

    const remoteDirs = new Set<string>();
    const successFiles: string[] = [];

    for (const relativePath of needSync) {
        const localFile = path.join(workspaceRoot, relativePath);
        const remoteFile = remotePath.replace(/\/$/, '') + '/' + relativePath.replace(/\\/g, '/');
        const remoteDir = path.posix.dirname(remoteFile);

        if (!remoteDirs.has(remoteDir)) {
            await ensureRemoteDir(server, remoteDir, password);
            remoteDirs.add(remoteDir);
        }

        try {
            await scpUpload(server, localFile, remoteFile, password);
            result.uploaded.push(relativePath);
            successFiles.push(relativePath);
            logger.info(`已上传: ${relativePath}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            result.failed.push({ file: relativePath, error: msg });
            logger.error(`上传失败: ${relativePath} - ${msg}`);
        }
    }

    if (successFiles.length > 0) {
        markSyncedBatch(workspaceRoot, successFiles);
    }

    return result;
}
