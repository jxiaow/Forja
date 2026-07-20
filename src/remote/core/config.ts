import * as path from 'path';
import { getServerById, ServerConfig } from '../../core/serverStore';
import { loadRemoteSettings, loadSyncSettings, RemoteSettings, SyncSettings } from '../../core/settingsIO';
import { stagedWorkspaceRepoPath } from './stagedWorkspace';
import { RemoteConfig, RemoteDiagnostic, RemoteLayer } from './types';

export interface ResolveRemoteConfigResult {
    config?: RemoteConfig;
    layer: RemoteLayer;
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

export interface ResolveRemoteServerResult {
    server?: ServerConfig;
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
    const resolvedServer = resolveRemoteServerFrom(remote, serverOverride);
    if (!resolvedServer.server) {
        return blocked(
            resolvedServer.diagnostics[0].message,
            resolvedServer.nextAction!,
        );
    }
    const server = resolvedServer.server;
    const serverId = server.id;
    const remotePath = remote.remotePaths[serverId] || '';
    if (!remotePath) {
        return blocked(
            `Server ${server.name || server.id}: remotePath not configured`,
            'forja remote set --remote-path <path>',
        );
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

export function resolveRemoteServer(workspace: string, serverOverride?: string): ResolveRemoteServerResult {
    const remote = loadRemoteSettings(path.resolve(workspace));
    return resolveRemoteServerFrom(remote, serverOverride);
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

function blocked(message: string, nextAction: string): ResolveRemoteConfigResult {
    return {
        layer: {
            name: 'syncConfig',
            ok: false,
            message,
            nextAction,
        },
        diagnostics: [{ level: 'error', message }],
        nextAction,
    };
}

function resolveRemoteServerFrom(remote: RemoteSettings, serverOverride?: string): ResolveRemoteServerResult {
    const serverId = serverOverride || remote.selectedServer;
    if (!serverId) {
        return {
            diagnostics: [{ level: 'error', message: 'No server selected' }],
            nextAction: 'forja remote set --server <name>',
        };
    }
    const server = getServerById(serverId);
    if (!server) {
        return {
            diagnostics: [{ level: 'error', message: `Server not found: ${serverId}` }],
            nextAction: 'forja remote set --server <name>',
        };
    }
    return { server, diagnostics: [] };
}
