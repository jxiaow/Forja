/**
 * CLI-compatible sync module — no vscode dependency.
 * Reads config from ~/.forja/servers.json and ~/.forja/projects/<hash>.json (type=sync)
 */
import * as path from 'path';
import * as cp from 'child_process';
import { clearSyncState, filterNeedsSync, markSyncedBatch, SyncTargetContext } from '../core/syncState';
import { addServer, readProjectSyncConfig, getServerById, readServers, removeServer, ServerConfig, updateServer, writeProjectSyncConfig } from '../core/serverStore';
import { ensureRemoteDir, scpUpload, testConnection } from '../core/sshTransport';
import { resolveGitRoots } from '../core/gitRepoResolver';
import { resolveRequestedFilesForGitRoot } from '../core/syncFileSelection';

export interface SyncResult {
    ok: boolean;
    uploaded: string[];
    skipped: string[];
    skippedDetails?: { file: string; reason: string }[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
    nextActions?: string[];
}

export interface SyncPlanResult {
    ok: boolean;
    action: 'sync';
    mode: 'dryRun';
    pending: string[];
    skipped: string[];
    skippedDetails: { file: string; reason: string }[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
    repos: string[];
    nextAction?: string;
    nextActions: string[];
}

export interface SyncStatusResult {
    ok: boolean;
    action: 'status';
    ready: boolean;
    checks: {
        enabled: boolean;
        servers: boolean;
        selectedServer: boolean;
        serverExists: boolean;
        remotePath: boolean;
    };
    missing: string[];
    server: Pick<ServerConfig, 'id' | 'name' | 'host' | 'port' | 'username' | 'authMode'> | null;
    remotePath: string;
    diagnostics: { level: 'info' | 'warning' | 'error'; message: string }[];
    nextAction: string;
    nextActions: string[];
}

type SyncServerAction = 'servers' | 'server' | 'add-server' | 'update-server' | 'remove-server';
type SyncConfigAction = 'use' | 'test-connection' | 'reset';
type SyncAction = 'sync' | 'status' | SyncServerAction | SyncConfigAction;
type GitRoot = ReturnType<typeof resolveGitRoots>[number];

type PublicServerConfig = Pick<ServerConfig, 'id' | 'name' | 'host' | 'port' | 'username' | 'authMode' | 'privateKeyPath' | 'strictHostKeyChecking'>;

interface SyncServerResult {
    ok: boolean;
    action: SyncServerAction;
    server?: PublicServerConfig;
    servers?: PublicServerConfig[];
    selected?: boolean;
    remotePath?: string;
    diagnostics: { level: 'info' | 'warning' | 'error'; message: string }[];
    nextActions?: string[];
}

interface SyncUseResult {
    ok: boolean;
    action: 'use';
    enabled: boolean;
    selectedServer: string;
    remotePath: string;
    diagnostics: { level: 'info' | 'warning' | 'error'; message: string }[];
    nextActions: string[];
}

interface SyncTestConnectionResult {
    ok: boolean;
    action: 'test-connection';
    server: Pick<ServerConfig, 'id' | 'name' | 'host' | 'port' | 'username' | 'authMode'> | null;
    diagnostics: { level: 'info' | 'warning' | 'error'; message: string }[];
    nextActions: string[];
}

interface SyncResetResult {
    ok: boolean;
    action: 'reset';
    diagnostics: { level: 'info' | 'warning' | 'error'; message: string }[];
    nextActions: string[];
}

interface ResolvedRepoTargets {
    ok: true;
    gitRoots: GitRoot[];
    remotePath: string;
    remotePathOverrides: Map<string, string>;
}

interface FailedRepoTargets {
    ok: false;
    error: string;
}

// ── Git diff ──

function getGitChangedFiles(workspaceRoot: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const isWin = process.platform === 'win32';
        const separator = isWin ? ' & ' : ' ; ';
        const cmd = `git diff --name-only HEAD${separator}git diff --name-only --cached${separator}git ls-files --others --exclude-standard`;
        cp.exec(cmd, { cwd: workspaceRoot }, (err, stdout) => {
            if (err) {
                cp.exec('git status --porcelain -uall', { cwd: workspaceRoot }, (err2, stdout2) => {
                    if (err2) {
                        // 非 git 仓库时返回空数组而非报错
                        if (err2.message.includes('not a git repository')) {
                            resolve([]);
                            return;
                        }
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
            const files = stdout.trim().split('\n').map(f => f.trim()).filter(f => f.length > 0);
            resolve([...new Set(files)]);
        });
    });
}

function availableRepoNames(gitRoots: GitRoot[]): string {
    return gitRoots.map(r => r.name).join(', ');
}

function isAbsoluteRemoteRepoPath(value: string): boolean {
    return value.startsWith('/');
}

function resolveRepoTargets(workspaceRoot: string, remotePath: string, repoFilter?: string): ResolvedRepoTargets | FailedRepoTargets {
    const allGitRoots = resolveGitRoots(workspaceRoot);
    if (allGitRoots.length === 0) {
        return { ok: false, error: `未找到 git 仓库: ${workspaceRoot}` };
    }

    if (!repoFilter) {
        return { ok: true, gitRoots: allGitRoots, remotePath, remotePathOverrides: new Map() };
    }

    const namedRoots = allGitRoots.filter(r => r.name === repoFilter);
    if (namedRoots.length > 0) {
        return { ok: true, gitRoots: namedRoots, remotePath, remotePathOverrides: new Map() };
    }

    if (isAbsoluteRemoteRepoPath(repoFilter)) {
        const remoteRepoPath = repoFilter.replace(/\/+$/, '');
        const basenameRoots = allGitRoots.filter(r => r.name === path.posix.basename(remoteRepoPath));
        const targetRoots = basenameRoots.length > 0 ? basenameRoots : allGitRoots.length === 1 ? allGitRoots : [];
        if (targetRoots.length > 0) {
            return {
                ok: true,
                gitRoots: targetRoots,
                remotePath: remoteRepoPath,
                remotePathOverrides: new Map(targetRoots.map(r => [r.dir, remoteRepoPath]))
            };
        }
        return { ok: false, error: `远程仓库路径 "${repoFilter}" 无法唯一匹配本地仓库，可用: ${availableRepoNames(allGitRoots)}` };
    }

    return { ok: false, error: `未找到仓库 "${repoFilter}"，可用: ${availableRepoNames(allGitRoots)}` };
}

function remotePathForRepo(remotePath: string, gitRoot: GitRoot, overrides: Map<string, string>): string {
    return overrides.get(gitRoot.dir) || remotePath.replace(/\/$/, '') + '/' + gitRoot.name;
}

function dedupeActions(actions: string[]): string[] {
    return Array.from(new Set(actions));
}

function buildSyncNextActions(missing: string[], ready: boolean): { nextAction: string; nextActions: string[] } {
    if (missing.includes('servers')) {
        return {
            nextAction: 'servers',
            nextActions: [
                'forja sync servers --json',
                'forja sync add-server --name <name> --host <host> --username <name> --json'
            ]
        };
    }
    if (missing.includes('selectedServer') || missing.includes('server')) {
        return {
            nextAction: 'use',
            nextActions: [
                'forja sync servers --json',
                'forja sync use --server <id> --remote-path <path> --enable --json'
            ]
        };
    }
    if (missing.includes('remotePath')) {
        return {
            nextAction: 'use',
            nextActions: ['forja sync use --server <id> --remote-path <path> --enable --json']
        };
    }
    if (missing.includes('enabled')) {
        return {
            nextAction: 'use',
            nextActions: ['forja sync use --enable --json']
        };
    }
    if (ready) {
        return {
            nextAction: 'sync',
            nextActions: [
                'forja sync --plan --json',
                'forja sync test-connection --json',
                'forja sync --json'
            ]
        };
    }
    return { nextAction: 'status', nextActions: ['forja sync status --json'] };
}

function syncFailureActions(): string[] {
    return ['forja sync status --json'];
}

function publicSyncServer(server: ServerConfig): Pick<ServerConfig, 'id' | 'name' | 'host' | 'port' | 'username' | 'authMode'> {
    return {
        id: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        authMode: server.authMode
    };
}

// ── 忽略判断 ──

export function isIgnored(relativePath: string, ignoreList: string[]): boolean {
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

// ── 密码解析（CLI 侧） ──

/**
 * CLI 侧密码获取优先级：
 * 1. 环境变量 FORJA_SSH_PASSWORD
 * 2. servers.json 中的明文密码（向后兼容旧数据）
 * 3. stdin 交互式提示（仅 TTY 环境）
 */
async function resolveCliPassword(server: ServerConfig): Promise<string | null> {
    // 环境变量优先
    const envPwd = process.env.FORJA_SSH_PASSWORD;
    if (envPwd) { return envPwd; }

    // 文件中的明文密码（向后兼容）
    if (server.password) { return server.password; }

    // stdin 交互式提示
    if (process.stdin.isTTY) {
        return new Promise((resolve) => {
            const readline = require('readline') as typeof import('readline');
            const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
            rl.question(`输入 ${server.username}@${server.host} 的密码: `, (answer: string) => {
                rl.close();
                resolve(answer || null);
            });
        });
    }

    return null;
}

// ── 主入口 ──

/**
 * CLI 同步入口。
 * @param workspaceRoot 工作区根目录
 * @param serverId 可选，指定服务器 ID
 * @param repoFilter 可选，指定只同步某个子仓库名称
 */
export async function executeSyncCli(workspaceRoot: string, serverId?: string, repoFilter?: string, fileFilters: string[] = []): Promise<SyncResult> {
    const project = readProjectSyncConfig(workspaceRoot);
    if (!project.enabled) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '远程同步未启用' }], server: '', remotePath: '', nextActions: syncFailureActions() };
    }

