export interface SavedProjectRef {
    root: string;
    relative: string;
}

export function encodeSelectedProject(root: string, relative: string): SavedProjectRef {
    return { root, relative };
}

export function decodeSelectedProject(value: unknown): SavedProjectRef | null {
    if (!value) { return null; }

    if (typeof value === 'object') {
        const parsed = value as Partial<SavedProjectRef>;
        if (typeof parsed.root === 'string' && typeof parsed.relative === 'string') {
            return { root: parsed.root, relative: parsed.relative };
        }
        return null;
    }

    if (typeof value !== 'string') { return null; }

    try {
        const parsed = JSON.parse(value) as Partial<SavedProjectRef>;
        if (typeof parsed.root === 'string' && typeof parsed.relative === 'string') {
            return { root: parsed.root, relative: parsed.relative };
        }
    } catch { /* invalid JSON — not a serialized project ref */ }

    return null;
}
