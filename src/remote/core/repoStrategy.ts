import { LocalRepoPrecheck, RepoBaselineState } from './baseline';
import { isPathInsideStagedWorkspace, validateStagedRepoName } from './stagedWorkspace';
import { RemoteDiagnostic } from './types';

export type RemoteRepoRole = 'primary' | 'mapped' | 'remote-only' | 'existing-remote' | 'skip';
export type RemoteBaselineStrategy = 'reuse-ready' | 'git-pull' | 'bundle-fetch' | 'bundle-clone' | 'status-only' | 'blocked';
export type RemoteRepoMount = 'symlink';

export interface RemoteRepoMapping {
    localName: string;
    remoteName: string;
    role: RemoteRepoRole;
    remotePath?: string;
    baseline?: 'auto' | 'status-only';
    overlay?: boolean;
    mount?: RemoteRepoMount;
}

export interface PlanRemoteRepositoriesOptions {
    stagedWorkspace: string;
    localRepos: LocalRepoPrecheck[];
    remoteRepos: RepoBaselineState[];
    mappings: RemoteRepoMapping[];
}

export interface RemoteRepoPlan {
    localName: string;
    remoteName: string;
    role: RemoteRepoRole;
    strategy: RemoteBaselineStrategy;
    overlayAllowed: boolean;
    staged: boolean;
    remotePath?: string;
    mount?: RemoteRepoMount;
    diagnostics: RemoteDiagnostic[];
}

export interface RemoteRepoPlanResult {
    ok: boolean;
    repos: RemoteRepoPlan[];
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export function planRemoteRepositories(options: PlanRemoteRepositoriesOptions): RemoteRepoPlanResult {
    const diagnostics: RemoteDiagnostic[] = [];
    const repos: RemoteRepoPlan[] = [];
    const mappedLocalNames = new Set(options.mappings.map(item => item.localName));

    for (const mapping of options.mappings) {
        if (mapping.role === 'skip') { continue; }
        const local = options.localRepos.find(repo => repo.name === mapping.localName);
        const remote = options.remoteRepos.find(repo => repo.name === mapping.remoteName);
        const plan = planMappedRepository(options.stagedWorkspace, mapping, local, remote);
        repos.push(plan);
        diagnostics.push(...plan.diagnostics);
    }

    for (const local of options.localRepos) {
        if (mappedLocalNames.has(local.name)) { continue; }
        const remote = options.remoteRepos.find(repo => repo.name === local.name);
        if (!remote) {
            const message = local.name + ' 未配置 repo 映射，无法匹配远端仓库';
            const plan: RemoteRepoPlan = {
                localName: local.name,
                remoteName: local.name,
                role: 'primary',
                strategy: 'blocked',
                overlayAllowed: false,
                staged: false,
                diagnostics: [{ level: 'error', message }]
            };
            repos.push(plan);
            diagnostics.push(...plan.diagnostics);
            continue;
        }
        const mapping: RemoteRepoMapping = {
            localName: local.name,
            remoteName: remote.name,
            role: 'primary',
            overlay: true
        };
        const plan = planMappedRepository(options.stagedWorkspace, mapping, local, remote);
        repos.push(plan);
        diagnostics.push(...plan.diagnostics);
    }

    const ok = diagnostics.every(item => item.level !== 'error');
    return {
        ok,
        repos,
        diagnostics,
        nextActions: ok ? [] : ['检查 remote repo 映射和 staged workspace 配置']
    };
}

function planMappedRepository(
    stagedWorkspace: string,
    mapping: RemoteRepoMapping,
    local: LocalRepoPrecheck | undefined,
    remote: RepoBaselineState | undefined
): RemoteRepoPlan {
    const diagnostics: RemoteDiagnostic[] = [];
    const remotePath = mapping.remotePath || remote?.remotePath;
    const staged = isStagedRemotePath(stagedWorkspace, remotePath) || (!remotePath && mapping.role !== 'remote-only' && mapping.role !== 'existing-remote');
    const localNameError = validateStagedRepoName(mapping.localName, 'local repo');
    const remoteNameError = validateStagedRepoName(mapping.remoteName, 'remote repo');
    if (localNameError || remoteNameError) {
        if (localNameError) { diagnostics.push({ level: 'error', message: localNameError }); }
        if (remoteNameError) { diagnostics.push({ level: 'error', message: remoteNameError }); }
        return blockedPlan(mapping, remotePath, false, diagnostics);
    }

    if (mapping.role === 'remote-only' || mapping.role === 'existing-remote') {
        const strategy = mapping.role === 'existing-remote' && remote && !remote.missing && remote.commitAligned === false ? 'blocked' : 'status-only';
        if (strategy === 'blocked') {
            diagnostics.push({ level: 'error', message: mapping.remoteName + ' 是非 staged 远端仓库且 baseline 不一致，拒绝覆盖' });
        }
        return {
            localName: mapping.localName,
            remoteName: mapping.remoteName,
            role: mapping.role,
            strategy,
            overlayAllowed: false,
            staged: false,
            remotePath,
            mount: mapping.mount,
            diagnostics
        };
    }

    if (!local) {
        diagnostics.push({ level: 'error', message: mapping.localName + ' 本地仓库不存在，无法执行 remote baseline' });
        return blockedPlan(mapping, remotePath, staged, diagnostics);
    }

    if (!local.ok || (local.behind || 0) > 0 || ((local.ahead || 0) > 0 && (local.behind || 0) > 0)) {
        diagnostics.push(...local.diagnostics);
        diagnostics.push({ level: 'error', message: mapping.localName + ' 本地分支未处于可同步状态，拒绝 remote baseline' });
        return blockedPlan(mapping, remotePath, staged, diagnostics);
    }

    if (!remote || remote.missing) {
        return activePlan(mapping, 'bundle-clone', true, true, remotePath, diagnostics);
    }

    if (remote.commitAligned || (!!local.localCommit && local.localCommit === remote.remoteCommit)) {
        return activePlan(mapping, 'reuse-ready', staged, !!mapping.overlay, remotePath, diagnostics);
    }

    if (!staged) {
        diagnostics.push({ level: 'error', message: mapping.remoteName + ' 是非 staged 远端仓库且 baseline 不一致，拒绝覆盖' });
        return blockedPlan(mapping, remotePath, false, diagnostics);
    }

    if ((local.ahead || 0) > 0 || local.localCommit !== local.upstreamCommit) {
        return activePlan(mapping, 'bundle-fetch', true, !!mapping.overlay, remotePath, diagnostics);
    }

    return activePlan(mapping, 'git-pull', true, !!mapping.overlay, remotePath, diagnostics);
}

function activePlan(
    mapping: RemoteRepoMapping,
    strategy: RemoteBaselineStrategy,
    staged: boolean,
    overlayAllowed: boolean,
    remotePath: string | undefined,
    diagnostics: RemoteDiagnostic[]
): RemoteRepoPlan {
    return {
        localName: mapping.localName,
        remoteName: mapping.remoteName,
        role: mapping.role,
        strategy,
        overlayAllowed,
        staged,
        remotePath,
        mount: mapping.mount,
        diagnostics
    };
}

function blockedPlan(
    mapping: RemoteRepoMapping,
    remotePath: string | undefined,
    staged: boolean,
    diagnostics: RemoteDiagnostic[]
): RemoteRepoPlan {
    return activePlan(mapping, 'blocked', staged, false, remotePath, diagnostics);
}

function isStagedRemotePath(stagedWorkspace: string, remotePath: string | undefined): boolean {
    if (!remotePath) { return false; }
    return isPathInsideStagedWorkspace(stagedWorkspace, remotePath);
}
