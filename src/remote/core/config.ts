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
        return blocked('未选择服务器');
    }
    const server = getServerById(serverId);
    if (!server) {
        return blocked(`服务器不存在: ${serverId}`);
    }
    // Prefer remote.remotePaths, fall back to sync.remotePaths for backward compatibility
    const remotePath = remote.remotePaths[serverId] || sync.remotePaths[serverId] || '';
    if (!remotePath) {
        return blocked(`服务器 ${server.name || server.id} 未配置 remotePath`);
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
            nextAction: '配置 sync server 和 remotePath'
        },
        diagnostics: [{ level: 'error', message }],
        nextAction: '配置 sync server 和 remotePath'
    };
}
