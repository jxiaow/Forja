import * as path from 'path';

function normalizeRelative(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function isPathInside(parentDir: string, childPath: string): boolean {
    const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveRequestedFilesForGitRoot(gitRoot: string, workspaceRoot: string, requestedFiles: string[]): string[] {
    const results: string[] = [];
    const gitAbs = path.resolve(gitRoot);
    const workspaceAbs = path.resolve(workspaceRoot);

    for (const requested of requestedFiles) {
        const trimmed = requested.trim();
        if (!trimmed) { continue; }

        const candidates = path.isAbsolute(trimmed)
            ? [path.resolve(trimmed)]
            : [path.resolve(workspaceAbs, trimmed), path.resolve(gitAbs, trimmed)];

        for (const candidate of candidates) {
            if (!isPathInside(gitAbs, candidate)) { continue; }
            const relative = normalizeRelative(path.relative(gitAbs, candidate));
            if (relative && !results.includes(relative)) {
                results.push(relative);
            }
            break;
        }
    }

    return results;
}
