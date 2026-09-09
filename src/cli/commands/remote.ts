/**
 * `forja remote` — remote sync configuration and bootstrap.
 */
import * as path from 'path';
import * as cp from 'child_process';
import { ForjaJsonResult, Locale, T } from './types';
import { loadRemoteSettings, saveRemoteSettings } from '../../core/settingsIO';
import { resolveServerSelector, getServerById, readServers, ServerConfig } from '../../core/serverStore';
import { configureSyncSettings } from '../../sync/cli';
import { resolveGitRoots } from '../../core/gitRepoResolver';
import { createSshRunner, remoteCommand } from '../../remote/core/shell';
import { choose } from './prompt';
import { extractFlag, outputResult } from './index';

export type RemoteAction = 'show' | 'setup' | 'on' | 'off' | 'check';

export interface RemoteResult extends ForjaJsonResult {
    action: 'remote';
    remoteAction: RemoteAction;
    changed?: string[];
    message?: string;
    remote?: {
        selectedServer?: string;
        remotePath?: string;
        remoteMode?: boolean;
    };
}

/**
 * Resolve a server for remote commands (bootstrap, check, etc.).
 * Priority: --server flag -> sync selectedServer -> server list (auto or prompt).
 * Returns null and outputs error if no server found.
 */
export async function resolveServer(argv: string[], workroot: string, wantsJson: boolean): Promise<ServerConfig | null> {
    // 1. Check --server flag
    const serverFlag = extractFlag(argv, '--server');
    if (serverFlag) {
        const result = resolveServerSelector(serverFlag);
        if (result.server) return result.server;
        const msg = result.ambiguous
            ? `${T('use.ambiguousServerName')}: ${serverFlag}`
            : `${T('use.serverNotFound')}: ${serverFlag}`;
        outputResult({ ok: false, action: 'remote', remoteAction: 'show', diagnostics: [{ level: 'error', message: msg }], nextAction: 'forja server' }, wantsJson);
        return null;
    }

    // 2. Fall back to sync's selectedServer
    const remote = loadRemoteSettings(workroot);
    if (remote.selectedServer) {
        const server = getServerById(remote.selectedServer);
        if (server) return server;
    }

    // 3. List servers and select
    const servers = readServers();
    if (servers.length === 0) {
        outputResult({
            ok: false, action: 'remote', remoteAction: 'show',
            diagnostics: [{ level: 'error', message: T('remote.noServers') }],
            nextAction: 'forja server add --name <name> --host <host> --username <user>',
        }, wantsJson);
        return null;
    }

    // Single server: auto-select
    if (servers.length === 1) return servers[0];

    // Multiple servers: interactive select (JSON mode returns choices)
    if (wantsJson) {
        outputResult({
            ok: false, action: 'remote', remoteAction: 'show',
            diagnostics: [{ level: 'error', message: T('remote.selectServer') }],
            choices: servers.map(s => ({ label: s.name, command: `forja remote bootstrap --server ${s.name}` })),
        }, wantsJson);
        return null;
    }

    const selected = await choose(T('remote.chooseServer'), servers, s => `${s.name} (${s.host})`);
    if (!selected) {
        outputResult({ ok: false, action: 'remote', remoteAction: 'show', diagnostics: [{ level: 'error', message: T('cancelled') }] }, wantsJson);
        return null;
    }
    return selected;
}

export function formatRemoteText(result: RemoteResult, _locale: Locale): string {
    if (!result.ok) {
        const lines = [T('error'), ...(result.diagnostics ?? []).map(diagnostic => `  ${diagnostic.message}`)];
        if (result.nextAction) {
            lines.push(T('next'), `  ${result.nextAction}`);
        }
        return lines.join('\n');
    }

    if (result.remoteAction === 'on' || result.remoteAction === 'off') {
        const remote = result.remote;
        const serverId = remote?.selectedServer;
        const server = serverId ? getServerById(serverId) : null;
        const serverLabel = server ? `${server.name} (${server.host})` : (serverId || T('remoteNoServerConfigured'));
        const lines: string[] = [];
        if (result.message) {
            lines.push(`  ${result.message}`);
        }
        lines.push(`  ${T('serverLabel')}: ${serverLabel}`);
        if (result.nextAction) {
            lines.push(T('next'), `  ${result.nextAction}`);
        }
        return lines.join('\n');
    }

    const remote = result.remote;
    const lines = [T('remoteLabel')];
    if (!remote?.selectedServer) {
        lines.push(`  ${T('remoteNoServerConfigured')}`);
    } else {
        lines.push(`  ${T('serverLabel')}: ${remote.selectedServer}`);
        if (remote.remotePath) {
            lines.push(`  ${T('remotePathLabel')}: ${remote.remotePath}`);
        }
    }
    if (result.nextAction) {
        lines.push(T('next'), `  ${result.nextAction}`);
    }
    return lines.join('\n');
}

