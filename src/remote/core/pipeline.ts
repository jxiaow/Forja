import { RemoteBuildOrderItem } from '../../core/settingsIO';
import { GitRunner, buildRemoteBaselineStatus, RepoBaselineState } from './baseline';
import { executeRemoteBridge, RemoteBridgeAction, RemoteBridgeTarget } from './bridge';
import { RemoteUploader } from './bootstrap';
import { executeRemoteBranchSync } from './branchSync';
import { executeRemoteAcquireLock, executeRemoteReleaseLock, RemoteLockMetadata } from './lock';
import { buildLocalOverlayPlan, executeRemoteOverlaySync } from './overlaySync';
import { RemoteDiagnostic, RemoteRunner, RemoteStage } from './types';

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
    failedStage?: string;
    lock?: RemoteLockMetadata;
    repos: RepoBaselineState[];
    stages: RemoteStage[];
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export async function prepareRemoteWorkspace(options: PrepareRemoteWorkspaceOptions): Promise<PrepareRemoteWorkspaceResult> {
    const stages: RemoteStage[] = [];
    const diagnostics: RemoteDiagnostic[] = [];
    let repos: RepoBaselineState[] = [];
    let lock: RemoteLockMetadata | undefined;
    const releaseAfterPrepare = options.releaseAfterPrepare ?? true;

    const fail = (stage: string, nextActions: string[] = ['修复 remote prepare 诊断后重试']): PrepareRemoteWorkspaceResult => ({
        ok: false,
        action: 'prepareWorkspace',
        mode: 'remote',
        failedStage: stage,
        lock,
        repos,
        stages,
        diagnostics,
        nextActions
    });

    const baseline = await buildRemoteBaselineStatus({ workspace: options.workspace, remotePath: options.remotePath, runner: options.runner, git: options.git });
    repos = baseline.repos;
    diagnostics.push(...baseline.diagnostics);
    stages.push({ stage: 'baselinePrecheck', ok: baseline.ok, message: baseline.overall });
    if (!baseline.ok) {
        return fail('baselinePrecheck', baseline.nextActions);
    }

    const lockResult = await executeRemoteAcquireLock({
        remotePath: options.remotePath,
        owner: options.owner,
        stage: 'prepare',
        repos: repos.map(repo => repo.name),
        workspace: options.workspace,
        runner: options.runner
    });
    diagnostics.push(...lockResult.diagnostics);
    lock = lockResult.lock;
    stages.push({ stage: 'acquireLock', ok: lockResult.ok, message: lockResult.acquired ? lockResult.lock?.lockId : lockResult.diagnostics[0]?.message });
    if (!lockResult.ok || !lockResult.lock?.lockId) {
        return fail('acquireLock');
    }

    let result: PrepareRemoteWorkspaceResult | undefined;
    try {
        const branchSync = await executeRemoteBranchSync({ remotePath: options.remotePath, targetId: lockResult.targetId, repos, runner: options.runner });
        diagnostics.push(...branchSync.diagnostics);
        stages.push({ stage: 'branchSync', ok: branchSync.ok });
        if (!branchSync.ok) {
            result = fail('branchSync', branchSync.nextActions);
            return result;
        }

        const overlayPlan = await buildLocalOverlayPlan({ workspace: options.workspace, ignore: options.ignore, git: options.git });
        diagnostics.push(...overlayPlan.diagnostics);
        if (!overlayPlan.ok) {
            stages.push({ stage: 'overlaySync', ok: false, message: 'overlay plan failed' });
            result = fail('overlaySync');
            return result;
        }
        const overlaySync = await executeRemoteOverlaySync({ remotePath: options.remotePath, targetId: lockResult.targetId, plan: overlayPlan, runner: options.runner, uploader: options.uploader });
        diagnostics.push(...overlaySync.diagnostics);
        stages.push({ stage: 'overlaySync', ok: overlaySync.ok });
        if (!overlaySync.ok) {
            result = fail('overlaySync', overlaySync.nextActions);
            return result;
        }

        const postBaseline = await buildRemoteBaselineStatus({ workspace: options.workspace, remotePath: options.remotePath, runner: options.runner, git: options.git });
        repos = postBaseline.repos;
        diagnostics.push(...postBaseline.diagnostics);
        stages.push({ stage: 'baselineCheck', ok: postBaseline.ok, message: postBaseline.overall });
        if (!postBaseline.ok) {
            result = fail('baselineCheck', postBaseline.nextActions);
            return result;
        }

        result = {
            ok: true,
            action: 'prepareWorkspace',
            mode: 'remote',
            lock,
            repos,
            stages,
            diagnostics,
            nextActions: []
        };
        return result;
    } finally {
        if (releaseAfterPrepare || !result?.ok) {
            const release = await executeRemoteReleaseLock({ remotePath: options.remotePath, lockId: lockResult.lock.lockId, runner: options.runner });
            diagnostics.push(...release.diagnostics);
            stages.push({ stage: 'releaseLock', ok: release.ok, message: release.removed ? 'removed' : release.diagnostics[0]?.message });
            if (result) {
                result.stages = stages;
                result.diagnostics = diagnostics;
                if (!release.ok) {
                    result.ok = false;
                    result.failedStage = result.failedStage || 'releaseLock';
                    result.nextActions = ['手动检查或 unlock 远端 lock'];
                }
            }
        }
    }
}


