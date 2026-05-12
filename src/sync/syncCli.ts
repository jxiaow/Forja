/**
 * CLI-compatible sync module — no vscode dependency.
 * Reads sync config from .work/qt-pilot/sync-config.json
 */
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { filterNeedsSync, markSyncedBatch } from './syncState';

export type AuthMode = 'key' | 'password';

export interface CliServerConfig {
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: AuthMode;
    privateKeyPath: string;
    password?: string;
}

export interface CliSyncProjectConfig {
    enabled: boolean;
    selectedServer: string;
    remotePath: string;
    ignore: string[];
}

export interface CliSyncFullConfig {
    servers: CliServerConfig[];
    project: CliSyncProjectConfig;
}

export interface SyncResult {
    ok: boolean;
    uploaded: string[];
    skipped: string[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
}

const DEFAULT_IGNORE = ['.git', 'node_modules', 'out', '.work', 'build', 'debug', 'release'];

// ── 配置文件路径 ──

function _configPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.work', 'qt-pilot', 'sync-config.json');
}

export function readSyncConfig(workspaceRoot: string): CliSyncFullConfig | null {
    const filePath = _configPath(workspaceRoot);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch {}
    return null;
}

export function writeSyncConfig(workspaceRoot: string, config: CliSyncFullConfig): void {
    const filePath = _configPath(workspaceRoot);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
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
                    if (err2) { reject(new Error(`git 命令失败: ${err2.message}`)); return; }
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

function scpUpload(server: CliServerConfig, localFile: string, remoteFile: string): Promise<void> {
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

        if (server.authMode === 'password' && server.password) {
            const args = ['-p', server.password, 'scp', ...baseArgs, localFile, dest];
            const proc = cp.spawn('sshpass', args, { windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => { code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`)); });
            proc.on('error', (e) => reject(new Error(`sshpass: ${e.message}`)));
        } else {
            const args = [...baseArgs, localFile, dest];
            const proc = cp.spawn('scp', args, { windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => { code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`)); });
            proc.on('error', (e) => reject(new Error(`scp: ${e.message}`)));
        }
    });
}

function ensureRemoteDir(server: CliServerConfig, remoteDir: string): Promise<void> {
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

        if (server.authMode === 'password' && server.password) {
            const args = ['-p', server.password, 'ssh', ...sshArgs, `${server.username}@${server.host}`, cmd];
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

// ── 主入口 ──

export async function executeSyncCli(workspaceRoot: string, serverName?: string): Promise<SyncResult> {
    const config = readSyncConfig(workspaceRoot);
    if (!config) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未找到同步配置，请先在 VSCode 扩展中配置或创建 .work/qt-pilot/sync-config.json' }], server: '', remotePath: '' };
    }

    const { servers, project } = config;
    if (!project.enabled) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '远程同步未启用' }], server: '', remotePath: '' };
    }

    const targetName = serverName || project.selectedServer;
    const server = servers.find(s => s.name === targetName);
    if (!server) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: `服务器 "${targetName}" 未找到` }], server: targetName, remotePath: '' };
    }

    if (!project.remotePath) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未配置远程路径' }], server: server.name, remotePath: '' };
    }

    const result: SyncResult = { ok: true, uploaded: [], skipped: [], failed: [], server: server.name, remotePath: project.remotePath };

    const changedFiles = await getGitChangedFiles(workspaceRoot);
    if (changedFiles.length === 0) { return result; }

    const ignore = project.ignore || DEFAULT_IGNORE;
    const notIgnored: string[] = [];
    for (const f of changedFiles) {
        if (isIgnored(f, ignore)) { result.skipped.push(f); }
        else { notIgnored.push(f); }
    }

    const needSync = filterNeedsSync(workspaceRoot, notIgnored);
    result.skipped.push(...notIgnored.filter(f => !needSync.includes(f)));

    if (needSync.length === 0) { return result; }

    const remoteDirs = new Set<string>();
    const successFiles: string[] = [];

    for (const relativePath of needSync) {
        const localFile = path.join(workspaceRoot, relativePath);
        const remoteFile = project.remotePath.replace(/\/$/, '') + '/' + relativePath.replace(/\\/g, '/');
        const remoteDir = path.posix.dirname(remoteFile);

        if (!remoteDirs.has(remoteDir)) {
            await ensureRemoteDir(server, remoteDir);
            remoteDirs.add(remoteDir);
        }

        try {
            await scpUpload(server, localFile, remoteFile);
            result.uploaded.push(relativePath);
            successFiles.push(relativePath);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            result.failed.push({ file: relativePath, error: msg });
        }
    }

    if (successFiles.length > 0) {
        markSyncedBatch(workspaceRoot, successFiles);
    }

    result.ok = result.failed.length === 0;
    return result;
}
