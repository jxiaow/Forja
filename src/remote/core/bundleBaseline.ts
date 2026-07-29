import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalRepoPrecheck, RepoBaselineState } from './baseline';
import { RemoteUploader } from './bootstrap';
import { assertStagedRepoMutation, stagedWorkspaceRepoPath } from './stagedWorkspace';
import { RemoteRepoPlan } from './repoStrategy';
import { remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface ExecuteBundleBaselineOptions {
    remotePath?: string;
    stagedWorkspace?: string;
    targetId: string;
    localRepos: LocalRepoPrecheck[];
    repos?: RepoBaselineState[];
    plans?: RemoteRepoPlan[];
    runner: RemoteRunner;
    uploader: RemoteUploader;
}

export interface ExecuteBundleBaselineResult {
    ok: boolean;
    action: 'bundleBaseline';
    mode: 'remote';
    repos: RepoBaselineState[];
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

export async function executeBundleBaseline(options: ExecuteBundleBaselineOptions): Promise<ExecuteBundleBaselineResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    const repos: RepoBaselineState[] = [];
    if (!options.stagedWorkspace || !options.plans) {
        diagnostics.push({ level: 'error', message: 'bundle baseline 缺少 staged workspace 或 repo plan' });
        return finish(repos, diagnostics);
    }

    for (const plan of options.plans.filter(item => item.strategy === 'bundle-fetch' || item.strategy === 'bundle-clone')) {
        const local = options.localRepos.find(item => item.name === plan.localName);
        if (!local || !local.dir || !local.branch || !local.localCommit) {
            diagnostics.push({ level: 'error', message: plan.localName + ' 缺少本地 branch 或 HEAD，无法生成 bundle baseline' });
            repos.push(emptyRepo(plan));
            continue;
        }
        if ((local.behind || 0) > 0) {
            diagnostics.push({ level: 'error', message: plan.localName + ' 本地分支落后或分叉，拒绝用 bundle 覆盖远端 baseline' });
            repos.push(emptyRepo(plan));
            continue;
        }

        const repoPath = plan.remotePath || stagedWorkspaceRepoPath(options.stagedWorkspace, plan.remoteName);
        const mutation = assertStagedRepoMutation({
            stagedWorkspace: options.stagedWorkspace,
            repoPath,
            role: plan.role
        });
        if (!mutation.ok) {
            diagnostics.push({ level: 'error', message: mutation.message });
            repos.push(emptyRepo(plan, repoPath));
            continue;
        }

        const refName = 'refs/forja/baseline/' + safeGitRefSegment(options.targetId) + '/' + safeGitRefSegment(plan.remoteName);
        const bundlePath = path.join(os.tmpdir(), `forja-${safeFileSegment(options.targetId)}-${safeFileSegment(plan.remoteName)}-${local.localCommit.slice(0, 12)}.bundle`);
        const remoteBundle = `.forja/baseline/${options.targetId}/${plan.remoteName}.bundle`;
        try {
            const updateRef = await execGit(local.dir, ['update-ref', refName, local.localCommit]);
            if (updateRef.exitCode !== 0) {
                diagnostics.push({ level: 'error', message: plan.localName + ' bundle ref 创建失败: ' + trim(updateRef.stderr || updateRef.stdout) });
                repos.push(emptyRepo(plan, repoPath));
                continue;
            }

            const bundle = await execGit(local.dir, ['bundle', 'create', bundlePath, refName]);
            if (bundle.exitCode !== 0) {
                diagnostics.push({ level: 'error', message: plan.localName + ' bundle 生成失败: ' + trim(bundle.stderr || bundle.stdout) });
                repos.push(emptyRepo(plan, repoPath));
                continue;
            }

            const mkdir = await options.runner.run('mkdir -p "$HOME/.forja/baseline/' + safeShellPathSegment(options.targetId) + '" ' + remoteCommand([options.stagedWorkspace]), 10000);
            if (mkdir.exitCode !== 0) {
                diagnostics.push({ level: 'error', message: plan.localName + ' 远端 bundle 目录创建失败: ' + trim(mkdir.stderr || mkdir.stdout) });
                repos.push(emptyRepo(plan, repoPath));
                continue;
            }

            await options.uploader.upload(bundlePath, remoteBundle);
            const apply = await options.runner.run(buildApplyBundleCommand(repoPath, refName, local.branch, local.localCommit, remoteBundle), 120000);
            if (apply.exitCode !== 0) {
                diagnostics.push({ level: 'error', message: plan.localName + ' bundle baseline 应用失败: ' + trim(apply.stderr || apply.stdout) });
                repos.push(emptyRepo(plan, repoPath));
                continue;
            }

            repos.push({
                name: plan.remoteName,
                mode: 'git',
                remotePath: extractLastStdoutLine(apply.stdout) || repoPath,
                branch: local.branch,
                localCommit: local.localCommit,
                remoteCommit: local.localCommit,
                commitAligned: true,
                preservedTracked: [],
                unknownUntracked: [],
                diagnostics: []
            });
        } catch (error) {
            diagnostics.push({ level: 'error', message: plan.localName + ' bundle baseline 失败: ' + (error instanceof Error ? error.message : String(error)) });
            repos.push(emptyRepo(plan, repoPath));
        } finally {
            await execGit(local.dir, ['update-ref', '-d', refName]);
            fs.rmSync(bundlePath, { force: true });
        }
    }

    return finish(repos, diagnostics);
}

function finish(repos: RepoBaselineState[], diagnostics: RemoteDiagnostic[]): ExecuteBundleBaselineResult {
    const ok = diagnostics.every(item => item.level !== 'error');
    return {
        ok,
        action: 'bundleBaseline',
        mode: 'remote',
        repos,
        diagnostics,
        nextAction: ok ? undefined : '修复 bundle baseline 诊断后重试'
    };
}

function buildApplyBundleCommand(repoPath: string, refName: string, branch: string, commit: string, remoteBundle: string): string {
    const script = [
        'set -e;',
        'repo_dir=' + remoteCommand([repoPath]) + ';',
        'bundle="$HOME/' + safeShellRelativePath(remoteBundle) + '";',
        'if [ ! -d "$repo_dir/.git" ]; then',
        'mkdir -p "$(dirname "$repo_dir")";',
        'git clone "$bundle" "$repo_dir";',
        'fi;',
        'cd "$repo_dir";',
        'git fetch "$bundle" ' + remoteCommand([refName]) + ';',
        'git checkout -B ' + remoteCommand([branch]) + ' FETCH_HEAD;',
        'git reset --hard ' + remoteCommand([commit]) + ';',
        'pwd -P'
    ];
    return script.join(' ');
}

function emptyRepo(plan: RemoteRepoPlan, remotePath?: string): RepoBaselineState {
    return {
        name: plan.remoteName,
        mode: 'files',
        remotePath,
        preservedTracked: [],
        unknownUntracked: [],
        diagnostics: []
    };
}

function execGit(cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.execFile('git', args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
            resolve({ exitCode: error ? 1 : 0, stdout, stderr });
        });
    });
}

function safeGitRefSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'repo';
}

function safeFileSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'repo';
}

function safeShellPathSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function safeShellRelativePath(value: string): string {
    return value.split('/').map(safeShellPathSegment).join('/');
}

function extractLastStdoutLine(value: string): string {
    const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return lines[lines.length - 1] || '';
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
