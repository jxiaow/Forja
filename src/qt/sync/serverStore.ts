/**
 * 统一的服务器配置存储。
 * 全局服务器列表：~/.compilot/servers.json
 * 项目同步配置：.compilot/sync-config.json
 * 
 * 扩展和 CLI 共用，不依赖 vscode。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type AuthMode = 'key' | 'password';

export interface ServerConfig {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: AuthMode;
    privateKeyPath: string;
    password: string;
    remotePath: string;
}

export interface ProjectSyncConfig {
    enabled: boolean;
    selectedServer: string; // server id
    ignore: string[];
}

// ── 路径 ──

function _globalDir(): string {
    return path.join(os.homedir(), '.compilot');
}

function _serversFilePath(): string {
    return path.join(_globalDir(), 'servers.json');
}

function _projectSyncConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.compilot', 'sync-config.json');
}

function _generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── 全局服务器列表 ──

interface StoredServer {
    id?: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: AuthMode;
    privateKeyPath: string;
    password?: string;
    remotePath?: string;
}

export function readServers(): ServerConfig[] {
    const filePath = _serversFilePath();
    try {
        if (fs.existsSync(filePath)) {
            const raw: StoredServer[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            let needsMigration = false;
            const servers = raw.map(s => {
                if (!s.id) { needsMigration = true; }
                return {
                    id: s.id || _generateId(),
                    name: s.name || '',
                    host: s.host || '',
                    port: s.port || 22,
                    username: s.username || '',
                    authMode: (s.authMode === 'password' ? 'password' : 'key') as AuthMode,
                    privateKeyPath: s.privateKeyPath || '',
                    password: s.password || '',
                    remotePath: s.remotePath || ''
                };
            });
            if (needsMigration) { writeServers(servers); }
            return servers;
        }
    } catch {}
    return [];
}

export function writeServers(servers: ServerConfig[]): void {
    const dir = _globalDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const stored: StoredServer[] = servers.map(s => ({
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        authMode: s.authMode,
        privateKeyPath: s.privateKeyPath,
        password: s.password || undefined,
        remotePath: s.remotePath || undefined
    }));
    fs.writeFileSync(_serversFilePath(), JSON.stringify(stored, null, 2), 'utf-8');
}

export function addServer(server: Omit<ServerConfig, 'id'>): ServerConfig {
    const servers = readServers();
    const newServer: ServerConfig = { ...server, id: _generateId() };
    servers.push(newServer);
    writeServers(servers);
    return newServer;
}

export function removeServer(id: string): void {
    const servers = readServers();
    writeServers(servers.filter(s => s.id !== id));
}

export function updateServer(id: string, updates: Partial<Omit<ServerConfig, 'id'>>): boolean {
    const servers = readServers();
    const idx = servers.findIndex(s => s.id === id);
    if (idx < 0) { return false; }
    servers[idx] = { ...servers[idx], ...updates };
    writeServers(servers);
    return true;
}

export function getServerById(id: string): ServerConfig | null {
    const servers = readServers();
    return servers.find(s => s.id === id) || null;
}

/** @deprecated 兼容旧代码，优先使用 getServerById */
export function getServerByName(name: string): ServerConfig | null {
    const servers = readServers();
    return servers.find(s => s.name === name) || null;
}

// ── 项目同步配置 ──

const DEFAULT_IGNORE = ['.git', 'node_modules', 'out', '.compilot', 'build', 'debug', 'release'];

export function readProjectSyncConfig(workspaceRoot: string): ProjectSyncConfig {
    const filePath = _projectSyncConfigPath(workspaceRoot);
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return {
                enabled: !!raw.enabled,
                selectedServer: raw.selectedServer || '',
                ignore: Array.isArray(raw.ignore) ? raw.ignore : DEFAULT_IGNORE
            };
        }
    } catch {}
    return { enabled: false, selectedServer: '', ignore: DEFAULT_IGNORE };
}

export function writeProjectSyncConfig(workspaceRoot: string, config: ProjectSyncConfig): void {
    const filePath = _projectSyncConfigPath(workspaceRoot);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateProjectSyncField<K extends keyof ProjectSyncConfig>(workspaceRoot: string, key: K, value: ProjectSyncConfig[K]): void {
    const config = readProjectSyncConfig(workspaceRoot);
    config[key] = value;
    writeProjectSyncConfig(workspaceRoot, config);
}
