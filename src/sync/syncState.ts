import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../core/logger';

const logger = createLogger('SyncState');

interface SyncRecord {
    /** 上次同步成功时文件的 mtime (ms) */
    mtime: number;
    /** 上次同步时间 */
    syncedAt: string;
}

interface SyncStateData {
    version: 1;
    files: Record<string, SyncRecord>;
}

function _stateFilePath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.qtpilot', 'sync-state.json');
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
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) {
        logger.warn(`写入 sync-state.json 失败: ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * 判断文件是否需要同步：当前 mtime 比上次同步记录的 mtime 新
 */
export function needsSync(workspaceRoot: string, relativePath: string): boolean {
    const state = _readState(workspaceRoot);
    const record = state.files[relativePath];
    if (!record) {
        // 从未同步过，需要同步
        return true;
    }

    const absPath = path.join(workspaceRoot, relativePath);
    try {
        const stat = fs.statSync(absPath);
        const currentMtime = stat.mtimeMs;
        return currentMtime > record.mtime;
    } catch {
        // 文件不存在（可能已删除），不需要同步
        return false;
    }
}

/**
 * 批量过滤：返回需要同步的文件列表
 */
export function filterNeedsSync(workspaceRoot: string, files: string[]): string[] {
    const state = _readState(workspaceRoot);
    const result: string[] = [];

    for (const relativePath of files) {
        const record = state.files[relativePath];
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
export function markSynced(workspaceRoot: string, relativePath: string): void {
    const state = _readState(workspaceRoot);
    const absPath = path.join(workspaceRoot, relativePath);
    try {
        const stat = fs.statSync(absPath);
        state.files[relativePath] = {
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
export function markSyncedBatch(workspaceRoot: string, files: string[]): void {
    const state = _readState(workspaceRoot);
    const now = new Date().toISOString();

    for (const relativePath of files) {
        const absPath = path.join(workspaceRoot, relativePath);
        try {
            const stat = fs.statSync(absPath);
            state.files[relativePath] = {
                mtime: stat.mtimeMs,
                syncedAt: now
            };
        } catch {
            // 文件不存在，跳过
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
