import { remoteCommand } from './shell';

/** Validate repo name — reject path traversal and absolute paths */
export function validateRepoName(name: string): { ok: true } | { ok: false; reason: 'invalid_chars' | 'empty' } {
    if (!name || !name.trim()) {
        return { ok: false, reason: 'empty' };
    }
    if (name.includes('..') || name.includes('/') || name.includes('\\') || name.startsWith('~')) {
        return { ok: false, reason: 'invalid_chars' };
    }
    return { ok: true };
}

/** Raw (unquoted) repository root path, for passing into builders that quote internally. */
export function resolvedRemoteRepoPathRaw(remotePath: string, repoName: string, resolved?: string): string {
    const base = resolved || (trimTrailingSlash(remotePath) + '/' + repoName);
    return trimTrailingSlash(base);
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

export function buildRemoteRepoDirSetup(remotePath: string, repoName: string, singleRepoRoot: boolean): string {
    return [
        'base_dir=' + remoteCommand([remotePath]) + ';',
        'repo_name=' + remoteCommand([repoName]) + ';',
        'single_repo=' + (singleRepoRoot ? '1' : '0') + ';',
        'child_dir="$base_dir/$repo_name";',
        'if [ "$single_repo" = "1" ] && [ -d "$base_dir/.git" ]; then repo_dir="$base_dir";',
        'else repo_dir="$child_dir";',
        'fi;'
    ].join(' ');
}
