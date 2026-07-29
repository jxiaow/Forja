/**
 * 同步配置解析 — 从 serverStore 和 projectSyncConfig 组装最终配置。
 */
import { readProjectSyncConfig, getServerById, ServerConfig } from '../core/serverStore';

export interface ResolvedSyncConfig {
    server: ServerConfig;
    remotePath: string;
    ignore: string[];
}

export function getResolvedConfig(workspaceRoot: string): ResolvedSyncConfig | null {
    if (!workspaceRoot) { return null; }
    const project = readProjectSyncConfig(workspaceRoot);
    if (!project.enabled || !project.selectedServer) { return null; }
    const server = getServerById(project.selectedServer);
    if (!server) { return null; }
    const remotePath = project.remotePaths[server.id] || '';
    if (!remotePath) { return null; }
    return { server, remotePath, ignore: project.ignore };
}