    const targetId = serverId || project.selectedServer;
    const server = getServerById(targetId);
    if (!server) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: `服务器 "${targetId}" 未找到，请检查 ~/.forja/servers.json` }], server: targetId, remotePath: '', nextActions: syncFailureActions() };
    }

    const remotePath = project.remotePaths[server.id] || '';
    if (!remotePath) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未配置远程路径' }], server: server.name, remotePath: '', nextActions: syncFailureActions() };
    }

    // 密码解析（password 模式）
    let resolvedPassword: string | null = null;
    if (server.authMode === 'password') {
        resolvedPassword = await resolveCliPassword(server);
        if (!resolvedPassword) {
            return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未提供密码。可通过环境变量 FORJA_SSH_PASSWORD 设置，或在 TTY 中交互输入' }], server: server.name, remotePath, nextActions: ['设置环境变量 FORJA_SSH_PASSWORD 后重试'] };
        }
    }

    const repoTargets = resolveRepoTargets(workspaceRoot, remotePath, repoFilter);
    if (!repoTargets.ok) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: repoTargets.error }], server: server.name, remotePath, nextActions: syncFailureActions() };
    }

    const result: SyncResult = { ok: true, uploaded: [], skipped: [], skippedDetails: [], failed: [], server: server.name, remotePath: repoTargets.remotePath };
    const ignore = project.ignore;

    for (const gitRoot of repoTargets.gitRoots) {
        const { dir: gitDir, name: gitName } = gitRoot;
        const repoRemotePath = remotePathForRepo(remotePath, gitRoot, repoTargets.remotePathOverrides);
        const syncTarget: SyncTargetContext = { serverId: server.id, serverName: server.name, remotePath: repoRemotePath };

        const changedFiles = fileFilters.length > 0
            ? resolveRequestedFilesForGitRoot(gitDir, workspaceRoot, fileFilters)
            : await getGitChangedFiles(gitDir);
        if (changedFiles.length === 0) { continue; }

        const notIgnored: string[] = [];
        for (const f of changedFiles) {
            if (isIgnored(f, ignore)) {
                const file = `${gitName}/${f}`;
                result.skipped.push(file);
                result.skippedDetails?.push({ file, reason: 'ignored' });
            }
            else { notIgnored.push(f); }
        }

        const needSync = filterNeedsSync(gitDir, notIgnored, syncTarget);
        for (const f of notIgnored.filter(f => !needSync.includes(f))) {
            const file = `${gitName}/${f}`;
            result.skipped.push(file);
            result.skippedDetails?.push({ file, reason: 'alreadySynced' });
        }

        if (needSync.length === 0) { continue; }

        const remoteDirs = new Set<string>();
        const successFiles: string[] = [];

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
                    result.failed.push({ file: `${gitName}/${relativePath}`, error: `创建远程目录失败: ${msg}` });
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
    }

    result.ok = result.failed.length === 0;
    return result;
}

