/**
 * 统一的服务器配置存储。
 * 全局服务器列表：~/.compilot/servers.json
 * 项目同步配置：.compilot/settings.json 的 sync 部分
 * 
 * 扩展和 CLI 共用，不依赖 vscode。
 *
 * ⚠ 安全警告：密码以明文存储在 servers.json 中。
 * VSCode 扩展场景建议通过 SecretStorage API 存储密码（参见 qt/sync/sftpClient.ts askPassword）。
 * CLI 场景可通过环境变量 COMPILOT_SSH_PASSWORD 注入，避免写入磁盘。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function atomicWriteJson(filePath: string, data: unknown): void {
    const tmp = filePath + `.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
}

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
    /** 是否启用严格主机密钥检查（默认 false，即 StrictHostKeyChecking=no） */
    strictHostKeyChecking?: boolean;
}

export interface ProjectSyncConfig {
    enabled: boolean;
    selectedServer: string; // server id
    ignore: string[];
    /** 项目级远程路径（优先于服务器上的 remotePath） */
    remotePath?: string;
}

// ── 路径 ──

function _globalDir(): string {
    return path.join(os.homedir(), '.compilot');
}

function _serversFilePath(): string {
    return path.join(_globalDir(), 'servers.json');
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
    strictHostKeyChecking?: boolean;
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
                    remotePath: s.remotePath || '',
                    strictHostKeyChecking: !!s.strictHostKeyChecking
                };
            });
            if (needsMigration) { writeServers(servers); }
            return servers;
        }
    } catch (e) {
        console.warn(`[compilot] servers.json 解析失败: ${e instanceof Error ? e.message : e}`);
    }
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
        remotePath: s.remotePath || undefined,
        strictHostKeyChecking: s.strictHostKeyChecking || undefined
    }));
    atomicWriteJson(_serversFilePath(), stored);
    // 收紧文件权限（仅当前用户可读写）— Windows 上 chmod 无效但不报错
    try { fs.chmodSync(_serversFilePath(), 0o600); } catch (e) {
        if (process.platform !== 'win32') {
            console.warn(`[compilot] chmod servers.json 失败: ${e instanceof Error ? e.message : e}`);
        }
    }
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

// ── 项目同步配置（读写统一 .compilot/settings.json 的 sync 部分） ──

import { loadSyncSettings, saveSyncSettings, SyncSettings, DEFAULT_SYNC } from './settingsIO';

const DEFAULT_IGNORE = DEFAULT_SYNC.ignore;

export function readProjectSyncConfig(workspaceRoot: string): ProjectSyncConfig {
    try {
        const sync = loadSyncSettings(workspaceRoot);
        return {
            enabled: sync.enabled,
            selectedServer: sync.selectedServer,
            ignore: sync.ignore.length > 0 ? sync.ignore : [...DEFAULT_IGNORE],
            remotePath: sync.remotePath || undefined
        };
    } catch {
        return { enabled: false, selectedServer: '', ignore: [...DEFAULT_IGNORE] };
    }
}

export function writeProjectSyncConfig(workspaceRoot: string, config: Partial<ProjectSyncConfig>): void {
    const current = loadSyncSettings(workspaceRoot);
    const updated: SyncSettings = { ...current };

    if (config.enabled !== undefined) { updated.enabled = config.enabled; }
    if (config.selectedServer !== undefined) { updated.selectedServer = config.selectedServer; }
    if (config.remotePath !== undefined) { updated.remotePath = config.remotePath; }
    if (config.ignore !== undefined) { updated.ignore = config.ignore; }

    saveSyncSettings(workspaceRoot, updated);
}

/**
 * 更新单个顶层字段（兼容 configPanel 现有调用方式）。
 */
export function updateProjectSyncField<K extends keyof ProjectSyncConfig>(workspaceRoot: string, key: K, value: ProjectSyncConfig[K]): void {
    writeProjectSyncConfig(workspaceRoot, { [key]: value } as Partial<ProjectSyncConfig>);
}
