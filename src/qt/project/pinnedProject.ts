/**
 * pinnedProject 编解码工具。
 * pinnedProject 在 settingsStore 中存储为 { root, relative } 对象，
 * 本模块负责在 UI / 扩展代码和存储格式之间转换。
 */

export interface PinnedProjectRef {
    root: string;
    relative: string;
}

/**
 * 解码 pinnedProject 存储值。
 * 接受 { root, relative } 对象、JSON 字符串、或 null。
 */
export function decodePinnedProject(value: unknown): PinnedProjectRef | null {
    if (!value) { return null; }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object' && parsed && typeof parsed.root === 'string' && typeof parsed.relative === 'string') {
                return { root: parsed.root, relative: parsed.relative };
            }
        } catch { /* not valid JSON */ }
        return null;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj.root === 'string' && typeof obj.relative === 'string') {
            return { root: obj.root, relative: obj.relative };
        }
    }
    return null;
}

/**
 * 编码为 pinnedProject 存储格式。
 */
export function encodePinnedProject(root: string, relative: string): PinnedProjectRef {
    return { root, relative };
}
