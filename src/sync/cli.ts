/**
 * CLI-compatible sync module — no vscode dependency.
 * Reads config from ~/.forja/servers.json and ~/.forja/projects/<hash>.json (type=sync)
 */
import * as path from 'path';
import * as cp from 'child_process';
import { filterNeedsSync, markSyncedBatch, SyncTargetContext } from '../core/syncState';
import { readProjectSyncConfig, getServerById, getServerByName, ServerConfig } from '../core/serverStore';
import { ensureRemoteDir, scpUpload } from '../core/sshTransport';
import { resolveGitRoots } from '../core/gitRepoResolver';

export interface SyncResult {
    ok: boolean;
    uploaded: string[];
    skipped: string[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
}

export interface SyncPlanResult {
    ok: boolean;
    action: 'sync';
    mode: 'dryRun';
    pending: string[];
    skipped: string[];
    failed: { file: string; error: string }[];
    server: string;
    remotePath: string;
    repos: string[];
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
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: `服务器 "${targetName}" 未找到，请检查 ~/.forja/servers.json` }], server: targetName, remotePath: '' };
    }

    const remotePath = project.remotePaths[server.id] || '';
    if (!remotePath) {
        return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未配置远程路径' }], server: server.name, remotePath: '' };
    }

    // 密码解析（password 模式）
    let resolvedPassword: string | null = null;
    if (server.authMode === 'password') {
        resolvedPassword = await resolveCliPassword(server);
        if (!resolvedPassword) {
            return { ok: false, uploaded: [], skipped: [], failed: [{ file: '', error: '未提供密码。可通过环境变量 FORJA_SSH_PASSWORD 设置，或在 TTY 中交互输入' }], server: server.name, remotePath };
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
        const syncTarget: SyncTargetContext = { serverId: server.id, serverName: server.name, remotePath: repoRemotePath };

        const changedFiles = await getGitChangedFiles(gitDir);
        if (changedFiles.length === 0) { continue; }

        const notIgnored: string[] = [];
        for (const f of changedFiles) {
            if (isIgnored(f, ignore)) { result.skipped.push(`${gitName}/${f}`); }
            else { notIgnored.push(f); }
        }

        const needSync = filterNeedsSync(gitDir, notIgnored, syncTarget);
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
            markSyncedBatch(gitDir, successFiles, syncTarget);
        }
    }

    result.ok = result.failed.length === 0;
    return result;
}

export async function planSyncCli(workspaceRoot: string, serverName?: string, repoFilter?: string): Promise<SyncPlanResult> {
    const project = readProjectSyncConfig(workspaceRoot);
    const empty = (error: string, server = '', remotePath = ''): SyncPlanResult => ({
        ok: false,
        action: 'sync',
        mode: 'dryRun',
        pending: [],
        skipped: [],
        failed: [{ file: '', error }],
        server,
        remotePath,
        repos: []
    });

    if (!project.enabled) {
        return empty('远程同步未启用');
    }

    const targetName = serverName || project.selectedServer;
    const server = getServerById(targetName) || getServerByName(targetName);
    if (!server) {
        return empty(`服务器 "${targetName}" 未找到，请检查 ~/.forja/servers.json`, targetName, '');
    }

    const remotePath = project.remotePaths[server.id] || '';
    if (!remotePath) {
        return empty('未配置远程路径', server.name, '');
    }

    let gitRoots = resolveGitRoots(workspaceRoot);
    if (gitRoots.length === 0) {
        return empty(`未找到 git 仓库: ${workspaceRoot}`, server.name, remotePath);
    }

    if (repoFilter) {
        gitRoots = gitRoots.filter(r => r.name === repoFilter);
        if (gitRoots.length === 0) {
            return empty(`未找到仓库 "${repoFilter}"，可用: ${resolveGitRoots(workspaceRoot).map(r => r.name).join(', ')}`, server.name, remotePath);
        }
    }

    const plan: SyncPlanResult = {
        ok: true,
        action: 'sync',
        mode: 'dryRun',
        pending: [],
        skipped: [],
        failed: [],
        server: server.name,
        remotePath,
        repos: gitRoots.map(r => r.name)
    };

    for (const { dir: gitDir, name: gitName } of gitRoots) {
        const repoRemotePath = remotePath.replace(/\/$/, '') + '/' + gitName;
        const syncTarget: SyncTargetContext = { serverId: server.id, serverName: server.name, remotePath: repoRemotePath };
        const changedFiles = await getGitChangedFiles(gitDir);
        if (changedFiles.length === 0) { continue; }

        const notIgnored: string[] = [];
        for (const f of changedFiles) {
            if (isIgnored(f, project.ignore)) { plan.skipped.push(`${gitName}/${f}`); }
            else { notIgnored.push(f); }
        }

        const needSync = filterNeedsSync(gitDir, notIgnored, syncTarget);
        plan.skipped.push(...notIgnored.filter(f => !needSync.includes(f)).map(f => `${gitName}/${f}`));
        plan.pending.push(...needSync.map(f => `${gitName}/${f}`));
    }

    return plan;
}

export interface SyncCliOptions {
    executionMode: 'dryRun' | 'execute';
    workspace: string;
    server: string | null;
    repo: string | null;
    json: boolean;
}

const syncHelpText = `Forja Sync CLI — 通用远程文件同步

用法: forja sync [options]

选项:
  --workspace <path>     工作区路径（默认当前目录）
  --server <name>        指定服务器名称或 ID
  --repo <name>          指定子仓库名称（多仓库工作区）
  --plan                 仅预览待同步文件，不执行 SSH/SCP
  --dry-run              （兼容旧版，等同于 --plan）
  --json                 输出 JSON 格式（适合 AI 工具解析）
  --help, -h             显示此帮助信息

示例:
  forja sync                         同步变更文件到远程
  forja sync --plan --json           JSON 预览待同步文件
  forja sync --server dev --repo app 同步指定服务器和子仓库
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

export function parseSyncCliArgs(args: string[]): SyncCliOptions {
    const options: SyncCliOptions = {
        executionMode: 'execute',
        workspace: process.cwd(),
        server: null,
        repo: null,
        json: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--plan':
            case '--dry-run':
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
            case '--repo':
                options.repo = readSyncValue(args, i, arg);
                i++;
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

    return options;
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

        if (options.executionMode === 'dryRun') {
            const output = await planSyncCli(workspace, options.server || undefined, options.repo || undefined);
            if (wantsJson) {
                console.log(JSON.stringify(output, null, 2));
            } else if (output.ok) {
                console.log(`Sync (plan): ${output.pending.length} 个文件待同步到 ${output.server}:${output.remotePath}`);
            } else {
                console.log(`Sync (plan) 失败: ${output.failed.map(f => f.error).join(', ')}`);
            }
            process.exitCode = output.ok ? 0 : 1;
            return;
        }

        const result = await executeSyncCli(workspace, options.server || undefined, options.repo || undefined);
        if (wantsJson) {
            console.log(JSON.stringify(result, null, 2));
        } else if (result.ok) {
            console.log(`同步完成: ${result.uploaded.length} 个文件已上传`);
            if (result.skipped.length > 0) { console.log(`跳过: ${result.skipped.length} 个`); }
        } else {
            console.error(`同步失败: ${result.failed.map(f => f.error).join(', ')}`);
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
