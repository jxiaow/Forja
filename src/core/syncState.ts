import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { createLoggerBase } from './loggerBase';

const logger = createLoggerBase('SyncState');

export interface SyncTargetContext {
    serverId: string;
    serverName?: string;
    remotePath: string;
}

interface SyncRecord {
    /** 上次同步成功时文件的 mtime (ms) */
    mtime: number;
    /** 上次同步时间 */
    syncedAt: string;
}

interface SyncStateData {
    version: 1;
    workspace?: string;
    files: Record<string, SyncRecord>;
}

function _stateFilePath(workspaceRoot: string): string {
    const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
    return path.join(os.homedir(), '.forja', 'sync', `${hash}.json`);
}

function _normalizeRemotePath(remotePath: string): string {
    return remotePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function _targetPrefix(context: SyncTargetContext): string {
    return `target:${encodeURIComponent(context.serverId)}:${encodeURIComponent(_normalizeRemotePath(context.remotePath))}:`;
}

function _stateKey(relativePath: string, context?: SyncTargetContext): string {
    if (!context) { return relativePath; }
    return `${_targetPrefix(context)}${relativePath}`;
}

function _relativePathFromStateKey(key: string): string {
    if (!key.startsWith('target:')) { return key; }
    const first = key.indexOf(':', 'target:'.length);
    if (first < 0) { return key; }
    const second = key.indexOf(':', first + 1);
    if (second < 0) { return key; }
    return key.slice(second + 1);
}

function _readState(workspaceRoot: string): SyncStateData {
    const filePath = _stateFilePath(workspaceRoot);
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {
        logger.warn(`读取 sync-state.json 失败: ${e instanceof Error ? e.message : e}`);
    }
    return { version: 1, files: {} };
}

function _writeState(workspaceRoot: string, state: SyncStateData): void {
    const filePath = _stateFilePath(workspaceRoot);
    const dir = path.dirname(filePath);
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        state.workspace = workspaceRoot;
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) {
        logger.warn(`写入 sync-state.json 失败: ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * 判断文件是否需要同步：当前 mtime 比上次同步记录的 mtime 新
 */
export function needsSync(workspaceRoot: string, relativePath: string, context?: SyncTargetContext): boolean {
    const state = _readState(workspaceRoot);
    const record = state.files[_stateKey(relativePath, context)];
    if (!record) {
        return true;
    }

    const absPath = path.join(workspaceRoot, relativePath);
    try {
        const stat = fs.statSync(absPath);
        const currentMtime = stat.mtimeMs;
        return currentMtime > record.mtime;
    } catch {
        return false;
    }
}

/**
 * 批量过滤：返回需要同步的文件列表
 */
export function filterNeedsSync(workspaceRoot: string, files: string[], context?: SyncTargetContext): string[] {
    const state = _readState(workspaceRoot);
    const result: string[] = [];

    for (const relativePath of files) {
        const record = state.files[_stateKey(relativePath, context)];
        if (!record) {
            result.push(relativePath);
            continue;
        }

        const absPath = path.join(workspaceRoot, relativePath);
        try {
            const stat = fs.statSync(absPath);
            if (stat.mtimeMs > record.mtime) {
                result.push(relativePath);
            }
        } catch {
            // 文件不存在，跳过
        }
    }

    return result;
}

/**
 * 标记文件已同步成功
 */
export function markSynced(workspaceRoot: string, relativePath: string, context?: SyncTargetContext): void {
    const state = _readState(workspaceRoot);
    const absPath = path.join(workspaceRoot, relativePath);
    try {
        const stat = fs.statSync(absPath);
        state.files[_stateKey(relativePath, context)] = {
            mtime: stat.mtimeMs,
            syncedAt: new Date().toISOString()
        };
        _writeState(workspaceRoot, state);
    } catch {
        // 文件不存在，忽略
    }
}

/**
 * 批量标记已同步
 */
export function markSyncedBatch(workspaceRoot: string, files: string[], context?: SyncTargetContext): void {
    const state = _readState(workspaceRoot);
    const now = new Date().toISOString();

    for (const relativePath of files) {
        const absPath = path.join(workspaceRoot, relativePath);
        try {
            const stat = fs.statSync(absPath);
            state.files[_stateKey(relativePath, context)] = {
                mtime: stat.mtimeMs,
                syncedAt: now
            };
        } catch {
            // 文件不存在，跳过
        }
    }

    // 清理本地已不存在的文件条目
    for (const key of Object.keys(state.files)) {
        const absPath = path.join(workspaceRoot, _relativePathFromStateKey(key));
        if (!fs.existsSync(absPath)) {
            delete state.files[key];
        }
    }

    _writeState(workspaceRoot, state);
}

/**
 * 清除同步记录（重置，下次全部重新同步）
 */
export function clearSyncState(workspaceRoot: string): void {
    const filePath = _stateFilePath(workspaceRoot);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {
        // 忽略
    }
}

/**
 * 获取待同步文件数和上次同步时间（供 UI 展示）。
 * 轻量实现：读取 sync-state.json 获取上次同步时间，
 * 待同步数通过 git status 快速估算（不做完整 diff）。
 */
export function getSyncPendingInfo(workspaceRoot: string, ignore: string[]): { count: number; lastTime: string } {
    const state = _readState(workspaceRoot);

    // 上次同步时间：取所有文件中最新的 syncedAt
    let lastTime = '';
    for (const record of Object.values(state.files)) {
        if (record.syncedAt && record.syncedAt > lastTime) {
            lastTime = record.syncedAt;
        }
    }

    // 格式化上次同步时间
    let lastTimeDisplay = '';
    if (lastTime) {
        try {
            const d = new Date(lastTime);
            const now = new Date();
            const diffMs = now.getTime() - d.getTime();
            if (diffMs < 60000) {
                lastTimeDisplay = '刚刚';
            } else if (diffMs < 3600000) {
                lastTimeDisplay = `${Math.floor(diffMs / 60000)} 分钟前`;
            } else if (diffMs < 86400000) {
                lastTimeDisplay = `${Math.floor(diffMs / 3600000)} 小时前`;
            } else {
                lastTimeDisplay = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
        } catch {
            lastTimeDisplay = '';
        }
    }

    // 待同步数：统计 state 中 mtime 已变化的文件数（快速估算，不调用 git）
    let count = 0;
    for (const [relativePath, record] of Object.entries(state.files)) {
        // 检查忽略
        const parts = relativePath.split(/[\\/]/);
        let ignored = false;
        for (const pattern of ignore) {
            for (const part of parts) {
                if (part === pattern) { ignored = true; break; }
            }
            if (ignored) { break; }
        }
        if (ignored) { continue; }

        const absPath = path.join(workspaceRoot, relativePath);
        try {
            const stat = fs.statSync(absPath);
            if (stat.mtimeMs > record.mtime) { count++; }
        } catch {
            // 文件不存在，跳过
        }
    }

    return { count, lastTime: lastTimeDisplay };
}


/** 列出所有 sync state 文件（用于 cleanup 命令） */
export function listSyncStates(): Array<{ filePath: string; workspace: string }> {
    const dir = path.join(os.homedir(), '.forja', 'sync');
    if (!fs.existsSync(dir)) { return []; }
    const results: Array<{ filePath: string; workspace: string }> = [];
    try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (raw.workspace) {
                    results.push({ filePath, workspace: raw.workspace });
                }
            } catch { /* skip malformed */ }
        }
    } catch { /* dir read failure */ }
    return results;
}
