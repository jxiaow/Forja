import * as path from 'path';
import type { RemoteRepoRole } from './repoStrategy';
import { remoteCommand } from './shell';

export interface StagedWorkspacePrepareOptions {
    stagedWorkspace: string;
    serverId: string;
    workspaceId: string;
    repos: string[];
}

export interface StagedRepoMutationCheck {
    stagedWorkspace: string;
    repoPath: string;
    role: RemoteRepoRole;
}

export interface StagedRepoMutationResult {
    ok: boolean;
    message: string;
}

export function stagedWorkspaceRepoPath(stagedWorkspace: string, repoName: string): string {
    const root = normalizeRemotePath(stagedWorkspace);
    const error = validateStagedRepoName(repoName);
    if (error) { throw new Error(error); }
    return root + '/' + normalizeRepoName(repoName);
}

export function isPathInsideStagedWorkspace(stagedWorkspace: string, repoPath: string): boolean {
    const root = normalizeRemotePath(stagedWorkspace);
    const target = normalizeRemotePath(repoPath);
    return target === root || target.startsWith(root + '/');
}

export function validateStagedRepoName(repoName: string, label: string = 'repo'): string | null {
    const normalized = normalizeRepoName(repoName);
    if (!normalized || normalized.includes('\0')) {
        return label + ' 名称不能为空';
    }
    const segments = normalized.split('/');
    if (path.posix.isAbsolute(normalized) || segments.length !== 1 || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        return label + ' 名称不能包含路径分隔符、. 或 ..';
    }
    return null;
}

export function assertStagedRepoMutation(options: StagedRepoMutationCheck): StagedRepoMutationResult {
    if (options.role === 'remote-only' || options.role === 'existing-remote' || options.role === 'skip') {
        return { ok: false, message: options.role + ' repo 不允许执行 reset/delete/overlay 等破坏性操作' };
    }
    if (!isPathInsideStagedWorkspace(options.stagedWorkspace, options.repoPath)) {
        return { ok: false, message: '非 staged 远端路径不允许执行 reset/delete/overlay: ' + options.repoPath };
    }
    return { ok: true, message: 'staged' };
}

export function buildStagedWorkspacePrepareCommand(options: StagedWorkspacePrepareOptions): string {
    const registryDir = '"$HOME/.forja/managed-workspaces"';
    const registryFile = '"$HOME/.forja/managed-workspaces/' + safeRegistryName(options.workspaceId) + '.json"';
    const marker = JSON.stringify({
        path: options.stagedWorkspace,
        createdBy: 'forja',
        workspaceId: options.workspaceId,
        serverId: options.serverId,
        repos: options.repos
    });
    return [
        'set -e;',
        'mkdir -p ' + registryDir + ';',
        'mkdir -p ' + remoteCommand([options.stagedWorkspace]) + ';',
        'printf %s ' + remoteCommand([marker]) + ' > ' + registryFile
    ].join(' ');
}

function normalizeRemotePath(value: string): string {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
    return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

function normalizeRepoName(value: string): string {
    return value.replace(/\\/g, '/');
}

function safeRegistryName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
