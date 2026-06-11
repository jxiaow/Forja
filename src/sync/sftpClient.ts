/**
 * SFTP/SCP 同步编排层 — 组合 resolver、transport、serverStore 提供完整同步功能。
 * 依赖 vscode（密码输入弹窗）。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { createLogger } from '../vscode/logger';
import { filterNeedsDelete, filterNeedsSync, markDeletedBatch, markSyncedBatch, SyncTargetContext } from '../core/syncState';
import { ServerConfig } from '../core/serverStore';
import { ResolvedSyncConfig } from './resolver';
import { deleteRemoteFile, scpUpload, ensureRemoteDir, isCancellationError } from './transport';
import { resolveRequestedFilesForGitRoot } from '../core/syncFileSelection';
import { getGitChangedEntries, GitChangedFile, isIgnored } from '../core/gitChangedFiles';

const logger = createLogger('SftpClient');

// ── 密码处理 ──

const _passwordCache: Map<string, string> = new Map();

export async function askPassword(server: ServerConfig): Promise<string | null> {
    const key = `${server.username}@${server.host}`;

    // 缓存
    if (_passwordCache.has(key)) { return _passwordCache.get(key)!; }

    // 从 serverStore 读取
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

// ── 公开接口 ──

export interface SyncResult {
    uploaded: string[];
    deleted: string[];
    skipped: string[];
    failed: { file: string; error: string }[];
}

export async function syncChangedFiles(resolved: ResolvedSyncConfig, workspaceRoot: string, token?: { isCancellationRequested: boolean }, fileFilters: string[] = []): Promise<SyncResult> {
    const { server, remotePath, ignore } = resolved;
    const result: SyncResult = { uploaded: [], deleted: [], skipped: [], failed: [] };

    let password: string | null = null;
    if (server.authMode === 'password') {
        password = await askPassword(server);
        if (!password) {
            throw new Error('未输入密码，取消同步');
        }
    }

    const syncTarget: SyncTargetContext = { serverId: server.id, serverName: server.name, remotePath };

    const changedEntries: GitChangedFile[] = fileFilters.length > 0
        ? resolveRequestedFilesForGitRoot(workspaceRoot, workspaceRoot, fileFilters).map(file => ({ path: file, kind: 'upload', status: '??' }))
        : await getGitChangedEntries(workspaceRoot);
    if (changedEntries.length === 0) { return result; }

    const uploadCandidates: string[] = [];
    const deleteCandidates: string[] = [];
    for (const change of changedEntries) {
        if (isIgnored(change.path, ignore)) { result.skipped.push(change.path); }
        else if (change.kind === 'delete') { deleteCandidates.push(change.path); }
        else { uploadCandidates.push(change.path); }
    }

    const needSync = filterNeedsSync(workspaceRoot, uploadCandidates, syncTarget);
    const needDelete = filterNeedsDelete(workspaceRoot, deleteCandidates, syncTarget);
    const alreadySynced = uploadCandidates.filter(f => !needSync.includes(f));
    result.skipped.push(...alreadySynced);
    result.skipped.push(...deleteCandidates.filter(f => !needDelete.includes(f)));

    if (needSync.length === 0 && needDelete.length === 0) { return result; }

    const remoteDirs = new Set<string>();
    const successFiles: string[] = [];
    const deletedFiles: string[] = [];

    for (const relativePath of needDelete) {
        if (token?.isCancellationRequested) { break; }
        const remoteFile = remotePath.replace(/\/$/, '') + '/' + relativePath.replace(/\\/g, '/');
        try {
            await deleteRemoteFile(server, remoteFile, password, token);
            result.deleted.push(relativePath);
            deletedFiles.push(relativePath);
            logger.info(`已删除远程文件: ${relativePath}`);
        } catch (e) {
            if (isCancellationError(e) || token?.isCancellationRequested) { break; }
            const msg = e instanceof Error ? e.message : String(e);
            result.failed.push({ file: relativePath, error: msg });
            logger.error(`删除远程文件失败: ${relativePath} - ${msg}`);
        }
    }

    for (const relativePath of needSync) {
        if (token?.isCancellationRequested) { break; }
        const localFile = path.join(workspaceRoot, relativePath);
        const remoteFile = remotePath.replace(/\/$/, '') + '/' + relativePath.replace(/\\/g, '/');
        const remoteDir = path.posix.dirname(remoteFile);

        if (!remoteDirs.has(remoteDir)) {
            try {
                await ensureRemoteDir(server, remoteDir, password, token);
                remoteDirs.add(remoteDir);
            } catch (e) {
                const dirErr = e instanceof Error ? e.message : String(e);
                if (isCancellationError(e) || token?.isCancellationRequested) { break; }
                logger.error(`创建远程目录失败: ${remoteDir} - ${dirErr}`);
                result.failed.push({ file: relativePath, error: `mkdir 失败: ${dirErr}` });
                continue;
            }
        }

        try {
            await scpUpload(server, localFile, remoteFile, password, token);
            result.uploaded.push(relativePath);
            successFiles.push(relativePath);
            logger.info(`已上传: ${relativePath}`);
        } catch (e) {
            if (isCancellationError(e) || token?.isCancellationRequested) { break; }
            const msg = e instanceof Error ? e.message : String(e);
            result.failed.push({ file: relativePath, error: msg });
            logger.error(`上传失败: ${relativePath} - ${msg}`);
        }
    }

    if (successFiles.length > 0) {
        markSyncedBatch(workspaceRoot, successFiles, syncTarget);
    }
    if (deletedFiles.length > 0) {
        markDeletedBatch(workspaceRoot, deletedFiles, syncTarget);
    }

    return result;
}
