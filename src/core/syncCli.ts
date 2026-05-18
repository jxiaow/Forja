/**
 * CLI-compatible sync module — no vscode dependency.
 * Reads config from ~/.compilot/servers.json and .compilot/sync-config.json
 */
import * as path from 'path';
import * as cp from 'child_process';
import { filterNeedsSync, markSyncedBatch } from './syncState';
import { readProjectSyncConfig, getServerById, getServerByName, ServerConfig } from './serverStore';
import { buildScpArgs, buildSshArgs, sshTarget, createAskpassEnv } from './ssh';

export interface SyncResult {
    ok: boolean;
    uploaded: string[];
    skipped: string[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
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

// ── SCP 上传 ──

function scpUpload(server: ServerConfig, localFile: string, remoteFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const baseArgs = buildScpArgs(server);
        const escapedRemote = remoteFile.replace(/'/g, "'\\''");
        const dest = `${sshTarget(server)}:'${escapedRemote}'`;
        const args = [...baseArgs, localFile, dest];

        const askpass = createAskpassEnv(
            server.authMode === 'password' ? server.password : null, `sync-${process.pid}`
        );

        const proc = cp.spawn('scp', args, {
            windowsHide: true,
            env: askpass?.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            askpass?.cleanup();
            if (code === 0) { resolve(); } else { reject(new Error(stderr.trim() || `exit ${code}`)); }
        });
        proc.on('error', (e) => {
            askpass?.cleanup();
            reject(new Error(`scp: ${e.message}`));
        });
    });
}

function ensureRemoteDir(server: ServerConfig, remoteDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const sshArgs = buildSshArgs(server);
        const escaped = remoteDir.replace(/'/g, "'\\''");
        const cmd = `mkdir -p '${escaped}'`;
        const args = [...sshArgs, sshTarget(server), cmd];

        const askpass = createAskpassEnv(
            server.authMode === 'password' ? server.password : null, `sync-${process.pid}`
        );

        const proc = cp.spawn('ssh', args, {
            windowsHide: true,
            env: askpass?.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stderr = '';
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            askpass?.cleanup();
            if (code === 0) { resolve(); }
            else { reject(new Error(`ensureRemoteDir 失败 (exit ${code}): ${stderr.trim() || 'mkdir -p failed'}`)); }
        });
        proc.on('error', (err) => { askpass?.cleanup(); reject(err); });
    });
}

// ── 主入口 ──

export async function executeSyncCli(workspaceRoot: string, serverName?: string): Promise<SyncResult> {
    const project = readProjectSyncConfig(workspaceRoot);
    if (!project.enabled) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '远程同步未启用' }], server: '', remotePath: '' };
    }

    const targetName = serverName || project.selectedServer;
    const server = getServerById(targetName) || getServerByName(targetName);
    if (!server) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: `服务器 "${targetName}" 未找到，请检查 ~/.compilot/servers.json` }], server: targetName, remotePath: '' };
    }

    if (!server.remotePath) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未配置远程路径' }], server: server.name, remotePath: '' };
    }

    const remotePath = server.remotePath;
    const result: SyncResult = { ok: true, uploaded: [], skipped: [], failed: [], server: server.name, remotePath };

    const changedFiles = await getGitChangedFiles(workspaceRoot);
    if (changedFiles.length === 0) { return result; }

    const ignore = project.ignore;
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
        const remoteFile = remotePath.replace(/\/$/, '') + '/' + relativePath.replace(/\\/g, '/');
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
