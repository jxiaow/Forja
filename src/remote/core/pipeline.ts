import { GitRunner, buildRemoteBaselineStatus, RepoBaselineState } from './baseline';
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
}

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