export async function planSyncCli(workspaceRoot: string, serverId?: string, repoFilter?: string, fileFilters: string[] = []): Promise<SyncPlanResult> {
    const project = readProjectSyncConfig(workspaceRoot);
    const empty = (error: string, server = '', remotePath = ''): SyncPlanResult => ({
        ok: false,
        action: 'sync',
        mode: 'dryRun',
        pending: [],
        skipped: [],
        skippedDetails: [],
        failed: [{ file: '', error }],
        server,
        remotePath,
        repos: [],
        nextActions: syncFailureActions()
    });

    if (!project.enabled) {
        return empty('远程同步未启用');
    }

    const targetId = serverId || project.selectedServer;
    const server = getServerById(targetId);
    if (!server) {
        return empty(`服务器 "${targetId}" 未找到，请检查 ~/.forja/servers.json`, targetId, '');
    }

    const remotePath = project.remotePaths[server.id] || '';
    if (!remotePath) {
        return empty('未配置远程路径', server.name, '');
    }

    const repoTargets = resolveRepoTargets(workspaceRoot, remotePath, repoFilter);
    if (!repoTargets.ok) {
        return empty(repoTargets.error, server.name, remotePath);
    }

    const plan: SyncPlanResult = {
        ok: true,
        action: 'sync',
        mode: 'dryRun',
        pending: [],
        skipped: [],
        skippedDetails: [],
        failed: [],
        server: server.name,
        remotePath: repoTargets.remotePath,
        repos: repoTargets.gitRoots.map(r => r.name),
        nextAction: 'sync',
        nextActions: ['forja sync --json']
    };

    for (const gitRoot of repoTargets.gitRoots) {
        const { dir: gitDir, name: gitName } = gitRoot;
        const repoRemotePath = remotePathForRepo(remotePath, gitRoot, repoTargets.remotePathOverrides);
        const syncTarget: SyncTargetContext = { serverId: server.id, serverName: server.name, remotePath: repoRemotePath };
        const changedFiles = fileFilters.length > 0
            ? resolveRequestedFilesForGitRoot(gitDir, workspaceRoot, fileFilters)
            : await getGitChangedFiles(gitDir);
        if (changedFiles.length === 0) { continue; }

        const notIgnored: string[] = [];
        for (const f of changedFiles) {
            if (isIgnored(f, project.ignore)) {
                const file = `${gitName}/${f}`;
                plan.skipped.push(file);
                plan.skippedDetails.push({ file, reason: 'ignored' });
            }
            else { notIgnored.push(f); }
        }

        const needSync = filterNeedsSync(gitDir, notIgnored, syncTarget);
        for (const f of notIgnored.filter(f => !needSync.includes(f))) {
            const file = `${gitName}/${f}`;
            plan.skipped.push(file);
            plan.skippedDetails.push({ file, reason: 'alreadySynced' });
        }
        plan.pending.push(...needSync.map(f => `${gitName}/${f}`));
    }

    return plan;
}

