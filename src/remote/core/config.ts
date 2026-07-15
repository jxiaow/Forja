import * as path from 'path';
import { getServerById } from '../../core/serverStore';
import { loadRemoteSettings, loadSyncSettings, RemoteSettings, SyncSettings } from '../../core/settingsIO';
import { stagedWorkspaceRepoPath } from './stagedWorkspace';
import { RemoteConfig, RemoteDiagnostic, RemoteLayer } from './types';

export interface ResolveRemoteConfigResult {
    config?: RemoteConfig;
    layer: RemoteLayer;
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

/**
 * Pure resolution — all inputs explicit, no config I/O.
 * Callers who already have configs loaded use this directly.
 */
export function resolveRemoteConfigFrom(
    resolvedWorkspace: string,
    remote: RemoteSettings,
    sync: SyncSettings,
    serverOverride?: string,
): ResolveRemoteConfigResult {
    const serverId = serverOverride || remote.selectedServer || sync.selectedServer;
    if (!serverId) {
        return blocked('No server selected');
    }
    const server = getServerById(serverId);
    if (!server) {
        return blocked(`Server not found: ${serverId}`);
    }
    // Prefer remote.remotePaths, fall back to sync.remotePaths for backward compatibility
    const remotePath = remote.remotePaths[serverId] || sync.remotePaths[serverId] || '';
    if (!remotePath) {
        return blocked(`Server ${server.name || server.id}: remotePath not configured`);
    }
    return {
        config: { workspace: resolvedWorkspace, server, remotePath, ignore: sync.ignore },
        layer: { name: 'syncConfig', ok: true, message: 'ready' },
        diagnostics: [],
    };
}

/**
 * Convenience wrapper — loads configs then delegates to resolveRemoteConfigFrom.
 */
export function resolveRemoteConfig(workspace: string, serverOverride?: string): ResolveRemoteConfigResult {
    const resolvedWorkspace = path.resolve(workspace);
    const remote = loadRemoteSettings(resolvedWorkspace);
    const sync = loadSyncSettings(resolvedWorkspace);
    return resolveRemoteConfigFrom(resolvedWorkspace, remote, sync, serverOverride);
}

export function resolveRemoteActionPath(workspace: string, remotePath: string): string {
    const settings = loadRemoteSettings(workspace);
    if (settings.workspaceMode === 'staged' && settings.remoteWorkspace) {
        return settings.remoteWorkspace;
    }
    return remotePath;
}

export function resolveRemotePrimaryActionPath(workspace: string, remotePath: string): string {
    const settings = loadRemoteSettings(workspace);
    if (settings.workspaceMode !== 'staged' || !settings.remoteWorkspace) {
        return remotePath;
    }
    const primary = settings.repos.find(repo => repo.role === 'primary' && repo.remoteName);
    return primary ? stagedWorkspaceRepoPath(settings.remoteWorkspace, primary.remoteName) : settings.remoteWorkspace;
}

function blocked(message: string): ResolveRemoteConfigResult {
    return {
        layer: {
            name: 'syncConfig',
            ok: false,
            message,
            nextAction: 'forja remote set'
        },
        diagnostics: [{ level: 'error', message }],
        nextAction: 'forja remote set'
    };
}