export function runRemoteShow(workspace: string): RemoteResult {
    const remote = loadRemoteSettings(workspace);
    return {
        ok: true,
        action: 'remote',
        remoteAction: 'show',
        workspace,
        changed: [],
        remote: {
            selectedServer: remote.selectedServer,
            remotePath: remote.selectedServer ? remote.remotePaths[remote.selectedServer] : undefined,
        },
    };
}

export interface RemoteSetupArgs {
    server: string;
    remotePath: string;
}

export function runRemoteSetup(workspace: string, args: RemoteSetupArgs): RemoteResult {
    const remotePath = args.remotePath.trim();
    if (!remotePath) {
        return { ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message: 'Remote path is required.' }], nextAction: 'forja sync --server <name> --remote-path <path>' };
    }
    const resolved = resolveServerSelector(args.server);
    if (!resolved.server) {
        const message = resolved.ambiguous
            ? `${T('use.ambiguousServerName')}: ${args.server}. ${T('use.useServerIdInstead')}`
            : `${T('use.serverNotFound')}: ${args.server}`;
        return { ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message }], nextAction: 'forja server' };
    }

    const configured = configureSyncSettings(workspace, {
        serverId: resolved.server.id,
        remotePath,
        enable: true,
    });
    if (!configured.ok) {
        return { ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message: configured.error }], nextAction: 'forja sync' };
    }

    return {
        ok: true,
        action: 'remote',
        remoteAction: 'setup',
        workspace,
        changed: ['remote.selectedServer', 'remote.remotePath', 'sync.enabled'],
        remote: { selectedServer: resolved.server.id, remotePath },
        nextAction: 'forja remote bootstrap',
    };
}

export function runRemoteOn(workspace: string): RemoteResult {
    const remote = loadRemoteSettings(workspace);
    if (remote.remoteMode) {
        return {
            ok: true,
            action: 'remote',
            remoteAction: 'on',
            workspace,
            changed: [],
            message: T('remoteModeAlreadyOn'),
            remote: { remoteMode: true, selectedServer: remote.selectedServer, remotePath: remote.remotePaths[remote.selectedServer] },
        };
    }
    remote.remoteMode = true;
    saveRemoteSettings(workspace, remote);
    return {
        ok: true,
        action: 'remote',
        remoteAction: 'on',
        workspace,
        changed: [],
        message: T('remoteModeOn'),
        remote: { remoteMode: true, selectedServer: remote.selectedServer, remotePath: remote.remotePaths[remote.selectedServer] },
    };
}

export function runRemoteOff(workspace: string): RemoteResult {
    const remote = loadRemoteSettings(workspace);
    if (!remote.remoteMode) {
        return {
            ok: true,
            action: 'remote',
            remoteAction: 'off',
            workspace,
            changed: [],
            message: T('remoteModeAlreadyOff'),
            remote: { remoteMode: false, selectedServer: remote.selectedServer, remotePath: remote.remotePaths[remote.selectedServer] },
        };
    }
    remote.remoteMode = false;
    saveRemoteSettings(workspace, remote);
    return {
        ok: true,
        action: 'remote',
        remoteAction: 'off',
        workspace,
        changed: [],
        message: T('remoteModeOff'),
        remote: { remoteMode: false, selectedServer: remote.selectedServer, remotePath: remote.remotePaths[remote.selectedServer] },
    };
}

// -- Remote check --

export interface RepoCheckInfo {
    name: string;
    localBranch: string;
    localCommit: string;
    remoteBranch: string;
    remoteCommit: string;
    branchMatch: boolean;
    commitMatch: boolean;
    commitRelation: 'ahead' | 'behind' | 'diverged' | '';
    remoteDirty: boolean;
}

export interface RemoteCheckResult extends ForjaJsonResult {
    action: 'remote';
    remoteAction: 'check';
    repos: RepoCheckInfo[];
    server: string;
    remotePath: string;
}

