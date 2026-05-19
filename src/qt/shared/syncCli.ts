/**
 * CLI-compatible sync module — no vscode dependency.
 * Reads config from ~/.compilot/servers.json and .compilot/sync-config.json
 */
import * as path from 'path';
import * as cp from 'child_process';
import { filterNeedsSync, markSyncedBatch } from '../../core/syncState';
import { readProjectSyncConfig, getServerById, getServerByName, ServerConfig } from '../../core/serverStore';
import { buildScpArgs, buildSshArgs, sshTarget, createAskpassEnv } from '../../core/ssh';
import { resolveGitRoots } from '../../core/gitRepoResolver';

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
 * 1. 环境变量 COMPILOT_SSH_PASSWORD
 * 2. servers.json 中的明文密码（向后兼容旧数据）
 * 3. stdin 交互式提示（仅 TTY 环境）
 */
async function resolveCliPassword(server: ServerConfig): Promise<string | null> {
    // 环境变量优先
    const envPwd = process.env.COMPILOT_SSH_PASSWORD;
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

// ── SCP 上传 ──

function scpUpload(server: ServerConfig, localFile: string, remoteFile: string, password: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const baseArgs = buildScpArgs(server);
        const escapedRemote = remoteFile.replace(/'/g, "'\\''");
        const dest = `${sshTarget(server)}:'${escapedRemote}'`;
        const args = [...baseArgs, localFile, dest];

        const askpass = createAskpassEnv(
            server.authMode === 'password' ? password : null, `sync-${process.pid}`
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
            code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`)); // eslint-disable-line @typescript-eslint/no-unused-expressions
        });
        proc.on('error', (e) => {
            askpass?.cleanup();
            reject(new Error(`scp: ${e.message}`));
        });
    });
}

function ensureRemoteDir(server: ServerConfig, remoteDir: string, password: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const sshArgs = buildSshArgs(server);
        const escaped = remoteDir.replace(/'/g, "'\\''");
        const cmd = `mkdir -p '${escaped}'`;
        const args = [...sshArgs, sshTarget(server), cmd];

        const askpass = createAskpassEnv(
            server.authMode === 'password' ? password : null, `sync-${process.pid}`
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

/**
 * CLI 同步入口。
 * @param workspaceRoot 工作区根目录
 * @param serverName 可选，指定服务器名称或 ID
 * @param repoFilter 可选，指定只同步某个子仓库名称
 */
export async function executeSyncCli(workspaceRoot: string, serverName?: string, repoFilter?: string): Promise<SyncResult> {
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

    // 密码解析（password 模式）
    let resolvedPassword: string | null = null;
    if (server.authMode === 'password') {
        resolvedPassword = await resolveCliPassword(server);
        if (!resolvedPassword) {
            return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未提供密码。可通过环境变量 COMPILOT_SSH_PASSWORD 设置，或在 TTY 中交互输入' }], server: server.name, remotePath };
        }
    }

    // 解析 git 仓库
    let gitRoots = resolveGitRoots(workspaceRoot);
    if (gitRoots.length === 0) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: `未找到 git 仓库: ${workspaceRoot}` }], server: server.name, remotePath };
    }

    // 按名称过滤
    if (repoFilter) {
        gitRoots = gitRoots.filter(r => r.name === repoFilter);
        if (gitRoots.length === 0) {
            return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: `未找到仓库 "${repoFilter}"，可用: ${resolveGitRoots(workspaceRoot).map(r => r.name).join(', ')}` }], server: server.name, remotePath };
        }
    }

    const result: SyncResult = { ok: true, uploaded: [], skipped: [], failed: [], server: server.name, remotePath };
    const ignore = project.ignore;

    for (const { dir: gitDir, name: gitName } of gitRoots) {
        const repoRemotePath = remotePath.replace(/\/$/, '') + '/' + gitName;

        const changedFiles = await getGitChangedFiles(gitDir);
        if (changedFiles.length === 0) { continue; }

        const notIgnored: string[] = [];
        for (const f of changedFiles) {
            if (isIgnored(f, ignore)) { result.skipped.push(`${gitName}/${f}`); }
            else { notIgnored.push(f); }
        }

        const needSync = filterNeedsSync(gitDir, notIgnored);
        result.skipped.push(...notIgnored.filter(f => !needSync.includes(f)).map(f => `${gitName}/${f}`));

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
            markSyncedBatch(gitDir, successFiles);
        }
    }

    result.ok = result.failed.length === 0;
    return result;
}
