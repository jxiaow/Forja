import { loadRemoteSettings, RemoteBuildOrderItem, RemoteRepoSettings } from '../../core/settingsIO';
import { GitRunner, buildRemoteBaselineStatus, inspectLocalRepositories, RepoBaselineState } from './baseline';
import { executeRemoteBridge, RemoteBridgeAction, RemoteBridgeTarget } from './bridge';
import { RemoteUploader } from './bootstrap';
import { executeRemoteBranchSync } from './branchSync';
import { executeBundleBaseline } from './bundleBaseline';
import { executeRemoteAcquireLock, executeRemoteReleaseLock, RemoteLockMetadata } from './lock';
import { buildStagedWorkspacePrepareCommand, stagedWorkspaceRepoPath } from './stagedWorkspace';
import { buildLocalOverlayPlan, executeRemoteOverlaySync, LocalOverlayAssetMapping, mergeAssetOverlayPlan } from './overlaySync';
import { executeRemoteOverlayRestore } from './overlayRestore';
import { executeRemoteShellFallback, supportsRemoteShellFallback } from './remoteShellFallback';
import { planRemoteRepositories, RemoteRepoMapping, RemoteRepoPlan } from './repoStrategy';
import { RemoteDiagnostic, RemoteRunner, RemoteStage } from './types';
import { executeWorkspaceLinks } from './workspaceLink';

export interface PrepareRemoteWorkspaceOptions {
    workspace: string;
    remotePath: string;
    ignore: string[];
    owner: string;
    runner: RemoteRunner;
    uploader: RemoteUploader;
    git?: GitRunner;
    releaseAfterPrepare?: boolean;
}

export interface ExecutePreparedRemoteActionOptions extends PrepareRemoteWorkspaceOptions {
    target: RemoteBridgeTarget;
    action: RemoteBridgeAction;
    args: string[];
    json: boolean;
    stream?: boolean;
    buildOrder?: RemoteBuildOrderItem[];
    /** Active target project path (relative to workspace) — synced to remote before action */
    activeProject?: string;
}

export type ExecutePreparedRemoteActionResult = Omit<PrepareRemoteWorkspaceResult, 'action'> & {
    action: 'preparedAction';
    remote?: Awaited<ReturnType<typeof executeRemoteBridge>>;
    remoteActions?: Array<Awaited<ReturnType<typeof executeRemoteBridge>>>;
};

