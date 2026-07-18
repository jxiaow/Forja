import * as cp from 'child_process';
import { resolveGitRoots } from '../../core/gitRepoResolver';
import { buildRemoteRepoDirSetup } from './repoPath';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface GitCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface GitRunner {
    exec(cwd: string, args: string[]): Promise<GitCommandResult>;
}

export interface LocalRepoPrecheck {
    name: string;
    dir: string;
    branch?: string;
    upstream?: string;
    localCommit?: string;
    upstreamCommit?: string;
    ahead?: number;
    behind?: number;
    ok: boolean;
    diagnostics: RemoteDiagnostic[];
}

export interface InspectLocalRepositoriesOptions {
    workspace: string;
    git?: GitRunner;
    allowUnpushed?: boolean;
}

export interface InspectLocalRepositoriesResult {
    ok: boolean;
    repos: LocalRepoPrecheck[];
    diagnostics: RemoteDiagnostic[];
}

export interface RemoteRepoProbeInput {
    name: string;
}

export interface RepoBaselineState {
    name: string;
    remoteName?: string;
    mode: 'git' | 'files';
    remotePath?: string;
    missing?: boolean;
    branch?: string;
    upstream?: string;
    localCommit?: string;
    upstreamCommit?: string;
    remoteCommit?: string;
    commitAligned?: boolean;
    preservedTracked: string[];
    unknownUntracked: string[];
    diagnostics: RemoteDiagnostic[];
}

export interface InspectRemoteRepositoriesOptions {
    remotePath: string;
    repos: RemoteRepoProbeInput[];
    runner: RemoteRunner;
}

export interface InspectRemoteRepositoriesResult {
    ok: boolean;
    repos: RepoBaselineState[];
    diagnostics: RemoteDiagnostic[];
}

export interface BuildRemoteBaselineStatusOptions extends InspectLocalRepositoriesOptions {
    remotePath: string;
    runner: RemoteRunner;
    remoteRepoNames?: string[];
    localNameByRemoteName?: Record<string, string>;
}