export async function executePreparedRemoteAction(options: ExecutePreparedRemoteActionOptions): Promise<ExecutePreparedRemoteActionResult> {
    const actions = selectRemoteActions(options);
    const readinessTargets = [...new Set(actions.map(item => item.target))];
    for (const target of readinessTargets) {
        const readiness = await executeRemoteBridge({
            target,
            action: 'status',
            args: [],
            json: true,
            remotePath: options.remotePath,
            runner: options.runner
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
                nextActions: readiness.nextActions.length > 0 ? readiness.nextActions : [`forja remote ${target} status --json`],
                remote: readiness
            };
        }
    }

    const prepared = await prepareRemoteWorkspace({ ...options, releaseAfterPrepare: false });
    const base: ExecutePreparedRemoteActionResult = { ...prepared, action: 'preparedAction' };
    base.stages.unshift({ stage: 'targetReadiness', ok: true, message: readinessTargets.join(',') });
    if (!prepared.ok) {
        return base;
    }

    try {
        base.remoteActions = [];
        for (const action of actions) {
            const remote = await executeRemoteBridge({
                target: action.target,
                action: action.action,
                args: action.args,
                json: options.json,
                stream: actions.length === 1 ? options.stream : false,
                remotePath: options.remotePath,
                runner: options.runner
            });
            base.remote = remote;
            base.remoteActions.push(remote);
            base.stages.push({ stage: 'remoteAction', ok: remote.ok, message: action.target + ':' + action.action });
            base.diagnostics.push(...remote.diagnostics);
            if (!remote.ok) {
                base.ok = false;
                base.failedStage = 'remoteAction';
                base.nextActions = remote.nextActions;
                break;
            }
        }
    } catch (error) {
        base.ok = false;
        base.failedStage = 'remoteAction';
        base.diagnostics.push({ level: 'error', message: error instanceof Error ? error.message : String(error) });
        base.nextActions = ['检查远端 action 参数后重试'];
    } finally {
        const release = await executeRemoteReleaseLock({ remotePath: options.remotePath, lockId: prepared.lock!.lockId, runner: options.runner });
        base.diagnostics.push(...release.diagnostics);
        base.stages.push({ stage: 'releaseLock', ok: release.ok, message: release.removed ? 'removed' : release.diagnostics[0]?.message });
        if (!release.ok) {
            base.ok = false;
            base.failedStage = base.failedStage || 'releaseLock';
            base.nextActions = ['手动检查或 unlock 远端 lock'];
        }
    }
    return base;
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
