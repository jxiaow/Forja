/**
 * 同步配置解析 — 从 serverStore 和 projectSyncConfig 组装最终配置。
 */
import { readProjectSyncConfig, getServerById, getServerByName, ServerConfig } from './serverStore';

export interface ResolvedSyncConfig {
    server: ServerConfig;
    remotePath: string;
    ignore: string[];
}

export function getResolvedConfig(workspaceRoot: string): ResolvedSyncConfig | null {
    if (!workspaceRoot) { return null; }
    const project = readProjectSyncConfig(workspaceRoot);
    if (!project.enabled || !project.selectedServer) { return null; }
    // 优先按 id 查找，兼容旧配置按 name 查找
    const server = getServerById(project.selectedServer) || getServerByName(project.selectedServer);
    if (!server || !server.remotePath) { return null; }
    return { server, remotePath: server.remotePath, ignore: project.ignore };
}
