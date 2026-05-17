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
}

export interface BranchSyncConfig {
    enabled: boolean;
    /** 固定分支映射。值为分支名或 null（null = 删除该条目） */
    pinned: Record<string, string | null>;
}

export interface BuildOrderEntry {
    workspace: string;
    type: 'qt' | 'sdk';
}

export interface ProjectSyncConfig {
    enabled: boolean;
    selectedServer: string; // server id
    ignore: string[];
    branchSync?: BranchSyncConfig;
    buildOrder?: BuildOrderEntry[];
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
        remotePath: s.remotePath || undefined
    }));
    atomicWriteJson(_serversFilePath(), stored);
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
            const config: ProjectSyncConfig = {
                enabled: !!raw.enabled,
                selectedServer: raw.selectedServer || '',
                ignore: Array.isArray(raw.ignore) ? raw.ignore : DEFAULT_IGNORE
            };
            // 防御性读取可选字段
            if (raw.branchSync && typeof raw.branchSync === 'object') {
                config.branchSync = {
                    enabled: !!raw.branchSync.enabled,
                    pinned: (raw.branchSync.pinned && typeof raw.branchSync.pinned === 'object')
                        ? raw.branchSync.pinned
                        : {}
                };
            }
            if (Array.isArray(raw.buildOrder)) {
                config.buildOrder = raw.buildOrder.filter(
                    (e: unknown): e is BuildOrderEntry =>
                        !!e && typeof e === 'object' &&
                        typeof (e as BuildOrderEntry).workspace === 'string' &&
                        ((e as BuildOrderEntry).type === 'qt' || (e as BuildOrderEntry).type === 'sdk')
                );
            }
            return config;
        }
    } catch (e) {
        console.warn(`[compilot] sync-config.json 解析失败: ${e instanceof Error ? e.message : e}`);
    }
    return { enabled: false, selectedServer: '', ignore: DEFAULT_IGNORE };
}

export function writeProjectSyncConfig(workspaceRoot: string, config: Partial<ProjectSyncConfig>): void {
    const filePath = _projectSyncConfigPath(workspaceRoot);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Read-merge-write：读取现有内容，合并后写回
    let existing: Record<string, unknown> = {};
    try {
        if (fs.existsSync(filePath)) {
            existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch {}

    // 顶层字段覆盖
    if (config.enabled !== undefined) { existing.enabled = config.enabled; }
    if (config.selectedServer !== undefined) { existing.selectedServer = config.selectedServer; }
    // 数组字段整体替换
    if (config.ignore !== undefined) { existing.ignore = config.ignore; }
    if (config.buildOrder !== undefined) { existing.buildOrder = config.buildOrder; }

    // branchSync deep merge
    if (config.branchSync !== undefined) {
        const prev = (existing.branchSync && typeof existing.branchSync === 'object')
            ? existing.branchSync as Record<string, unknown>
            : {};
        const merged: Record<string, unknown> = { ...prev };
        if (config.branchSync.enabled !== undefined) {
            merged.enabled = config.branchSync.enabled;
        }
        if (config.branchSync.pinned !== undefined) {
            const prevPinned = (prev.pinned && typeof prev.pinned === 'object')
                ? { ...(prev.pinned as Record<string, string | null>) }
                : {};
            // 合并 pinned 条目；值为 null 时移除该 key
            for (const [key, value] of Object.entries(config.branchSync.pinned)) {
                if (value === null) {
                    delete prevPinned[key];
                } else {
                    prevPinned[key] = value;
                }
            }
            merged.pinned = prevPinned;
        }
        existing.branchSync = merged;
    }

    atomicWriteJson(filePath, existing);
}

/**
 * 更新单个顶层字段（兼容 configPanel 现有调用方式）。
 * 对于 branchSync 字段，传入完整的 BranchSyncConfig 对象会触发 deep merge。
 */
export function updateProjectSyncField<K extends keyof ProjectSyncConfig>(workspaceRoot: string, key: K, value: ProjectSyncConfig[K]): void {
    writeProjectSyncConfig(workspaceRoot, { [key]: value } as Partial<ProjectSyncConfig>);
}
