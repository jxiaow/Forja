import { BootstrapArtifactResult, RemoteUploader } from './bootstrap';
import { BuildRemoteStatusOptions, buildRemoteStatus, buildRemoteTest } from './status';
import { RemoteDiagnostic, RemoteLayerName, RemoteRunner, RemoteStatusResult, RemoteTestResult } from './types';

export interface BuildRemoteDoctorOptions extends BuildRemoteStatusOptions {
    bootstrap?: boolean;
    artifact?: BootstrapArtifactResult;
    uploader?: RemoteUploader;
    runner?: RemoteRunner;
}

export interface RemoteDoctorCheck {
    name: RemoteLayerName | 'bootstrap';
    ok: boolean | null;
    message?: string;
    nextActions: string[];
}

export interface RemoteDoctorAutoFix {
    name: 'bootstrap';
    available: boolean;
    command: string;
    reason?: string;
}

export interface RemoteDoctorResult {
    ok: boolean;
    action: 'doctor';
    mode: 'remote';
    overall: RemoteStatusResult['overall'];
    workspace: string;
    server?: string;
    remotePath?: string;
    checks: RemoteDoctorCheck[];
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
    autoFixes: RemoteDoctorAutoFix[];
    status: RemoteStatusResult;
    test?: RemoteTestResult;
}

export async function buildRemoteDoctor(options: BuildRemoteDoctorOptions): Promise<RemoteDoctorResult> {
    let status = await buildRemoteStatus(options);
    let checks: RemoteDoctorCheck[] = status.layers.map(layer => ({
        name: layer.name,
        ok: layer.ok,
        message: layer.message,
        nextActions: layer.nextActions || []
    }));
    let diagnostics: RemoteDiagnostic[] = [...status.diagnostics];
    let nextActions = [...status.nextActions];
    let test: RemoteTestResult | undefined;

    const remoteForja = status.layers.find(layer => layer.name === 'remoteForja');
    const canBootstrap = remoteForja?.ok === false;
    const autoFixes: RemoteDoctorAutoFix[] = [{
        name: 'bootstrap',
        available: canBootstrap,
        command: 'forja remote test --bootstrap',
        reason: canBootstrap ? undefined : 'remoteForja 检查未失败或尚未到达该检查'
    }];

    if (options.bootstrap && canBootstrap) {
        test = await buildRemoteTest({
            ...options,
            bootstrap: true,
            probe: true,
            baseline: false,
            lock: false
        });
        checks.push({
            name: 'bootstrap',
            ok: test.ok,
            message: test.ok ? 'completed' : test.diagnostics.map(item => item.message).find(Boolean),
            nextActions: test.nextActions
        });
        if (test.ok) {
            const bootstrapCheck = checks[checks.length - 1];
            status = await buildRemoteStatus(options);
            checks = status.layers.map(layer => ({
                name: layer.name,
                ok: layer.ok,
                message: layer.message,
                nextActions: layer.nextActions || []
            }));
            checks.push(bootstrapCheck);
            diagnostics = [...status.diagnostics];
            nextActions = [...status.nextActions];
        } else {
            diagnostics.push(...test.diagnostics);
            nextActions = test.nextActions;
        }
    } else if (canBootstrap && !nextActions.includes('forja remote test --bootstrap')) {
        nextActions.push('forja remote test --bootstrap');
    }

    nextActions = unique(nextActions);
    const ok = status.overall === 'ready' || status.overall === 'degraded';
    return {
        ok: ok && (!test || test.ok),
        action: 'doctor',
        mode: 'remote',
        overall: status.overall,
        workspace: status.workspace,
        server: status.server,
        remotePath: status.remotePath,
        checks,
        diagnostics,
        nextActions,
        autoFixes,
        status,
        test
    };
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values));
}
