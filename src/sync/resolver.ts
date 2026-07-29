/**
 * 同步配置解析 — 从 serverStore 和 projectSyncConfig 组装最终配置。
 */
import { readProjectSyncConfig, getServerById, ServerConfig } from '../core/serverStore';
import { loadRemoteSettings } from '../core/settingsIO';

export interface ResolvedSyncConfig {
    server: ServerConfig;
    remotePath: string;
    ignore: string[];
}

export function getResolvedConfig(workspaceRoot: string): ResolvedSyncConfig | null {
    if (!workspaceRoot) { return null; }
    const project = readProjectSyncConfig(workspaceRoot);
    if (!project.enabled) { return null; }
    const remote = loadRemoteSettings(workspaceRoot);
    if (!remote.selectedServer) { return null; }
    const server = getServerById(remote.selectedServer);
    if (!server) { return null; }
    const remotePath = remote.remotePaths[server.id] || '';
    if (!remotePath) { return null; }
    return { server, remotePath, ignore: project.ignore };
}