export function formatRemoteCheckText(result: RemoteCheckResult, _locale: Locale): string {
    const lines: string[] = [];

    if (!result.ok && result.repos.length === 0) {
        for (const d of result.diagnostics ?? []) {
            lines.push('  ' + d.level + ': ' + d.message);
        }
        if (result.nextAction) {
            lines.push('');
            lines.push(T('next'), '  ' + result.nextAction);
        }
        return lines.join('\n');
    }

    lines.push(`${T('remoteCheckLabel')} (${result.server})`);
    lines.push('');

    const matched: RepoCheckInfo[] = [];
    const commitMismatch: RepoCheckInfo[] = [];
    const noRemote: RepoCheckInfo[] = [];
    const remoteOnly: RepoCheckInfo[] = [];
    for (const repo of result.repos) {
        if (!repo.localBranch || !repo.localCommit) {
            remoteOnly.push(repo);
        } else if (!repo.remoteBranch || !repo.remoteCommit) {
            noRemote.push(repo);
        } else if (repo.commitMatch && repo.branchMatch) {
            matched.push(repo);
        } else {
            commitMismatch.push(repo);
        }
    }

    const allRepos = [...matched, ...commitMismatch, ...noRemote, ...remoteOnly];
    const nameWidth = allRepos.length > 0 ? Math.max(...allRepos.map(r => r.name.length)) : 4;

    for (const repo of matched) {
        const name = repo.name.padEnd(nameWidth);
        const short = repo.localCommit.slice(0, 7);
        let line = '  \u2713 ' + name + '  ' + repo.localBranch + '  ' + short;
        if (repo.remoteDirty) { line += '  ' + T('remoteCheckDirty'); }
        lines.push(line);
    }

    for (const repo of commitMismatch) {
        const name = repo.name.padEnd(nameWidth);
        const localShort = repo.localCommit.slice(0, 7);
        const remoteShort = repo.remoteCommit.slice(0, 7);
        const branch = repo.branchMatch ? repo.localBranch : repo.localBranch + ' \u2192 ' + repo.remoteBranch;
        let line = '  \u2717 ' + name + '  ' + branch + '  ' + localShort + ' \u2192 ' + remoteShort;
        if (repo.commitRelation) { line += ' (' + T('remoteCheckRelation_' + repo.commitRelation) + ')'; }
        if (repo.remoteDirty) { line += '  ' + T('remoteCheckDirty'); }
        lines.push(line);
    }

    for (const repo of noRemote) {
        const name = repo.name.padEnd(nameWidth);
        lines.push('  - ' + name + '  ' + T('remoteCheckNoRemote'));
    }

    for (const repo of remoteOnly) {
        const name = repo.name.padEnd(nameWidth);
        const remoteShort = repo.remoteCommit.slice(0, 7);
        lines.push('  \u2717 ' + name + '  ' + T('remoteCheckLocalMissing') + '  ' + repo.remoteBranch + '  ' + remoteShort);
    }

    if (allRepos.length > 0) {
        lines.push('');
        const parts: string[] = [];
        if (matched.length) { parts.push(matched.length + ' ' + T('remoteCheckMatched')); }
        if (commitMismatch.length) { parts.push(commitMismatch.length + ' ' + T('remoteCheckCommitMismatch')); }
        if (noRemote.length) { parts.push(noRemote.length + ' ' + T('remoteCheckNoRemoteSummary')); }
        if (remoteOnly.length) { parts.push(remoteOnly.length + ' ' + T('remoteCheckLocalMissingSummary')); }
        lines.push('  ' + parts.join(' / '));
    }

    if (!result.ok && result.nextAction) {
        lines.push('');
        lines.push(T('next'), '  ' + result.nextAction);
    }
    return lines.join('\n');
}

