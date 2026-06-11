import * as path from 'path';
import { getServerById } from '../../core/serverStore';
import { loadSyncSettings } from '../../core/settingsIO';
import { RemoteConfig, RemoteDiagnostic, RemoteLayer } from './types';

export interface ResolveRemoteConfigResult {
    config?: RemoteConfig;
    layer: RemoteLayer;
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export function resolveRemoteConfig(workspace: string): ResolveRemoteConfigResult {
    const resolvedWorkspace = path.resolve(workspace);
    const sync = loadSyncSettings(resolvedWorkspace);
    if (!sync.enabled || !sync.selectedServer) {
        return blocked('sync 未启用或未选择服务器');
    }
    const server = getServerById(sync.selectedServer);
    if (!server) {
        return blocked(`sync 服务器不存在: ${sync.selectedServer}`);
    }
    const remotePath = sync.remotePaths[sync.selectedServer] || '';
    if (!remotePath) {
        return blocked(`服务器 ${server.name || server.id} 未配置 remotePath`);
    }
    return {
        config: { workspace: resolvedWorkspace, server, remotePath, ignore: sync.ignore },
        layer: { name: 'syncConfig', ok: true, message: 'ready' },
        diagnostics: [],
        nextActions: []
    };
}

function blocked(message: string): ResolveRemoteConfigResult {
    return {
        layer: {
            name: 'syncConfig',
            ok: false,
            message,
            nextActions: ['配置 sync server 和 remotePath']
        },
        diagnostics: [{ level: 'error', message }],
        nextActions: ['配置 sync server 和 remotePath']
    };
}