export interface PrepareRemoteWorkspaceResult {
    ok: boolean;
    action: 'prepareWorkspace';
    mode: 'remote';
    actionRemotePath?: string;
    failedStage?: string;
    lock?: RemoteLockMetadata;
    repos: RepoBaselineState[];
    stages: RemoteStage[];
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

export async function prepareRemoteWorkspace(options: PrepareRemoteWorkspaceOptions): Promise<PrepareRemoteWorkspaceResult> {
    const stages: RemoteStage[] = [];
    const diagnostics: RemoteDiagnostic[] = [];
    let repos: RepoBaselineState[] = [];
    const releaseAfterPrepare = options.releaseAfterPrepare ?? true;
    const remoteSettings = loadRemoteSettings(options.workspace);
    const stagedMode = remoteSettings.workspaceMode === 'staged';
    const workspaceRemotePath = stagedMode && remoteSettings.remoteWorkspace ? remoteSettings.remoteWorkspace : options.remotePath;
    let repoPlans: RemoteRepoPlan[] = [];

    const fail = (stage: string, nextAction?: string, lock?: RemoteLockMetadata): PrepareRemoteWorkspaceResult => ({
        ok: false,
        action: 'prepareWorkspace',
        mode: 'remote',
        actionRemotePath: stagedMode ? resolvePrimaryActionPath(workspaceRemotePath, repoPlans) : workspaceRemotePath,
        failedStage: stage,
        lock,
        repos,
        stages,
        diagnostics,
        nextAction: nextAction || '修复 remote prepare 诊断后重试'
    });

    const local = stagedMode ? await inspectLocalRepositories({ workspace: options.workspace, git: options.git, allowUnpushed: true }) : undefined;
    const baseline = await buildRemoteBaselineStatus({
        workspace: options.workspace,
        remotePath: workspaceRemotePath,
        runner: options.runner,
        git: options.git,
        allowUnpushed: stagedMode,
        ...(stagedMode ? stagedBaselineProbe(local?.repos || [], remoteSettings.repos) : {})
    });
    repos = baseline.repos;
    if (stagedMode) {
        const plan = planRemoteRepositories({
            stagedWorkspace: workspaceRemotePath,
            localRepos: local?.repos || [],
            remoteRepos: baseline.repos,
            mappings: toRemoteRepoMappings(remoteSettings.repos)
        });
        repoPlans = plan.repos;
        diagnostics.push(...(local?.diagnostics || []).filter(item => item.level === 'error'));
        diagnostics.push(...plan.diagnostics);
        stages.push({ stage: 'baselinePlan', ok: plan.ok, message: plan.ok ? plan.repos.map(repo => repo.strategy).join(',') : 'blocked' });
        if (!plan.ok) {
            return fail('baselinePlan', plan.nextAction);
        }
    } else {
        stages.push({ stage: 'baselinePrecheck', ok: baseline.ok, message: baseline.overall });
        diagnostics.push(...baseline.diagnostics);
        if (!baseline.ok) {
            return fail('baselinePrecheck', baseline.nextAction);
        }
    }

    const lockResult = await executeRemoteAcquireLock({
        remotePath: workspaceRemotePath,
        owner: options.owner,
        stage: 'prepare',
        repos: stagedMode ? repoPlans.map(repo => repo.remoteName) : repos.map(repo => repo.name),
        workspace: options.workspace,
        runner: options.runner
    });
    diagnostics.push(...lockResult.diagnostics);
    const lock = lockResult.lock;
    stages.push({ stage: 'acquireLock', ok: lockResult.ok, message: lockResult.acquired ? lockResult.lock?.lockId : lockResult.diagnostics[0]?.message });
    if (!lockResult.ok || !lock?.lockId) {
        return fail('acquireLock', undefined, lock);
    }
    const failWithLock = (stage: string, nextAction?: string): PrepareRemoteWorkspaceResult => fail(stage, nextAction, lock);

    let result: PrepareRemoteWorkspaceResult | undefined;
    try {
        if (stagedMode) {
            const prepare = await options.runner.run(buildStagedWorkspacePrepareCommand({
                stagedWorkspace: workspaceRemotePath,
                serverId: options.owner,
                workspaceId: lockResult.targetId,
                repos: repoPlans.filter(repo => repo.staged).map(repo => repo.remoteName)
            }), 10000);
            diagnostics.push(...(prepare.exitCode === 0 ? [] : [{ level: 'error' as const, message: prepare.stderr || 'staged workspace prepare 失败' }]));
            stages.push({ stage: 'stagedWorkspacePrepare', ok: prepare.exitCode === 0, message: prepare.exitCode === 0 ? 'ready' : prepare.stderr });
            if (prepare.exitCode !== 0) {
                result = failWithLock('stagedWorkspacePrepare');
                return result;
            }

            const overlayRestore = await executeRemoteOverlayRestore({
                targetId: lockResult.targetId,
                repos: repoPlans
                    .filter(repo => repo.overlayAllowed)
                    .map(repo => ({ name: repo.localName, remotePath: repoPathForPlan(workspaceRemotePath, repo) })),
                runner: options.runner
            });
            diagnostics.push(...overlayRestore.diagnostics);
            if (!overlayRestore.ok) {
                stages.push({ stage: 'overlaySync', ok: false, message: 'overlay restore failed' });
                result = failWithLock('overlaySync', '修复 overlay restore 诊断后重试');
                return result;
            }

            const branchRepos = repos.filter(repo => repoPlans.some(plan => plan.remoteName === repo.name && plan.strategy === 'git-pull'));
            if (branchRepos.length > 0) {
                const branchSync = await executeRemoteBranchSync({ remotePath: workspaceRemotePath, targetId: lockResult.targetId, repos: branchRepos, runner: options.runner });
                diagnostics.push(...branchSync.diagnostics);
                stages.push({ stage: 'branchSync', ok: branchSync.ok, message: 'git' });
                if (!branchSync.ok) {
                    result = failWithLock('branchSync', branchSync.nextAction);
                    return result;
                }
            }

            const bundlePlans = repoPlans.filter(plan => plan.strategy === 'bundle-fetch' || plan.strategy === 'bundle-clone');
            if (bundlePlans.length > 0) {
                const bundle = await executeBundleBaseline({ stagedWorkspace: workspaceRemotePath, targetId: lockResult.targetId, localRepos: local?.repos || [], plans: bundlePlans, runner: options.runner, uploader: options.uploader });
                diagnostics.push(...bundle.diagnostics);
                repos = mergeBundleRepos(repos, bundle.repos);
                stages.push({ stage: 'bundleBaseline', ok: bundle.ok, message: 'bundle' });
                if (!bundle.ok) {
                    result = failWithLock('bundleBaseline', bundle.nextAction);
                    return result;
                }
            }

            const links = await executeWorkspaceLinks({ stagedWorkspace: workspaceRemotePath, plans: repoPlans, runner: options.runner });
            diagnostics.push(...links.diagnostics);
            stages.push({ stage: 'workspaceLink', ok: links.ok, message: links.linked.join(',') || 'none' });
            if (!links.ok) {
                result = failWithLock('workspaceLink', links.nextAction);
                return result;
            }
        } else {
            const branchSync = await executeRemoteBranchSync({ remotePath: workspaceRemotePath, targetId: lockResult.targetId, repos, runner: options.runner });
            diagnostics.push(...branchSync.diagnostics);
            stages.push({ stage: 'branchSync', ok: branchSync.ok, message: 'git' });
            if (!branchSync.ok) {
                result = failWithLock('branchSync', branchSync.nextAction);
                return result;
            }
        }

        const overlayPlan = await buildLocalOverlayPlan({ workspace: options.workspace, ignore: options.ignore, git: options.git });
        let effectiveOverlayPlan = stagedMode ? {
            ...overlayPlan,
            repos: overlayPlan.repos.filter(repo => repoPlans.some(plan => plan.localName === repo.name && plan.overlayAllowed))
        } : overlayPlan;
        if (stagedMode) {
            effectiveOverlayPlan = mergeAssetOverlayPlan(effectiveOverlayPlan, toLocalOverlayAssets(remoteSettings.repos, local?.repos || [], repoPlans));
        }
        diagnostics.push(...effectiveOverlayPlan.diagnostics);
        if (!effectiveOverlayPlan.ok) {
            stages.push({ stage: 'overlaySync', ok: false, message: 'overlay plan failed' });
            result = failWithLock('overlaySync');
            return result;
        }
        const repoRemotePaths = stagedMode
            ? Object.fromEntries(repoPlans
                .filter(repo => repo.overlayAllowed)
                .map(repo => [repo.localName, repoPathForPlan(workspaceRemotePath, repo)]))
            : Object.fromEntries(baseline.repos.filter(repo => repo.remotePath).map(repo => [repo.name, repo.remotePath as string]));
        const overlaySync = await executeRemoteOverlaySync({ remotePath: workspaceRemotePath, targetId: lockResult.targetId, plan: effectiveOverlayPlan, repoRemotePaths, runner: options.runner, uploader: options.uploader });
        diagnostics.push(...overlaySync.diagnostics);
        stages.push({ stage: 'overlaySync', ok: overlaySync.ok });
        if (!overlaySync.ok) {
            result = failWithLock('overlaySync', overlaySync.nextAction);
            return result;
        }

        const postBaseline = await buildRemoteBaselineStatus({
            workspace: options.workspace,
            remotePath: workspaceRemotePath,
            runner: options.runner,
            git: options.git,
            allowUnpushed: stagedMode,
            ...(stagedMode ? stagedBaselineProbe(local?.repos || [], remoteSettings.repos) : {})
        });
        repos = postBaseline.repos;
        diagnostics.push(...postBaseline.diagnostics);
        stages.push({ stage: 'baselineCheck', ok: postBaseline.ok, message: postBaseline.overall });
        if (!postBaseline.ok) {
            result = failWithLock('baselineCheck', postBaseline.nextAction);
            return result;
        }

        result = {
            ok: true,
            action: 'prepareWorkspace',
            mode: 'remote',
            actionRemotePath: stagedMode ? resolvePrimaryActionPath(workspaceRemotePath, repoPlans) : workspaceRemotePath,
            lock,
            repos,
            stages,
            diagnostics
        };
        return result;
    } finally {
        if (releaseAfterPrepare || !result?.ok) {
            const release = await executeRemoteReleaseLock({ remotePath: workspaceRemotePath, lockId: lock.lockId, runner: options.runner });
            diagnostics.push(...release.diagnostics);
            stages.push({ stage: 'releaseLock', ok: release.ok, message: release.removed ? 'removed' : release.diagnostics[0]?.message });
            if (result) {
                result.stages = stages;
                result.diagnostics = diagnostics;
                if (!release.ok) {
                    result.ok = false;
                    result.failedStage = result.failedStage || 'releaseLock';
                    result.nextAction = '手动检查或 unlock 远端 lock';
                }
            }
        }
    }
}


export async function executePreparedRemoteAction(options: ExecutePreparedRemoteActionOptions): Promise<ExecutePreparedRemoteActionResult> {
    const actions = selectRemoteActions(options);
    const readinessTargets = [...new Set(actions.map(item => item.target))];
    const remoteSettings = loadRemoteSettings(options.workspace);
    const stagedMode = remoteSettings.workspaceMode === 'staged';
    const workspaceRemotePath = stagedMode && remoteSettings.remoteWorkspace ? remoteSettings.remoteWorkspace : options.remotePath;
    const remoteForjaBin = remoteSettings.remoteForjaBin || undefined;

    // Build args: include --project for target-aware commands so remote forja knows which project
    const extraArgs: string[] = [];
    if (options.activeProject && ['build', 'rebuild', 'clean', 'run', 'qmake'].includes(options.action)) {
        extraArgs.push('--project', options.activeProject);
    }

    if (!stagedMode && !options.activeProject) {
        const readinessFailure = await runTargetReadiness(readinessTargets, workspaceRemotePath, options.runner, remoteForjaBin);
        if (readinessFailure) { return readinessFailure; }
    }

    const prepared = await prepareRemoteWorkspace({ ...options, releaseAfterPrepare: false });
    const base: ExecutePreparedRemoteActionResult = { ...prepared, action: 'preparedAction' };
    if (!prepared.ok) {
        return base;
    }
    const actionRemotePath = prepared.actionRemotePath || workspaceRemotePath;
    if (!stagedMode) {
        base.stages.unshift({ stage: 'targetReadiness', ok: true, message: readinessTargets.join(',') });
    }

    try {
        if (stagedMode && !options.activeProject) {
            const readinessFailure = await runTargetReadiness(readinessTargets, actionRemotePath, options.runner, remoteForjaBin);
            if (readinessFailure) {
                if (isRemoteForjaUnavailable(readinessFailure.remote)) {
                    base.diagnostics.push({ level: 'warning', message: 'remote forja 不可用，后续尝试 shell fallback' });
                    base.stages.push({ stage: 'targetReadiness', ok: true, message: 'shell fallback' });
                } else {
                    // Only add readiness-specific stages and diagnostics, not the combined ones
                    const readinessOnlyStages = readinessFailure.stages.filter(s =>
                        !base.stages.some(bs => bs.stage === s.stage && bs.message === s.message)
                    );
                    const readinessOnlyDiagnostics = readinessFailure.diagnostics.filter(d =>
                        !base.diagnostics.some(bd => bd.message === d.message && bd.level === d.level)
                    );
                    base.ok = false;
                    base.failedStage = 'targetReadiness';
                    base.diagnostics.push(...readinessOnlyDiagnostics);
                    base.stages.push(...readinessOnlyStages);
                    base.nextAction = readinessFailure.nextAction;
                    return base;
                }
            }
            if (!base.stages.some(stage => stage.stage === 'targetReadiness')) {
                base.stages.push({ stage: 'targetReadiness', ok: true, message: readinessTargets.join(',') });
            }
        }

        base.remoteActions = [];

        for (const action of actions) {
            const remote = await executeRemoteBridge({
                target: action.target,
                action: action.action,
                args: [...extraArgs, ...action.args],
                json: options.json,
                stream: actions.length === 1 ? options.stream : false,
                remotePath: actionRemotePath,
                remoteForjaBin,
                runner: options.runner
            });
            if (!remote.ok && stagedMode && isRemoteForjaUnavailable(remote) && supportsRemoteShellFallback(action.target, action.action)) {
                const fallback = await executeRemoteShellFallback({
                    target: action.target,
                    action: action.action,
                    args: action.args,
                    remotePath: actionRemotePath,
                    runner: options.runner
                });
                base.remote = fallback;
                base.remoteActions.push(fallback);
                base.stages.push({ stage: 'remoteShellFallback', ok: fallback.ok, message: action.target + ':' + action.action });
                base.diagnostics.push(...fallback.diagnostics);
                if (!fallback.ok) {
                    base.ok = false;
                    base.failedStage = 'remoteShellFallback';
                    base.nextAction = fallback.nextAction;
                    break;
                }
                continue;
            }
            base.remote = remote;
            base.remoteActions.push(remote);
            base.stages.push({ stage: 'remoteAction', ok: remote.ok, message: action.target + ':' + action.action });
            base.diagnostics.push(...remote.diagnostics);
            if (!remote.ok) {
                base.ok = false;
                base.failedStage = 'remoteAction';
                base.nextAction = remote.nextAction;
                break;
            }
        }
    } catch (error) {
        base.ok = false;
        base.failedStage = 'remoteAction';
        base.diagnostics.push({ level: 'error', message: error instanceof Error ? error.message : String(error) });
        base.nextAction = '检查远端 action 参数后重试';
    } finally {
        if (prepared.lock?.lockId) {
            const release = await executeRemoteReleaseLock({ remotePath: workspaceRemotePath, lockId: prepared.lock.lockId, runner: options.runner });
            base.diagnostics.push(...release.diagnostics);
            base.stages.push({ stage: 'releaseLock', ok: release.ok, message: release.removed ? 'removed' : release.diagnostics[0]?.message });
            if (!release.ok) {
                base.ok = false;
                base.failedStage = base.failedStage || 'releaseLock';
                base.nextAction = '手动检查或 unlock 远端 lock';
            }
        }
    }
    return base;
}

function stagedBaselineProbe(localRepos: { name: string }[], mappings: RemoteRepoSettings[]): { remoteRepoNames: string[]; localNameByRemoteName: Record<string, string> } {
    const mappedLocalNames = new Set(mappings.map(repo => repo.localName));
    const localNameByRemoteName: Record<string, string> = {};
    const remoteRepoNames = new Set<string>();

    for (const repo of mappings) {
        localNameByRemoteName[repo.remoteName] = repo.localName;
        if (repo.role === 'primary' || repo.role === 'mapped') {
            remoteRepoNames.add(repo.remoteName);
        }
    }
    for (const local of localRepos) {
        if (!mappedLocalNames.has(local.name)) {
            remoteRepoNames.add(local.name);
        }
    }

    return { remoteRepoNames: [...remoteRepoNames], localNameByRemoteName };
}

function repoPathForPlan(stagedWorkspace: string, plan: RemoteRepoPlan): string {
    return plan.remotePath || stagedWorkspaceRepoPath(stagedWorkspace, plan.remoteName);
}

function resolvePrimaryActionPath(stagedWorkspace: string, plans: RemoteRepoPlan[]): string {
    const primary = plans.find(plan => plan.role === 'primary' && plan.staged)
        || plans.find(plan => plan.role === 'mapped' && plan.staged)
        || plans.find(plan => plan.overlayAllowed && plan.staged);
    return primary ? repoPathForPlan(stagedWorkspace, primary) : stagedWorkspace;
}

function isRemoteForjaUnavailable(remote: Awaited<ReturnType<typeof executeRemoteBridge>> | undefined): boolean {
    if (!remote) { return false; }
    if (remote.exitCode === 127 || remote.exitCode === 126) { return true; }
    if (remote.result !== undefined) { return false; }
    const text = (remote.stderr + '\n' + remote.stdout + '\n' + remote.diagnostics.map(item => item.message).join('\n')).toLowerCase();
    return text.includes('not found')
        || text.includes('no such file')
        || text.includes('permission denied')
        || text.includes('remote forja missing')
        || text.includes('版本不兼容');
}

async function runTargetReadiness(
    readinessTargets: RemoteBridgeTarget[],
    remotePath: string,
    runner: RemoteRunner,
    remoteForjaBin?: string
): Promise<ExecutePreparedRemoteActionResult | null> {
    for (const target of readinessTargets) {
        const readiness = await executeRemoteBridge({
            target,
            action: 'status',
            args: [],
            json: true,
            remotePath,
            remoteForjaBin,
            runner
        });
        if (!readiness.ok) {
            return {
                ok: false,
                action: 'preparedAction',
                mode: 'remote',
                failedStage: 'targetReadiness',
                repos: [],
                stages: [{ stage: 'targetReadiness', ok: false, message: target }],
                diagnostics: readiness.diagnostics,
                nextAction: readiness.nextAction || 'forja status --json',
                remote: readiness
            };
        }
    }
    return null;
}

function selectRemoteActions(options: ExecutePreparedRemoteActionOptions): RemoteBuildOrderItem[] {
    if (isBuildOrderEntryPoint(options) && options.buildOrder && options.buildOrder.length > 0) {
        return options.buildOrder;
    }
    return [{ target: options.target, action: options.action as RemoteBuildOrderItem['action'], args: options.args }];
}

function isBuildOrderEntryPoint(options: ExecutePreparedRemoteActionOptions): boolean {
    if (options.target === 'qt') { return options.action === 'build'; }
    return options.action === 'build' || options.action === 'rebuild';
}

function toRemoteRepoMappings(repos: RemoteRepoSettings[]): RemoteRepoMapping[] {
    return repos.map(repo => ({
        localName: repo.localName,
        remoteName: repo.remoteName,
        role: repo.role,
        remotePath: repo.remotePath,
        baseline: repo.baseline,
        overlay: repo.overlay,
        mount: repo.mount
    }));
}

function toLocalOverlayAssets(settings: RemoteRepoSettings[], localRepos: { name: string; dir: string }[], plans: RemoteRepoPlan[]): LocalOverlayAssetMapping[] {
    const assets: LocalOverlayAssetMapping[] = [];
    for (const repo of settings) {
        if (!repo.assets || repo.assets.length === 0) { continue; }
        const plan = plans.find(item => item.localName === repo.localName && item.overlayAllowed);
        const local = localRepos.find(item => item.name === repo.localName);
        if (!plan || !local) { continue; }
        for (const asset of repo.assets) {
            assets.push({
                repoName: repo.localName,
                repoDir: local.dir,
                localPath: asset.localPath,
                remotePath: asset.remotePath
            });
        }
    }
    return assets;
}

function mergeBundleRepos(current: RepoBaselineState[], updated: RepoBaselineState[]): RepoBaselineState[] {
    const byName = new Map(current.map(repo => [repo.name, repo]));
    for (const repo of updated) {
        byName.set(repo.name, repo);
    }
    return [...byName.values()];
}
