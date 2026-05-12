import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { createLogger } from '../core/logger';
import { filterNeedsSync, markSyncedBatch } from './syncState';
import { readServers, readProjectSyncConfig, writeProjectSyncConfig, ServerConfig, ProjectSyncConfig, getServerByName } from './serverStore';

const logger = createLogger('SftpClient');

export { ServerConfig, ProjectSyncConfig } from './serverStore';
export { readServers, readProjectSyncConfig, writeProjectSyncConfig, getServerByName } from './serverStore';
export { addServer, removeServer, writeServers, updateProjectSyncField } from './serverStore';

// ── 解析配置 ──

export interface ResolvedSyncConfig {
    server: ServerConfig;
    remotePath: string;
    ignore: string[];
}

export function getResolvedConfig(workspaceRoot: string): ResolvedSyncConfig | null {
    if (!workspaceRoot) { return null; }
    const project = readProjectSyncConfig(workspaceRoot);
    if (!project.enabled || !project.selectedServer || !project.remotePath) { return null; }
    const server = getServerByName(project.selectedServer);
    if (!server) { return null; }
    return { server, remotePath: project.remotePath, ignore: project.ignore };
}

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
            proc.on('error', () => {
                reject(new Error(
                    '密码认证需要 sshpass 工具。解决方案：\n' +
                    '1. 安装 Git for Windows 并使用 Git Bash 中的 sshpass\n' +
                    '2. 或改用 SSH 密钥认证（推荐）：ssh-keygen 生成密钥后 ssh-copy-id 推送到服务器'
                ));
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