export async function runRemoteCheck(workspace: string): Promise<RemoteCheckResult> {
    const remote = loadRemoteSettings(workspace);
    if (!remote.remoteMode) {
        return { ok: false, action: 'remote', remoteAction: 'check', repos: [], server: '', remotePath: '', diagnostics: [{ level: 'error', message: T('remoteCheckNeedsRemoteMode') }], nextAction: 'forja remote on' };
    }
    const serverId = remote.selectedServer;
    if (!serverId) {
        return { ok: false, action: 'remote', remoteAction: 'check', repos: [], server: '', remotePath: '', diagnostics: [{ level: 'error', message: T('remoteNoServerConfigured') }], nextAction: 'forja sync' };
    }
    const server = getServerById(serverId);
    if (!server) {
        return { ok: false, action: 'remote', remoteAction: 'check', repos: [], server: serverId, remotePath: '', diagnostics: [{ level: 'error', message: `${T('use.serverNotFound')}: ${serverId}` }] };
    }
    const remotePath = remote.remotePaths[serverId];
    if (!remotePath) {
        return { ok: false, action: 'remote', remoteAction: 'check', repos: [], server: server.name || serverId, remotePath: '', diagnostics: [{ level: 'error', message: T('remotePathNotConfigured') }] };
    }

    const localRepos = resolveGitRoots(workspace);
    if (localRepos.length === 0) {
        return { ok: false, action: 'remote', remoteAction: 'check', repos: [], server: server.name || serverId, remotePath, diagnostics: [{ level: 'error', message: 'No git repos found in workspace' }] };
    }

    const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
    const runner = createSshRunner(server, password);

    const repos: RepoCheckInfo[] = [];
    for (const repo of localRepos) {
        const localBranch = runGitSync(repo.dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
        const localCommit = runGitSync(repo.dir, 'rev-parse', 'HEAD').trim();

        const relDir = path.relative(workspace, repo.dir).replace(/\\/g, '/');
        const repoRemotePath = relDir ? `${remotePath}/${relDir}` : remotePath;

        const branchResult = await runner.run(`cd ${remoteCommand([repoRemotePath])} && git rev-parse --abbrev-ref HEAD 2>/dev/null`, 10000);
        const remoteBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : '';

        const commitResult = await runner.run(`cd ${remoteCommand([repoRemotePath])} && git rev-parse HEAD 2>/dev/null`, 10000);
        const remoteCommit = commitResult.exitCode === 0 ? commitResult.stdout.trim() : '';

        const dirtyResult = await runner.run(`cd ${remoteCommand([repoRemotePath])} && git status --porcelain 2>/dev/null`, 10000);
        const remoteDirty = dirtyResult.exitCode === 0 && dirtyResult.stdout.trim().length > 0;

        // Determine commit relation direction
        let commitRelation: 'ahead' | 'behind' | 'diverged' | '' = '';
        if (remoteCommit && localCommit !== remoteCommit) {
            // Fetch remote commit locally for comparison
            runGitSync(repo.dir, 'fetch', 'origin', '--depth=1', remoteCommit, '--no-tags', '-q');
            const isLocalAhead = runGitSync(repo.dir, 'merge-base', '--is-ancestor', remoteCommit, localCommit);
            const isRemoteAhead = runGitSync(repo.dir, 'merge-base', '--is-ancestor', localCommit, remoteCommit);
            if (isLocalAhead === '' && runGitSync(repo.dir, 'cat-file', '-t', remoteCommit).trim() === 'commit') {
                commitRelation = 'ahead';
            } else if (isRemoteAhead === '') {
                commitRelation = 'behind';
            } else {
                commitRelation = 'diverged';
            }
        }

        repos.push({
            name: repo.name,
            localBranch,
            localCommit,
            remoteBranch,
            remoteCommit,
            branchMatch: localBranch === remoteBranch,
            commitMatch: localCommit === remoteCommit,
            commitRelation,
            remoteDirty,
        });
    }

    const allMatch = repos.every(r => r.branchMatch && r.commitMatch);

    // Discover remote-only repos (exist on remote but not locally)
    const localRepoNames = new Set(repos.map(r => r.name));
    const remoteRepoList = await runner.run(
        `cd ${remoteCommand([remotePath])} && find . -maxdepth 2 -name .git -type d 2>/dev/null | sed 's|^\\./||;s|/.git$||' | sort`,
        15000
    );
    if (remoteRepoList.exitCode === 0 && remoteRepoList.stdout.trim()) {
        const remoteRepoDirs = remoteRepoList.stdout.trim().split(/\r?\n/).filter(Boolean);
        for (const dir of remoteRepoDirs) {
            const repoName = dir === '.' ? path.basename(remotePath) : path.basename(dir);
            if (localRepoNames.has(repoName)) { continue; }
            const repoRemotePath = dir === '.' ? remotePath : `${remotePath}/${dir}`;
            const branchResult = await runner.run(`cd ${remoteCommand([repoRemotePath])} && git rev-parse --abbrev-ref HEAD 2>/dev/null`, 10000);
            const remoteBranch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : '';
            const commitResult = await runner.run(`cd ${remoteCommand([repoRemotePath])} && git rev-parse HEAD 2>/dev/null`, 10000);
            const remoteCommit = commitResult.exitCode === 0 ? commitResult.stdout.trim() : '';
            repos.push({
                name: repoName,
                localBranch: '',
                localCommit: '',
                remoteBranch,
                remoteCommit,
                branchMatch: false,
                commitMatch: false,
                commitRelation: '',
                remoteDirty: false,
            });
        }
    }

    const finalMatch = repos.every(r => r.branchMatch && r.commitMatch);
    return {
        ok: finalMatch,
        action: 'remote',
        remoteAction: 'check',
        repos,
        server: server.name || serverId,
        remotePath,
        nextAction: finalMatch ? undefined : 'forja sync',
    };
}

function runGitSync(cwd: string, ...args: string[]): string {
    try {
        return cp.execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
        return '';
    }
}