export function statusSyncCli(workspaceRoot: string, serverId?: string): SyncStatusResult {
    const project = readProjectSyncConfig(workspaceRoot);
    const servers = readServers();
    const targetId = serverId || project.selectedServer;
    const server = targetId ? getServerById(targetId) : null;
    const remotePath = server ? (project.remotePaths[server.id] || '') : '';

    const checks = {
        enabled: project.enabled,
        servers: servers.length > 0,
        selectedServer: targetId.length > 0,
        serverExists: !!server,
        remotePath: remotePath.length > 0
    };

    const missing: string[] = [];
    if (!checks.enabled) { missing.push('enabled'); }
    if (!checks.servers) { missing.push('servers'); }
    if (!checks.selectedServer) { missing.push('selectedServer'); }
    else if (!checks.serverExists) { missing.push('server'); }
    if (!checks.remotePath) { missing.push('remotePath'); }

    const diagnostics = missing.map(key => {
        const messages: Record<string, string> = {
            enabled: '远程同步未启用',
            servers: '未添加同步服务器',
            selectedServer: '未选择同步服务器',
            server: `服务器 "${targetId}" 未找到`,
            remotePath: '未配置远程路径'
        };
        return { level: 'error' as const, message: messages[key] || key };
    });

    const ready = missing.length === 0;
    const guidance = buildSyncNextActions(missing, ready);
    return {
        ok: ready,
        action: 'status',
        ready,
        checks,
        missing,
        server: server ? publicSyncServer(server) : null,
        remotePath,
        diagnostics,
        nextAction: guidance.nextAction,
        nextActions: guidance.nextActions
    };
}

function publicServer(server: ServerConfig): PublicServerConfig {
    return {
        id: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        authMode: server.authMode,
        privateKeyPath: server.privateKeyPath,
        strictHostKeyChecking: !!server.strictHostKeyChecking
    };
}

export function listSyncServersCli(): SyncServerResult {
    return {
        ok: true,
        action: 'servers',
        servers: readServers().map(publicServer),
        diagnostics: []
    };
}

export function showSyncServerCli(workspaceRoot: string, serverId: string | null): SyncServerResult {
    const project = readProjectSyncConfig(workspaceRoot);
    const targetId = serverId || project.selectedServer;
    if (!targetId) {
        return {
            ok: false,
            action: 'server',
            diagnostics: [{ level: 'error', message: '未选择同步服务器' }],
            nextActions: ['forja sync servers --json', 'forja sync use --server <id> --remote-path <path> --enable --json']
        };
    }

    const server = getServerById(targetId);
    if (!server) {
        return {
            ok: false,
            action: 'server',
            diagnostics: [{ level: 'error', message: `服务器 "${targetId}" 未找到` }],
            nextActions: ['forja sync servers --json']
        };
    }

    return {
        ok: true,
        action: 'server',
        server: publicServer(server),
        selected: project.selectedServer === server.id,
        remotePath: project.remotePaths[server.id] || '',
        diagnostics: [],
        nextActions: ['forja sync test-connection --json']
    };
}

function errorSyncServerResult(action: SyncServerAction, message: string): SyncServerResult {
    return {
        ok: false,
        action,
        diagnostics: [{ level: 'error', message }],
        nextActions: ['forja sync servers --json']
    };
}

export function addSyncServerCli(fields: Partial<Omit<ServerConfig, 'id'>>): SyncServerResult {
    if (!fields.name) { return errorSyncServerResult('add-server', '--name 需要一个值'); }
    if (!fields.host) { return errorSyncServerResult('add-server', '--host 需要一个值'); }
    if (!fields.username) { return errorSyncServerResult('add-server', '--username 需要一个值'); }

    const server = addServer({
        name: fields.name,
        host: fields.host,
        port: fields.port || 22,
        username: fields.username,
        authMode: fields.authMode || 'key',
        privateKeyPath: fields.privateKeyPath || '',
        password: fields.password || '',
        strictHostKeyChecking: !!fields.strictHostKeyChecking
    });
    return { ok: true, action: 'add-server', server: publicServer(server), diagnostics: [] };
}

