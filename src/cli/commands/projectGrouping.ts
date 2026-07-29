export function getProjectGroup(project: string): string {
    const normalized = project.replace(/\\/g, '/').replace(/^\.\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 1 || parts[0] === '.worktrees') {
        return '其他';
    }
    return parts[0];
}
