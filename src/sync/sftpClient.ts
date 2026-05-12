import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { createLogger } from '../core/logger';
import { filterNeedsSync, markSyncedBatch } from './syncState';

const logger = createLogger('SftpClient');

export type AuthMode = 'key' | 'password';

export interface ServerConfig {
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: AuthMode;
    privateKeyPath: string;
}

export interface SyncConfig {
    enabled: boolean;
    selectedServer: string;
    remotePath: string;
    ignore: string[];
}

export interface ResolvedSyncConfig {
    server: ServerConfig;
    remotePath: string;
    ignore: string[];
}

const DEFAULT_IGNORE = ['.git', 'node_modules', 'out', '.work', 'build', 'debug', 'release'];

// ── 配置读取 ──

export function getServers(): ServerConfig[] {
    const cfg = vscode.workspace.getConfiguration('qtPilot.remoteSync');
    const raw = cfg.get<any[]>('servers', []);
    return raw.map(s => ({
        name: s.name || '',
        host: s.host || '',
        port: s.port || 22,
        username: s.username || '',
        authMode: (s.authMode === 'password' ? 'password' : 'key') as AuthMode,
        privateKeyPath: s.privateKeyPath || ''
    })).filter(s => s.name && s.host);
}

export function getSyncConfig(): SyncConfig {
    const cfg = vscode.workspace.getConfiguration('qtPilot.remoteSync');
    return {
        enabled: cfg.get<boolean>('enabled', false),
        selectedServer: cfg.get<string>('selectedServer', ''),
        remotePath: cfg.get<string>('remotePath', ''),
        ignore: cfg.get<string[]>('ignore', DEFAULT_IGNORE)
    };
}

export function getResolvedConfig(): ResolvedSyncConfig | null {
    const sync = getSyncConfig();
    if (!sync.enabled || !sync.selectedServer || !sync.remotePath) { return null; }
    const servers = getServers();
    const server = servers.find(s => s.name === sync.selectedServer);
    if (!server) { return null; }
    return { server, remotePath: sync.remotePath, ignore: sync.ignore };
}

export async function updateServers(servers: ServerConfig[]): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('qtPilot.remoteSync');
    await cfg.update('servers', servers, vscode.ConfigurationTarget.Global);
}

export async function updateSyncConfigWorkspace(key: string, value: unknown): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('qtPilot.remoteSync');
    await cfg.update(key, value, vscode.ConfigurationTarget.Workspace);
}

/**
 * 将当前同步配置写入 .work/qt-pilot/sync-config.json 供 CLI 读取
 */