export interface BuildRemoteBaselineStatusResult {
    ok: boolean;
    overall: 'ready' | 'degraded' | 'blocked';
    repos: RepoBaselineState[];
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

export async function inspectLocalRepositories(options: InspectLocalRepositoriesOptions): Promise<InspectLocalRepositoriesResult> {
    const git = options.git || defaultGitRunner();
    const roots = resolveGitRoots(options.workspace);
    const diagnostics: RemoteDiagnostic[] = [];
    if (roots.length === 0) {
        diagnostics.push({ level: 'error', message: '未找到 git 仓库: ' + options.workspace });
        return { ok: false, repos: [], diagnostics };
    }

    const repos: LocalRepoPrecheck[] = [];
    for (const root of roots) {
        const repoDiagnostics: RemoteDiagnostic[] = [];
        const branchResult = await git.exec(root.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const headResult = await git.exec(root.dir, ['rev-parse', 'HEAD']);
        const branchText = branchResult.stdout.trim();
        const head = headResult.stdout.trim();
        const repo: LocalRepoPrecheck = {
            name: root.name,
            dir: root.dir,
            localCommit: head || undefined,
            ok: true,
            diagnostics: repoDiagnostics
        };

        if (branchResult.exitCode !== 0 || branchText === 'HEAD' || !branchText) {
            repo.ok = false;
            repoDiagnostics.push({ level: 'error', message: root.name + ' 处于 detached HEAD，remote branchSync 需要命名分支' });
        } else {
            repo.branch = branchText;
        }
        if (headResult.exitCode !== 0 || !head) {
            repo.ok = false;
            repoDiagnostics.push({ level: 'error', message: root.name + ' 无法读取本地 HEAD' });
        }

        const upstreamName = await git.exec(root.dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
        if (upstreamName.exitCode !== 0 || !upstreamName.stdout.trim()) {
            repo.ok = false;
            repoDiagnostics.push({ level: 'error', message: root.name + ' 当前分支没有 upstream，无法确认远端可拉取 baseline' });
        } else {
            repo.upstream = upstreamName.stdout.trim();
        }

        const upstreamCommit = await git.exec(root.dir, ['rev-parse', '@{u}']);
        if (upstreamCommit.exitCode !== 0 || !upstreamCommit.stdout.trim()) {
            repo.ok = false;
            repoDiagnostics.push({ level: 'error', message: root.name + ' 无法读取 upstream commit' });
        } else {
            repo.upstreamCommit = upstreamCommit.stdout.trim();
        }

        const aheadBehind = await git.exec(root.dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
        if (aheadBehind.exitCode !== 0) {
            repo.ok = false;
            repoDiagnostics.push({ level: 'error', message: root.name + ' 无法比较本地 HEAD 与 upstream' });
        } else {
            const [ahead, behind] = aheadBehind.stdout.trim().split(/\s+/).map(value => Number(value));
            repo.ahead = Number.isFinite(ahead) ? ahead : 0;
            repo.behind = Number.isFinite(behind) ? behind : 0;
            if ((repo.ahead || 0) > 0 && (repo.behind || 0) > 0) {
                repo.ok = false;
                repoDiagnostics.push({ level: 'error', message: root.name + ' 本地分支与 upstream 分叉，remote baseline 不可确定' });
            } else if ((repo.ahead || 0) > 0 && !options.allowUnpushed) {
                repo.ok = false;
                repoDiagnostics.push({ level: 'error', message: root.name + ' 本地 HEAD 未 push 到 upstream，远端无法拉取该 baseline' });
            } else if ((repo.behind || 0) > 0) {
                repo.ok = false;
                repoDiagnostics.push({ level: 'error', message: root.name + ' 本地分支落后 upstream，请先在本地拉取后再执行 remote' });
            }
        }

        repos.push(repo);
        diagnostics.push(...repoDiagnostics);
    }

    return { ok: diagnostics.every(item => item.level !== 'error'), repos, diagnostics };
}

export async function inspectRemoteRepositories(options: InspectRemoteRepositoriesOptions): Promise<InspectRemoteRepositoriesResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    const repos: RepoBaselineState[] = [];
    const singleRepo = options.repos.length === 1;
    for (const repo of options.repos) {
        const command = buildRemoteRepoInspectCommand(options.remotePath, repo.name, singleRepo);
        const executed = await options.runner.run(command, 10000);
        if (executed.exitCode !== 0) {
            const message = trim(executed.stderr) || repo.name + ' 远端仓库探测失败';
            const repoState = emptyRepoState(repo.name, 'files');
            repoState.diagnostics.push({ level: 'error', message });
            repos.push(repoState);
            diagnostics.push({ level: 'error', message });
            continue;
        }
        const parsed = parseRemoteRepoProbe(repo.name, executed.stdout);
        repos.push(parsed);
        diagnostics.push(...parsed.diagnostics);
    }
    return { ok: diagnostics.every(item => item.level !== 'error'), repos, diagnostics };
}

export async function buildRemoteBaselineStatus(options: BuildRemoteBaselineStatusOptions): Promise<BuildRemoteBaselineStatusResult> {
    const local = await inspectLocalRepositories({ workspace: options.workspace, git: options.git, allowUnpushed: options.allowUnpushed });
    if (local.repos.length === 0) {
        return { ok: false, overall: 'blocked', repos: [], diagnostics: local.diagnostics, nextAction: '检查本地 workspace git 仓库' };
    }

    const remote = await inspectRemoteRepositories({
        remotePath: options.remotePath,
        repos: (options.remoteRepoNames && options.remoteRepoNames.length > 0 ? options.remoteRepoNames : local.repos.map(repo => repo.name))
            .map(name => ({ name })),
        runner: options.runner
    });

    const diagnostics: RemoteDiagnostic[] = [...local.diagnostics, ...remote.diagnostics];
    const repos = remote.repos.map(remoteRepo => {
        const localName = options.localNameByRemoteName?.[remoteRepo.name] || remoteRepo.name;
        const localRepo = local.repos.find(repo => repo.name === localName);
        const merged: RepoBaselineState = {
            ...remoteRepo,
            branch: localRepo?.branch,
            upstream: localRepo?.upstream,
            localCommit: localRepo?.localCommit,
            upstreamCommit: localRepo?.upstreamCommit
        };
        if (remoteRepo.mode === 'git') {
            const localHead = localRepo?.localCommit;
            const upstreamHead = localRepo?.upstreamCommit;
            const remoteHead = remoteRepo.remoteCommit;
            const headMatch = !!localHead && localHead === remoteHead;
            const upstreamMatch = options.allowUnpushed && !!upstreamHead && !!remoteHead && upstreamHead === remoteHead;
            merged.commitAligned = headMatch || upstreamMatch;
            if (!merged.commitAligned) {
                diagnostics.push({ level: 'error', message: remoteRepo.name + ' commit 不一致: local=' + (localHead || 'unknown') + ', remote=' + (remoteHead || 'unknown') });
            }
        }
        if (remoteRepo.mode === 'files' && !remoteRepo.missing) {
            diagnostics.push({ level: 'warning', message: remoteRepo.name + ' 远端为 files-only，跳过 git baseline 对齐' });
        }
        return merged;
    });

    const hasError = diagnostics.some(item => item.level === 'error');
    const hasWarning = diagnostics.some(item => item.level === 'warning') || repos.some(repo => repo.mode === 'files');
    return {
        ok: !hasError,
        overall: hasError ? 'blocked' : hasWarning ? 'degraded' : 'ready',
        repos,
        diagnostics,
        nextAction: hasError ? '修复 baseline 诊断后重试' : undefined
    };
}

function buildRemoteRepoInspectCommand(remotePath: string, repoName: string, singleRepo: boolean): string {
    return [
        buildRemoteRepoDirSetup(remotePath, repoName, singleRepo),
        'printf "path:%s\\n" "$repo_dir";',
        'if [ -d "$repo_dir/.git" ]; then',
        'cd "$repo_dir" && printf "mode:git\\n" && printf "commit:" && git rev-parse HEAD && printf "status:\\n" && git status --porcelain -uall;',
        'elif [ -d "$repo_dir" ]; then printf "mode:files\\n";',
        'else printf "mode:files\\nmissing:true\\n";',
        'fi'
    ].join(' ');
}

function parseRemoteRepoProbe(name: string, stdout: string): RepoBaselineState {
    const lines = stdout.split(/\r?\n/);
    const modeLine = lines.find(line => line.startsWith('mode:'));
    const mode = modeLine && modeLine.trim() === 'mode:git' ? 'git' : 'files';
    const state = emptyRepoState(name, mode);
    const pathLine = lines.find(line => line.startsWith('path:'));
    if (pathLine) {
        state.remotePath = pathLine.slice('path:'.length).trim() || undefined;
    }
    if (lines.some(line => line.trim() === 'missing:true')) {
        state.missing = true;
        state.diagnostics.push({ level: 'error', message: name + ' 远端仓库不存在: ' + (state.remotePath || 'unknown') });
    }
    const commitLine = lines.find(line => line.startsWith('commit:'));
    if (commitLine) {
        state.remoteCommit = commitLine.slice('commit:'.length).trim() || undefined;
    }
    const statusIndex = lines.findIndex(line => line === 'status:');
    if (statusIndex >= 0) {
        for (const line of lines.slice(statusIndex + 1)) {
            if (!line.trim()) { continue; }
            const parsed = parsePorcelainPath(line);
            if (!parsed) { continue; }
            if (line.startsWith('?? ')) {
                state.unknownUntracked.push(parsed);
            } else if (!line.startsWith('!! ')) {
                state.preservedTracked.push(parsed);
            }
        }
    }
    return state;
}

function parsePorcelainPath(line: string): string | null {
    const raw = line.length > 3 ? line.slice(3).trim() : '';
    if (!raw) { return null; }
    const renameArrow = ' -> ';
    const idx = raw.indexOf(renameArrow);
    return idx >= 0 ? raw.slice(idx + renameArrow.length) : raw;
}

function emptyRepoState(name: string, mode: 'git' | 'files'): RepoBaselineState {
    return { name, mode, preservedTracked: [], unknownUntracked: [], diagnostics: [] };
}

function defaultGitRunner(): GitRunner {
    return {
        exec(cwd: string, args: string[]): Promise<GitCommandResult> {
            return new Promise(resolve => {
                cp.execFile('git', args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
                    resolve({ exitCode: error ? 1 : 0, stdout, stderr });
                });
            });
        }
    };
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