export function updateSyncServerCli(serverId: string | null, fields: Partial<Omit<ServerConfig, 'id'>>): SyncServerResult {
    if (!serverId) { return errorSyncServerResult('update-server', 'update-server 需要 --server <id>'); }
    if (Object.keys(fields).length === 0) { return errorSyncServerResult('update-server', 'update-server 至少需要一个待修改字段'); }
    if (!getServerById(serverId)) { return errorSyncServerResult('update-server', `服务器 "${serverId}" 未找到`); }

    updateServer(serverId, fields);
    const updated = getServerById(serverId);
    if (!updated) { return errorSyncServerResult('update-server', `服务器 "${serverId}" 未找到`); }
    return { ok: true, action: 'update-server', server: publicServer(updated), diagnostics: [] };
}

export function removeSyncServerCli(serverId: string | null): SyncServerResult {
    if (!serverId) { return errorSyncServerResult('remove-server', 'remove-server 需要 --server <id>'); }
    const server = getServerById(serverId);
    if (!server) { return errorSyncServerResult('remove-server', `服务器 "${serverId}" 未找到`); }

    removeServer(serverId);
    return { ok: true, action: 'remove-server', server: publicServer(server), diagnostics: [] };
}

export function useSyncCli(workspaceRoot: string, serverId: string | null, remotePath: string | null, enabled: boolean | null): SyncUseResult {
    const current = readProjectSyncConfig(workspaceRoot);
    const selectedServer = serverId || current.selectedServer;
    if (!selectedServer && enabled === null) {
        return {
            ok: false,
            action: 'use',
            enabled: current.enabled,
            selectedServer,
            remotePath: '',
            diagnostics: [{ level: 'error', message: 'use 需要 --server <id>、--enable 或 --disable' }],
            nextActions: ['forja sync servers --json']
        };
    }

    if (selectedServer && !getServerById(selectedServer)) {
        return {
            ok: false,
            action: 'use',
            enabled: current.enabled,
            selectedServer,
            remotePath: '',
            diagnostics: [{ level: 'error', message: `服务器 "${selectedServer}" 未找到` }],
            nextActions: ['forja sync servers --json']
        };
    }

    const remotePaths = { ...current.remotePaths };
    if (remotePath !== null) {
        if (!selectedServer) {
            return {
                ok: false,
                action: 'use',
                enabled: current.enabled,
                selectedServer,
                remotePath,
                diagnostics: [{ level: 'error', message: '--remote-path 需要同时指定或已有 --server <id>' }],
                nextActions: ['forja sync use --server <id> --remote-path <path> --json']
            };
        }
        remotePaths[selectedServer] = remotePath;
    }

    const nextEnabled = enabled ?? current.enabled;
    writeProjectSyncConfig(workspaceRoot, {
        enabled: nextEnabled,
        selectedServer,
        remotePaths
    });

    return {
        ok: true,
        action: 'use',
        enabled: nextEnabled,
        selectedServer,
        remotePath: selectedServer ? (remotePaths[selectedServer] || '') : '',
        diagnostics: [],
        nextActions: [
            'forja sync status --json',
            'forja sync test-connection --json',
            'forja sync --plan --json'
        ]
    };
}

export async function testSyncConnectionCli(workspaceRoot: string, serverId?: string): Promise<SyncTestConnectionResult> {
    const project = readProjectSyncConfig(workspaceRoot);
    const targetId = serverId || project.selectedServer;
    const server = targetId ? getServerById(targetId) : null;
    if (!targetId) {
        return {
            ok: false,
            action: 'test-connection',
            server: null,
            diagnostics: [{ level: 'error', message: '未选择同步服务器' }],
            nextActions: ['forja sync use --server <id> --remote-path <path> --enable --json']
        };
    }
    if (!server) {
        return {
            ok: false,
            action: 'test-connection',
            server: null,
            diagnostics: [{ level: 'error', message: `服务器 "${targetId}" 未找到` }],
            nextActions: ['forja sync servers --json']
        };
    }

    let password: string | null = null;
    if (server.authMode === 'password') {
        password = await resolveCliPassword(server);
        if (!password) {
            return {
                ok: false,
                action: 'test-connection',
                server: publicSyncServer(server),
                diagnostics: [{ level: 'error', message: '未提供密码。可通过环境变量 FORJA_SSH_PASSWORD 设置，或在 TTY 中交互输入' }],
                nextActions: ['设置环境变量 FORJA_SSH_PASSWORD 后重试']
            };
        }
    }

    const result = await testConnection(server, password);
    return {
        ok: result.ok,
        action: 'test-connection',
        server: publicSyncServer(server),
        diagnostics: result.ok
            ? [{ level: 'info', message: `连接成功: ${server.name} (${server.username}@${server.host})` }]
            : [{ level: 'error', message: `连接失败: ${result.error || '未知错误'}` }],
        nextActions: result.ok ? ['forja sync --plan --json'] : ['forja sync status --json']
    };
}

