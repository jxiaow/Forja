/**
 * CLI-compatible sync module — no vscode dependency.
 * Reads config from ~/.forja/servers.json and ~/.forja/projects/<hash>.json (type=sync)
 */
import * as path from 'path';
import * as fs from 'fs';
import { clearSyncState, filterNeedsDelete, filterNeedsSync, markDeletedBatch, markSyncedBatch, SyncTargetContext } from '../core/syncState';
import { readProjectSyncConfig, writeProjectSyncConfig, resolveServerSelector, ServerConfig } from '../core/serverStore';
import { loadRemoteSettings, saveRemoteSettings } from '../core/settingsIO';
import { deleteRemoteFile, ensureRemoteDir, scpUpload } from '../core/sshTransport';
import { resolveGitRoots } from '../core/gitRepoResolver';
import { resolveRequestedFilesForGitRoot } from '../core/syncFileSelection';
import { getGitChangedEntries, GitChangedFile, isIgnored } from '../core/gitChangedFiles';
import { T } from '../cli/commands/types';

export interface SyncEngineResult {
    ok: boolean;
    uploaded: string[];
    deleted: string[];
    skipped: string[];
    skippedDetails?: { file: string; reason: string }[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
    nextAction?: string;
}

export interface SyncPlanResult {
    ok: boolean;
    action: 'sync';
    mode: 'dryRun';
    pending: string[];
    deleted: string[];
    skipped: string[];
    skippedDetails: { file: string; reason: string }[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
    repos: string[];
    nextAction?: string;
}

type GitRoot = ReturnType<typeof resolveGitRoots>[number];

export { isIgnored };

interface ResolvedServer {
    server: ServerConfig | null;
    error?: string;
}

function resolveCliServer(selector: string): ResolvedServer {
    const resolved = resolveServerSelector(selector);
    if (resolved.ambiguous) {
        return { server: null, error: `${T('sync.serverNotFound')}: "${selector}" (${T('sync.ambiguous')})` };
    }
    if (!resolved.server) {
        return { server: null, error: `${T('sync.serverNotFound')}: "${selector}"` };
    }
    return { server: resolved.server };
}

// ── 密码解析（CLI 侧） ──

async function resolveCliPassword(server: ServerConfig): Promise<string | null> {
    const envPwd = process.env.FORJA_SSH_PASSWORD;
    if (envPwd) { return envPwd; }

    if (server.password) { return server.password; }

    if (process.stdin.isTTY) {
        return new Promise((resolve) => {
            const readline = require('readline') as typeof import('readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
            rl.question(`${T('sync.passwordPrompt')} ${server.username}@${server.host}: `, (answer: string) => {
                rl.close();
                resolve(answer || null);
            });
        });
    }

    return null;
}

// ── 配置解析 ──

interface ResolvedSyncConfig {
    server: ServerConfig;
    remotePath: string;
    ignore: string[];
}

function resolveSyncConfig(workspaceRoot: string): { ok: true; config: ResolvedSyncConfig } | { ok: false; error: string; nextAction?: string } {
    const project = readProjectSyncConfig(workspaceRoot);

    if (!project.enabled) {
        return { ok: false, error: T('sync.notConfigured') };
    }

    const remote = loadRemoteSettings(workspaceRoot);
    const targetId = remote.selectedServer;
    if (!targetId) {
        return { ok: false, error: T('sync.notConfigured') };
    }

    const resolvedServer = resolveCliServer(targetId);
    const server = resolvedServer.server;
    if (!server) {
        return { ok: false, error: resolvedServer.error || `${T('sync.serverNotFound')}: "${targetId}"` };
    }

    const remotePath = remote.remotePaths[server.id] || '';
    if (!remotePath) {
        return { ok: false, error: T('sync.noRemotePath'), nextAction: `forja sync` };
    }

    return { ok: true, config: { server, remotePath, ignore: project.ignore } };
}

// ── 共享文件分类（plan 和 execute 共用） ──

export interface ClassifiedChanges {
    pending: string[];
    deleted: string[];
    skipped: string[];
    skippedDetails: { file: string; reason: string }[];
    gitRoots: GitRoot[];
    requestedFilesNotFound: boolean;
}

async function classifyAllGitRoots(
    workspaceRoot: string,
    fileFilters: string[],
    server: ServerConfig,
    remotePath: string,
    ignore: string[],
): Promise<ClassifiedChanges> {
    const gitRoots = resolveGitRoots(workspaceRoot);
    const result: ClassifiedChanges = {
        pending: [], deleted: [], skipped: [], skippedDetails: [],
        gitRoots, requestedFilesNotFound: false,
    };

    for (const gitRoot of gitRoots) {
        const { dir: gitDir, name: gitName } = gitRoot;
        const repoRemotePath = remotePath.replace(/\/$/, '') + '/' + gitName;
        const syncTarget: SyncTargetContext = { serverId: server.id, serverName: server.name, remotePath: repoRemotePath };

        const changedEntries: GitChangedFile[] = fileFilters.length > 0
            ? resolveRequestedFilesForGitRoot(gitDir, workspaceRoot, fileFilters).map(file => {
                const fullPath = path.join(gitDir, file);
                const exists = fs.existsSync(fullPath);
                return { path: file, kind: exists ? 'upload' as const : 'delete' as const, status: exists ? '??' : 'D' };
            })
            : await getGitChangedEntries(gitDir);

        if (changedEntries.length === 0) { continue; }

        const uploadCandidates: string[] = [];
        const deleteCandidates: string[] = [];
        for (const change of changedEntries) {
            if (isIgnored(change.path, ignore)) {
                const file = `${gitName}/${change.path}`;
                result.skipped.push(file);
                result.skippedDetails.push({ file, reason: 'ignored' });
            }
            else if (change.kind === 'delete') { deleteCandidates.push(change.path); }
            else { uploadCandidates.push(change.path); }
        }

        const needSync = filterNeedsSync(gitDir, uploadCandidates, syncTarget);
        const needDelete = filterNeedsDelete(gitDir, deleteCandidates, syncTarget);
        for (const f of uploadCandidates.filter(f => !needSync.includes(f))) {
            const file = `${gitName}/${f}`;
            result.skipped.push(file);
            result.skippedDetails.push({ file, reason: 'alreadySynced' });
        }
        for (const f of deleteCandidates.filter(f => !needDelete.includes(f))) {
            const file = `${gitName}/${f}`;
            result.skipped.push(file);
            result.skippedDetails.push({ file, reason: 'alreadyDeleted' });
        }
        result.pending.push(...needSync.map(f => `${gitName}/${f}`));
        result.deleted.push(...needDelete.map(f => `${gitName}/${f}`));
    }

    if (fileFilters.length > 0) {
        const allResolved = new Set<string>([...result.pending, ...result.deleted,
            ...result.skipped.filter(s => result.skippedDetails.find(d => d.file === s)?.reason !== 'ignored')]);
        if (allResolved.size === 0) {
            result.requestedFilesNotFound = true;
        }
    }

    return result;
}

// ── 配置保存（供 handleSync 调用） ──

export interface ConfigureSyncOptions {
    serverId: string;
    remotePath?: string;
    enable?: boolean;
}

export function configureSyncSettings(workspaceRoot: string, options: ConfigureSyncOptions): { ok: true } | { ok: false; error: string } {
    // Update sync enabled state
    const sync = readProjectSyncConfig(workspaceRoot);
    if (options.enable !== false) {
        sync.enabled = true;
    }
    try {
        writeProjectSyncConfig(workspaceRoot, {
            enabled: sync.enabled,
        });
        // Update remote selectedServer and remotePath
        const remote = loadRemoteSettings(workspaceRoot);
        remote.selectedServer = options.serverId;
        if (options.remotePath) {
            remote.remotePaths[options.serverId] = options.remotePath;
        }
        saveRemoteSettings(workspaceRoot, remote);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// ── 主入口 ──

export async function executeSyncCli(workspaceRoot: string, fileFilters: string[] = [], preComputed?: ClassifiedChanges): Promise<SyncEngineResult> {
    const resolved = resolveSyncConfig(workspaceRoot);
    if (!resolved.ok) {
        return { ok: false, uploaded: [], deleted: [], skipped: [], failed: [{ file: '', error: resolved.error }], server: '', remotePath: '', nextAction: resolved.nextAction };
    }

    const { server, remotePath, ignore } = resolved.config;

    let resolvedPassword: string | null = null;
    if (server.authMode === 'password') {
        resolvedPassword = await resolveCliPassword(server);
        if (!resolvedPassword) {
            return { ok: false, uploaded: [], deleted: [], skipped: [], failed: [{ file: '', error: T('sync.passwordRequired') }], server: server.name, remotePath, nextAction: 'FORJA_SSH_PASSWORD=<password> forja sync' };
        }
    }

    const classified = preComputed ?? await classifyAllGitRoots(workspaceRoot, fileFilters, server, remotePath, ignore);

    if (classified.gitRoots.length === 0) {
        return { ok: false, uploaded: [], deleted: [], skipped: [], failed: [{ file: '', error: `${T('sync.noGitRepos')}: ${workspaceRoot}` }], server: server.name, remotePath, nextAction: 'forja status --json' };
    }

    if (classified.requestedFilesNotFound) {
        return { ok: false, uploaded: [], deleted: [], skipped: [], failed: [{ file: '', error: `${T('sync.filesNotFound')}: ${fileFilters.join(', ')}` }], server: server.name, remotePath, nextAction: 'forja sync --file <path>' };
    }

    const result: SyncEngineResult = { ok: true, uploaded: [], deleted: [], skipped: classified.skipped, skippedDetails: classified.skippedDetails, failed: [], server: server.name, remotePath };

    for (const gitRoot of classified.gitRoots) {
        const { dir: gitDir, name: gitName } = gitRoot;
        const repoRemotePath = remotePath.replace(/\/$/, '') + '/' + gitName;
        const syncTarget: SyncTargetContext = { serverId: server.id, serverName: server.name, remotePath: repoRemotePath };

        const needSync = classified.pending.filter(f => f.startsWith(`${gitName}/`)).map(f => f.slice(gitName.length + 1));
        const needDelete = classified.deleted.filter(f => f.startsWith(`${gitName}/`)).map(f => f.slice(gitName.length + 1));

        if (needSync.length === 0 && needDelete.length === 0) { continue; }

        const remoteDirs = new Set<string>();
        const successFiles: string[] = [];
        const deletedFiles: string[] = [];

        for (const relativePath of needDelete) {
            const remoteFile = repoRemotePath + '/' + relativePath.replace(/\\/g, '/');
            try {
                await deleteRemoteFile(server, remoteFile, resolvedPassword);
                result.deleted.push(`${gitName}/${relativePath}`);
                deletedFiles.push(relativePath);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                result.failed.push({ file: `${gitName}/${relativePath}`, error: msg });
            }
        }

        for (const relativePath of needSync) {
            const localFile = path.join(gitDir, relativePath);
            const remoteFile = repoRemotePath + '/' + relativePath.replace(/\\/g, '/');
            const remoteDir = path.posix.dirname(remoteFile);

            if (!remoteDirs.has(remoteDir)) {
                try {
                    await ensureRemoteDir(server, remoteDir, resolvedPassword);
                    remoteDirs.add(remoteDir);
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    result.failed.push({ file: `${gitName}/${relativePath}`, error: `${T('sync.createRemoteDirFailed')}: ${msg}` });
                    continue;
                }
            }

            try {
                await scpUpload(server, localFile, remoteFile, resolvedPassword);
                result.uploaded.push(`${gitName}/${relativePath}`);
                successFiles.push(relativePath);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                result.failed.push({ file: `${gitName}/${relativePath}`, error: msg });
            }
        }

        if (successFiles.length > 0) {
            markSyncedBatch(gitDir, successFiles, syncTarget);
        }
        if (deletedFiles.length > 0) {
            markDeletedBatch(gitDir, deletedFiles, syncTarget);
        }
    }

    result.ok = result.failed.length === 0;
    return result;
}

export async function planSyncCli(workspaceRoot: string, fileFilters: string[] = []): Promise<SyncPlanResult> {
    const resolved = resolveSyncConfig(workspaceRoot);
    const empty = (error: string, nextAction?: string, server = '', remotePath = ''): SyncPlanResult => ({
        ok: false,
        action: 'sync',
        mode: 'dryRun',
        pending: [],
        deleted: [],
        skipped: [],
        skippedDetails: [],
        failed: [{ file: '', error }],
        server,
        remotePath,
        repos: [],
        nextAction,
    });

    if (!resolved.ok) {
        return empty(resolved.error, resolved.nextAction);
    }

    const { server, remotePath, ignore } = resolved.config;

    const classified = await classifyAllGitRoots(workspaceRoot, fileFilters, server, remotePath, ignore);

    if (classified.gitRoots.length === 0) {
        return empty(`${T('sync.noGitRepos')}: ${workspaceRoot}`, 'forja status --json', server.name, remotePath);
    }

    if (classified.requestedFilesNotFound) {
        return empty(`${T('sync.filesNotFound')}: ${fileFilters.join(', ')}`, 'forja sync --file <path>', server.name, remotePath);
    }

    return {
        ok: true,
        action: 'sync',
        mode: 'dryRun',
        pending: classified.pending,
        deleted: classified.deleted,
        skipped: classified.skipped,
        skippedDetails: classified.skippedDetails,
        failed: [],
        server: server.name,
        remotePath,
        repos: classified.gitRoots.map(r => r.name),
        nextAction: 'forja sync --json',
    };
}

export function resetSyncCli(workspaceRoot: string): { ok: boolean; diagnostics: { level: 'info' | 'warning' | 'error'; message: string }[]; nextAction?: string } {
    clearSyncState(workspaceRoot);
    return {
        ok: true,
        diagnostics: [{ level: 'info', message: T('sync.resetDone') }],
        nextAction: 'forja sync plan --json'
    };
}
