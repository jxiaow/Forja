export type ConfigPageId = 'project' | 'env' | 'sync' | 'advanced';

const CONFIG_PAGE_IDS: readonly ConfigPageId[] = ['project', 'env', 'sync', 'advanced'];

export function normalizeConfigPageId(pageId: unknown): ConfigPageId {
    return typeof pageId === 'string' && CONFIG_PAGE_IDS.includes(pageId as ConfigPageId)
        ? pageId as ConfigPageId
        : 'project';
}
