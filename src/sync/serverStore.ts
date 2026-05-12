/**
 * 统一的服务器配置存储。
 * 全局服务器列表：~/.qt-pilot/servers.json
 * 项目同步配置：.work/qt-pilot/sync-config.json
 * 
 * 扩展和 CLI 共用，不依赖 vscode。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encrypt, decrypt } from './crypto';

export type AuthMode = 'key' | 'password';

export interface ServerConfig {
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: AuthMode;
    privateKeyPath: string;
    password: string; // 加密存储
}

export interface ProjectSyncConfig {
    enabled: boolean;
    selectedServer: string;
    remotePath: string;
    ignore: string[];
}

// ── 路径 ──

function _globalDir(): string {
    return path.join(os.homedir(), '.qt-pilot');
}

function _serversFilePath(): string {
    return path.join(_globalDir(), 'servers.json');
}

function _projectSyncConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.work', 'qt-pilot', 'sync-config.json');
}

// ── 全局服务器列表 ──

interface StoredServer {
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: AuthMode;
    privateKeyPath: string;
    password?: string; // 加密后的字符串
}

export function readServers(): ServerConfig[] {
    const filePath = _serversFilePath();
    try {
        if (fs.existsSync(filePath)) {
            const raw: StoredServer[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return raw.map(s => ({
                name: s.name || '',
                host: s.host || '',
                port: s.port || 22,
                username: s.username || '',
                authMode: (s.authMode === 'password' ? 'password' : 'key') as AuthMode,
                privateKeyPath: s.privateKeyPath || '',
                password: s.password ? decrypt(s.password) : ''
            }));
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
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        authMode: s.authMode,
        privateKeyPath: s.privateKeyPath,
        password: s.password ? encrypt(s.password) : undefined
    }));
    fs.writeFileSync(_serversFilePath(), JSON.stringify(stored, null, 2), 'utf-8');
}

export function addServer(server: ServerConfig): boolean {
    const servers = readServers();
    if (servers.some(s => s.name === server.name)) {
        return false; // 已存在
    }
    servers.push(server);
    writeServers(servers);
    return true;
}

export function removeServer(name: string): void {
    const servers = readServers();
    writeServers(servers.filter(s => s.name !== name));
}

export function getServerByName(name: string): ServerConfig | null {
    const servers = readServers();
    return servers.find(s => s.name === name) || null;
}

// ── 项目同步配置 ──

const DEFAULT_IGNORE = ['.git', 'node_modules', 'out', '.work', 'build', 'debug', 'release'];

export function readProjectSyncConfig(workspaceRoot: string): ProjectSyncConfig {
    const filePath = _projectSyncConfigPath(workspaceRoot);
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return {
                enabled: !!raw.enabled,
                selectedServer: raw.selectedServer || '',
                remotePath: raw.remotePath || '',
                ignore: Array.isArray(raw.ignore) ? raw.ignore : DEFAULT_IGNORE
            };
        }
    } catch {}
    return { enabled: false, selectedServer: '', remotePath: '', ignore: DEFAULT_IGNORE };
}

export function writeProjectSyncConfig(workspaceRoot: string, config: ProjectSyncConfig): void {
    const filePath = _projectSyncConfigPath(workspaceRoot);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateProjectSyncField(workspaceRoot: string, key: keyof ProjectSyncConfig, value: unknown): void {
    const config = readProjectSyncConfig(workspaceRoot);
    (config as any)[key] = value;
    writeProjectSyncConfig(workspaceRoot, config);
}