export function writeSyncConfigForCli(workspaceRoot: string): void {
    if (!workspaceRoot) { return; }
    const fs = require('fs');
    const path = require('path');
    const servers = getServers();
    const sync = getSyncConfig();
    const data = {
        servers: servers.map(s => ({
            name: s.name,
            host: s.host,
            port: s.port,
            username: s.username,
            authMode: s.authMode,
            privateKeyPath: s.privateKeyPath
        })),
        project: {
            enabled: sync.enabled,
            selectedServer: sync.selectedServer,
            remotePath: sync.remotePath,
            ignore: sync.ignore
        }
    };
    const dir = path.join(workspaceRoot, '.work', 'qt-pilot');
    const filePath = path.join(dir, 'sync-config.json');
    try {
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
}

// ── 密码缓存（会话级） ──

const _passwordCache: Map<string, string> = new Map();
let _secrets: import('vscode').SecretStorage | null = null;

export function setSecretStorage(secrets: import('vscode').SecretStorage): void {
    _secrets = secrets;
}

export async function askPassword(host: string, username: string, serverName?: string): Promise<string | null> {
    const key = `${username}@${host}`;
    if (_passwordCache.has(key)) { return _passwordCache.get(key)!; }

    // 尝试从 SecretStorage 读取
    if (_secrets && serverName) {
        const stored = await _secrets.get(`qtPilot.sync.password.${serverName}`);
        if (stored) {
            _passwordCache.set(key, stored);
            return stored;
        }
    }

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
        const cmd = 'git diff --name-only HEAD & git diff --name-only --cached & git ls-files --others --exclude-standard';
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

// ── SCP 上传 ──

function scpUpload(server: ServerConfig, localFile: string, remoteFile: string, password: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const baseArgs: string[] = [];
        if (server.authMode === 'key' && server.privateKeyPath) {
            baseArgs.push('-i', server.privateKeyPath);
        }
        if (server.port !== 22) {
            baseArgs.push('-P', String(server.port));
        }
        baseArgs.push('-o', 'StrictHostKeyChecking=no');
        if (server.authMode === 'key') {
            baseArgs.push('-o', 'BatchMode=yes');
        }

        const dest = `${server.username}@${server.host}:${remoteFile}`;

        if (server.authMode === 'password' && password) {
            const args = ['-p', password, 'scp', ...baseArgs, localFile, dest];
            const proc = cp.spawn('sshpass', args, { windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0) { resolve(); }
                else { reject(new Error(`scp 失败 (code=${code}): ${stderr.trim()}`)); }
            });
            proc.on('error', (e) => {
                reject(new Error(`sshpass 未安装或不可用: ${e.message}。密码认证需要安装 sshpass，或改用密钥认证。`));
            });
        } else {
            const args = [...baseArgs, localFile, dest];
            const proc = cp.spawn('scp', args, { windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0) { resolve(); }
                else { reject(new Error(`scp 失败 (code=${code}): ${stderr.trim()}`)); }
            });
            proc.on('error', (e) => {
                reject(new Error(`scp 启动失败: ${e.message}`));
            });
        }
    });
}

// ── 确保远程目录 ──

function ensureRemoteDir(server: ServerConfig, remoteDir: string, password: string | null): Promise<void> {
    return new Promise((resolve) => {
        const sshArgs: string[] = [];
        if (server.authMode === 'key' && server.privateKeyPath) {
            sshArgs.push('-i', server.privateKeyPath);
        }
        sshArgs.push('-p', String(server.port));
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        if (server.authMode === 'key') {
            sshArgs.push('-o', 'BatchMode=yes');
        }

        const cmd = `mkdir -p "${remoteDir}"`;

        if (server.authMode === 'password' && password) {
            const args = ['-p', password, 'ssh', ...sshArgs, `${server.username}@${server.host}`, cmd];
            const proc = cp.spawn('sshpass', args, { windowsHide: true });
            proc.on('close', () => resolve());
            proc.on('error', () => resolve());
        } else {
            const args = [...sshArgs, `${server.username}@${server.host}`, cmd];
            const proc = cp.spawn('ssh', args, { windowsHide: true });
            proc.on('close', () => resolve());
            proc.on('error', () => resolve());
        }
    });
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
        password = await askPassword(server.host, server.username, server.name);
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

// ── 测试连接 ──

export function testConnection(server: ServerConfig, password: string | null): Promise<boolean> {
    return new Promise((resolve) => {
        const sshArgs: string[] = [];
        if (server.authMode === 'key' && server.privateKeyPath) {
            sshArgs.push('-i', server.privateKeyPath);
        }
        sshArgs.push('-p', String(server.port));
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        sshArgs.push('-o', 'ConnectTimeout=5');
        if (server.authMode === 'key') {
            sshArgs.push('-o', 'BatchMode=yes');
        }

        const target = `${server.username}@${server.host}`;

        if (server.authMode === 'password' && password) {
            const args = ['-p', password, 'ssh', ...sshArgs, target, 'echo ok'];
            const proc = cp.spawn('sshpass', args, { windowsHide: true });
            let stdout = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.on('close', (code) => { resolve(code === 0 && stdout.trim() === 'ok'); });
            proc.on('error', () => resolve(false));
        } else {
            const args = [...sshArgs, target, 'echo ok'];
            const proc = cp.spawn('ssh', args, { windowsHide: true });
            let stdout = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.on('close', (code) => { resolve(code === 0 && stdout.trim() === 'ok'); });
            proc.on('error', () => resolve(false));
        }
    });
}
