/**
 * 同步配置解析 — 从 serverStore 和 projectSyncConfig 组装最终配置。
 */
import { readProjectSyncConfig, getServerByName, ServerConfig } from './serverStore';

export interface ResolvedSyncConfig {
    server: ServerConfig;
    remotePath: string;
    ignore: string[];
}

export function getResolvedConfig(workspaceRoot: string): ResolvedSyncConfig | null {
    if (!workspaceRoot) { return null; }
    const project = readProjectSyncConfig(workspaceRoot);
    if (!project.enabled || !project.selectedServer || !project.remotePath) { return null; }
    const server = getServerByName(project.selectedServer);
    if (!server) { return null; }
    return { server, remotePath: project.remotePath, ignore: project.ignore };
}
