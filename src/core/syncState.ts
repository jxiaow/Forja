import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';

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
    return path.join(workspaceRoot, '.compilot', 'sync-state.json');
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
