import { ServerConfig } from '../../core/serverStore';

export type RemoteLayerName =
    | 'syncConfig'
    | 'ssh'
    | 'remotePlatform'
    | 'remotePath'
    | 'remoteCompilot'
    | 'targetLock';

export interface RemoteDiagnostic {
    level: 'info' | 'warning' | 'error';
    message: string;
}

export interface RemoteLayer {
    name: RemoteLayerName;
    ok: boolean | null;
    message?: string;
    version?: string;
    nextActions?: string[];
}

export interface RemoteConfig {
    workspace: string;
    server: ServerConfig;
    remotePath: string;
}

export interface RemoteStage {
    stage: string;
    ok: boolean;
    message?: string;
}

export interface RemoteCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface RemoteRunner {
    run(command: string, timeoutMs?: number): Promise<RemoteCommandResult>;
}

export interface RemoteStatusResult {
    ok: true;
    action: 'status';
    mode: 'remote';
    overall: 'ready' | 'degraded' | 'blocked' | 'unknown';
    workspace: string;
    server?: string;
    remotePath?: string;
    layers: RemoteLayer[];
    lock?: {
        locked: boolean;
        lockId?: string;
        owner?: string;
        stage?: string;
        startedAt?: string;
    };
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export interface RemoteTestResult {
    ok: boolean;
    action: 'test';
    mode: 'remote';
    failedLayer?: RemoteLayerName;
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
    stages?: RemoteStage[];
}
