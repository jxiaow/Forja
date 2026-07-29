import { remoteCommand } from './shell';

export function fallbackRemoteRepoPath(remotePath: string, repoName: string): string {
    return remoteCommand([remotePath]) + '/' + remoteCommand([repoName]);
}

export function resolvedRemoteRepoPath(remotePath: string, repoName: string, resolved?: string): string {
    return resolved ? remoteCommand([resolved]) : fallbackRemoteRepoPath(remotePath, repoName);
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