export function resetSyncCli(workspaceRoot: string): SyncResetResult {
    clearSyncState(workspaceRoot);
    return {
        ok: true,
        action: 'reset',
        diagnostics: [{ level: 'info', message: '已清除同步状态；下次同步会重新计算待同步文件' }],
        nextActions: ['forja sync --plan --json', 'forja sync --json']
    };
}

export interface SyncCliOptions {
    action: SyncAction;
    executionMode: 'dryRun' | 'execute';
    workspace: string;
    server: string | null;
    remotePath: string | null;
    enabled: boolean | null;
    repo: string | null;
    files: string[];
    serverFields: Partial<Omit<ServerConfig, 'id'>>;
    json: boolean;
}

const syncHelpText = `Forja Sync CLI — 通用远程文件同步

用法:
  forja sync [options]
  forja sync status [options]
  forja sync use --server <id> [--remote-path <path>] [--enable|--disable]
  forja sync test-connection [--server <id>]
  forja sync reset [options]
  forja sync servers [options]
  forja sync server [--server <id>]
  forja sync add-server [options]
  forja sync update-server --server <id> [options]
  forja sync remove-server --server <id> [options]

选项:
  --workspace <path>      工作区路径（默认当前目录），决定读取/写入哪份 sync 配置
  --server <id>           临时指定服务器；在 sync/status/server/test-connection 中不保存
  --repo <name|path>      指定子仓库名称；单仓库时也可传远程绝对仓库路径
  --file <path>           指定单个文件路径；可重复，路径可相对 workspace 或仓库根目录
  --plan                  仅预览待同步文件，不执行 SSH/SCP
  --remote-path <path>    use 保存当前服务器的远程父目录或单仓库远程目录
  --enable                use 保存启用远程同步
  --disable               use 保存禁用远程同步
  --name <name>           服务器名称（add-server/update-server）
  --host <host>           SSH 主机（add-server/update-server）
  --port <port>           SSH 端口（add-server/update-server，默认 22）
  --username <name>       SSH 用户名（add-server/update-server）
  --auth-mode <mode>      认证方式：key 或 password
  --private-key-path <p>  SSH 私钥路径
  --password <password>   SSH 密码（会写入 servers.json；建议优先用 FORJA_SSH_PASSWORD）
  --strict-host-key-checking     启用严格主机密钥检查
  --no-strict-host-key-checking  关闭严格主机密钥检查
  --json                  输出 JSON 格式（适合 AI 工具解析）
  --help, -h              显示此帮助信息

工作流:
  1. forja sync status --json
  2. forja sync servers --json
  3. forja sync server --server <id> --json
  4. forja sync add-server --name dev --host 127.0.0.1 --username dev --json
  5. forja sync use --server <id> --remote-path <path> --enable --json
  6. forja sync test-connection --json
  7. forja sync --plan --json
  8. forja sync --json

说明:
  use 会保存当前 workspace 的 selectedServer、remotePaths 和 enabled。
  --server 在 sync/status/server/test-connection 中只是临时覆盖；要缓存选择请用 use。
  password 认证优先读取 FORJA_SSH_PASSWORD，其次读取服务器配置中的 password。
  sync 是前台命令，可用 Ctrl+C 打断；中断后可用 reset 清除本地同步状态再预览。

示例:
  forja sync status --json           查看同步配置就绪状态
  forja sync servers --json          列举同步服务器
  forja sync server --json           查看当前选择的服务器详情
  forja sync server --server dev --json 查看指定服务器详情
  forja sync add-server --name dev --host 127.0.0.1 --username dev --json
  forja sync update-server --server dev --host 10.0.0.2 --json
  forja sync remove-server --server dev --json
  forja sync use --server dev --remote-path /remote/app --enable --json
  forja sync test-connection --json
  forja sync reset --json           清除同步状态，下次重新计算
  forja sync                         同步变更文件到远程
  forja sync --plan --json           JSON 预览待同步文件
  forja sync --server dev --repo app 同步指定服务器和子仓库
  forja sync --server dev --repo /remote/app 覆盖单仓库远程目标路径
  forja sync --file src/main.cpp     单文件同步
`;

export function isSyncHelpRequest(args: string[]): boolean {
    return args.includes('--help') || args.includes('-h');
}

export function getSyncHelpText(): string {
    return syncHelpText;
}

function readSyncValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} 需要一个值`);
    }
    return value;
}

function readPortValue(args: string[], index: number, flag: string): number {
    const raw = readSyncValue(args, index, flag);
    const port = Number(raw);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`${flag} 需要 1-65535 之间的整数`);
    }
    return port;
}

function readAuthModeValue(args: string[], index: number, flag: string): 'key' | 'password' {
    const value = readSyncValue(args, index, flag);
    if (value !== 'key' && value !== 'password') {
        throw new Error(`${flag} 只支持 key 或 password`);
    }
    return value;
}

export function parseSyncCliArgs(args: string[]): SyncCliOptions {
    const options: SyncCliOptions = {
        action: 'sync',
        executionMode: 'execute',
        workspace: process.cwd(),
        server: null,
        remotePath: null,
        enabled: null,
        repo: null,
        files: [],
        serverFields: {},
        json: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case 'status':
            case 'servers':
            case 'server':
            case 'add-server':
            case 'update-server':
            case 'remove-server':
            case 'use':
            case 'test-connection':
            case 'reset':
                if (i !== 0) {
                    throw new Error(`forja sync 不接受子命令或位置参数: ${arg}`);
                }
                options.action = arg;
                break;
            case '--plan':
                if (options.action === 'status') {
                    throw new Error('forja sync status 不支持 --plan');
                }
                if (options.action !== 'sync') {
                    throw new Error(`forja sync ${options.action} 不支持 --plan`);
                }
                options.executionMode = 'dryRun';
                break;
            case '--workspace':
                options.workspace = readSyncValue(args, i, arg);
                i++;
                break;
            case '--server':
                options.server = readSyncValue(args, i, arg);
                i++;
                break;
            case '--remote-path':
                if (options.action !== 'use') {
                    throw new Error(`forja sync ${options.action} 不支持 --remote-path`);
                }
                options.remotePath = readSyncValue(args, i, arg);
                i++;
                break;
            case '--enable':
                if (options.action !== 'use') {
                    throw new Error(`forja sync ${options.action} 不支持 --enable`);
                }
                options.enabled = true;
                break;
            case '--disable':
                if (options.action !== 'use') {
                    throw new Error(`forja sync ${options.action} 不支持 --disable`);
                }
                options.enabled = false;
                break;
            case '--repo':
                if (options.action === 'status') {
                    throw new Error('forja sync status 不支持 --repo');
                }
                if (options.action !== 'sync') {
                    throw new Error(`forja sync ${options.action} 不支持 --repo`);
                }
                options.repo = readSyncValue(args, i, arg);
                i++;
                break;
            case '--file':
                if (options.action === 'status') {
                    throw new Error('forja sync status 不支持 --file');
                }
                if (options.action !== 'sync') {
                    throw new Error(`forja sync ${options.action} 不支持 --file`);
                }
                options.files.push(readSyncValue(args, i, arg));
                i++;
                break;
            case '--name':
                options.serverFields.name = readSyncValue(args, i, arg);
                i++;
                break;
            case '--host':
                options.serverFields.host = readSyncValue(args, i, arg);
                i++;
                break;
            case '--port':
                options.serverFields.port = readPortValue(args, i, arg);
                i++;
                break;
            case '--username':
                options.serverFields.username = readSyncValue(args, i, arg);
                i++;
                break;
            case '--auth-mode':
                options.serverFields.authMode = readAuthModeValue(args, i, arg);
                i++;
                break;
            case '--private-key-path':
                options.serverFields.privateKeyPath = readSyncValue(args, i, arg);
                i++;
                break;
            case '--password':
                options.serverFields.password = readSyncValue(args, i, arg);
                i++;
                break;
            case '--strict-host-key-checking':
                options.serverFields.strictHostKeyChecking = true;
                break;
            case '--no-strict-host-key-checking':
                options.serverFields.strictHostKeyChecking = false;
                break;
            case '--json':
                options.json = true;
                break;
            case '--help':
            case '-h':
                break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`未知参数: ${arg}`);
                }
                throw new Error(`forja sync 不接受子命令或位置参数: ${arg}`);
        }
    }

    if (Object.keys(options.serverFields).length > 0 && !['add-server', 'update-server'].includes(options.action)) {
        throw new Error(`forja sync ${options.action} 不支持服务器字段参数`);
    }
    if (options.enabled !== null && options.remotePath === null && options.server === null && options.action !== 'use') {
        throw new Error(`forja sync ${options.action} 不支持启用状态参数`);
    }

    return options;
}

function printSyncServerText(output: SyncServerResult): void {
    if (!output.ok) {
        console.error(output.diagnostics.map(d => d.message).join(', '));
        return;
    }
    if (output.action === 'servers') {
        const servers = output.servers || [];
        if (servers.length === 0) {
            console.log('未配置同步服务器');
            return;
        }
        for (const server of servers) {
            console.log(`${server.id}\t${server.name}\t${server.username}@${server.host}:${server.port}\t${server.authMode}`);
        }
        return;
    }
    if (output.server) {
        console.log(`${output.action}: ${output.server.name} (${output.server.id})`);
    }
}

function printNextActions(nextActions?: string[]): void {
    if (!nextActions || nextActions.length === 0) { return; }
    console.log('下一步:');
    for (const action of nextActions) {
        console.log(`  ${action}`);
    }
}

function printSkippedDetails(skippedDetails?: { file: string; reason: string }[]): void {
    if (!skippedDetails || skippedDetails.length === 0) { return; }
    console.log('跳过明细:');
    for (const item of skippedDetails) {
        console.log(`  ${item.file} (${item.reason})`);
    }
}

function printFailedDetails(failed: { file: string; error: string }[]): void {
    if (failed.length === 0) { return; }
    console.error('失败明细:');
    for (const item of failed) {
        const file = item.file || '(global)';
        console.error(`  ${file}: ${item.error}`);
    }
}

export async function runSyncCli(argv: string[]): Promise<void> {
    if (isSyncHelpRequest(argv)) {
        console.log(getSyncHelpText());
        return;
    }

    let wantsJson = argv.includes('--json');
    try {
        const options = parseSyncCliArgs(argv);
        wantsJson = options.json;
        const workspace = path.resolve(options.workspace);

        if (options.action === 'servers') {
            const output = listSyncServersCli();
            if (wantsJson) { console.log(JSON.stringify(output, null, 2)); }
            else { printSyncServerText(output); }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'server') {
            const output = showSyncServerCli(workspace, options.server);
            if (wantsJson) { console.log(JSON.stringify(output, null, 2)); }
            else { printSyncServerText(output); }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'add-server') {
            const output = addSyncServerCli(options.serverFields);
            if (wantsJson) { console.log(JSON.stringify(output, null, 2)); }
            else { printSyncServerText(output); }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'update-server') {
            const output = updateSyncServerCli(options.server, options.serverFields);
            if (wantsJson) { console.log(JSON.stringify(output, null, 2)); }
            else { printSyncServerText(output); }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'remove-server') {
            const output = removeSyncServerCli(options.server);
            if (wantsJson) { console.log(JSON.stringify(output, null, 2)); }
            else { printSyncServerText(output); }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'use') {
            const output = useSyncCli(workspace, options.server, options.remotePath, options.enabled);
            if (wantsJson) {
                console.log(JSON.stringify(output, null, 2));
            } else if (output.ok) {
                console.log(`Sync use: ${output.enabled ? 'enabled' : 'disabled'} (${output.selectedServer || 'no server'}:${output.remotePath || 'no remote path'})`);
                printNextActions(output.nextActions);
            } else {
                console.error(`Sync use 失败: ${output.diagnostics.map(d => d.message).join(', ')}`);
                printNextActions(output.nextActions);
            }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'test-connection') {
            const output = await testSyncConnectionCli(workspace, options.server || undefined);
            if (wantsJson) {
                console.log(JSON.stringify(output, null, 2));
            } else if (output.ok && output.server) {
                console.log(`连接成功: ${output.server.name} (${output.server.username}@${output.server.host})`);
                printNextActions(output.nextActions);
            } else {
                console.error(`连接失败: ${output.diagnostics.map(d => d.message).join(', ')}`);
                printNextActions(output.nextActions);
            }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'reset') {
            const output = resetSyncCli(workspace);
            if (wantsJson) {
                console.log(JSON.stringify(output, null, 2));
            } else {
                console.log(output.diagnostics.map(d => d.message).join(', '));
                printNextActions(output.nextActions);
            }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.action === 'status') {
            const output = statusSyncCli(workspace, options.server || undefined);
            if (wantsJson) {
                console.log(JSON.stringify(output, null, 2));
            } else if (output.ok && output.server) {
                console.log(`Sync status: ready (${output.server.name}:${output.remotePath})`);
            } else {
                console.log(`Sync status: not ready (${output.missing.join(', ')})`);
            }
            if (!wantsJson) { printNextActions(output.nextActions); }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        if (options.executionMode === 'dryRun') {
            const output = await planSyncCli(workspace, options.server || undefined, options.repo || undefined, options.files);
            if (wantsJson) {
                console.log(JSON.stringify(output, null, 2));
            } else if (output.ok) {
                console.log(`Sync (plan): ${output.pending.length} 个文件待同步到 ${output.server}:${output.remotePath}`);
                printSkippedDetails(output.skippedDetails);
                printNextActions(output.nextActions);
            } else {
                console.log(`Sync (plan) 失败: ${output.failed.map(f => f.error).join(', ')}`);
                printFailedDetails(output.failed);
                printNextActions(output.nextActions);
            }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        const result = await executeSyncCli(workspace, options.server || undefined, options.repo || undefined, options.files);
        if (wantsJson) {
            console.log(JSON.stringify(result, null, 2));
        } else if (result.ok) {
            console.log(`同步完成: ${result.uploaded.length} 个文件已上传`);
            if (result.skipped.length > 0) {
                console.log(`跳过: ${result.skipped.length} 个`);
                printSkippedDetails(result.skippedDetails);
            }
        } else {
            console.error(`同步失败: ${result.failed.map(f => f.error).join(', ')}`);
            printFailedDetails(result.failed);
            printSkippedDetails(result.skippedDetails);
            printNextActions(result.nextActions);
        }
        process.exitCode = result.ok ? 0 : 1;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (wantsJson) {
            console.log(JSON.stringify({
                ok: false,
                action: 'sync',
                diagnostics: [{ level: 'error', message }]
            }, null, 2));
        } else {
            console.error(message);
        }
        process.exitCode = 1;
    }
}
