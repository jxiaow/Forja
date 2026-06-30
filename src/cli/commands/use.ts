/**
 * `forja use` — user-facing configuration entry point.
 * Selects targets, build config, execution endpoint, sync/remote bindings.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ForjaJsonResult, ActiveTarget, Locale, T } from './types';
import { getActiveTarget, setActiveTarget } from './activeTarget';
import {
    loadQtSettings, saveQtSettings,
    loadSdkSettings, saveSdkSettings,
    loadSyncSettings, saveSyncSettings,
    loadRemoteSettings, saveRemoteSettings,
    loadGlobalConfig, saveGlobalConfig,
    RemoteRepoSettings, RemoteBuildOrderItem, RemoteTransferSettings,
    inferVsInstall,
} from '../../core/settingsIO';
import { getServerById, resolveServerSelector } from '../../core/serverStore';
import { collectTargetCandidates } from './candidates';

// Helper to safely save settings and return error result on failure
function safeSave(fn: () => void, configName: string): { ok: true } | { ok: false; error: string } {
    try {
        fn();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: `Failed to save ${configName}: ${e instanceof Error ? e.message : String(e)}` };
    }
}

export function formatUseText(result: UseResult, locale: Locale): string {
    const lines: string[] = [];

    if (!result.ok) {
        lines.push(T('error'));
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                lines.push(`  ${d.message}`);
            }
        }
        if (result.nextAction) {
            lines.push(T('next'));
            if (result.nextAction) {
            const a = result.nextAction; lines.push(`  ${a}`); }
        }
        return lines.join('\n');
    }

    const target = result.useTarget || 'use';
    lines.push(`${target} ${T('updated')}`);

    if (result.activeTarget) {
        const t = result.activeTarget;
        lines.push(`  ${T('target')} ${t.kind} ${t.project} ${t.mode} ${t.arch} ${t.runAt}`);
    }

    if (result.changed && result.changed.length > 0) {
        lines.push(`  ${T('changed')} ${result.changed.join(', ')}`);
    }

    if (result.remote) {
        const r = result.remote;
        if (r.workspaceMode) { lines.push(`  ${T('workspaceMode')} ${r.workspaceMode}`); }
        if (r.remoteWorkspace) { lines.push(`  ${T('remoteWorkspace')} ${r.remoteWorkspace}`); }
        if (r.remoteForjaBin) { lines.push(`  ${T('forjaBin')} ${r.remoteForjaBin}`); }
        if (r.profile) { lines.push(`  ${T('profile')} ${r.profile}`); }
        if (r.buildOrder && r.buildOrder.length > 0) {
            lines.push(`  ${T('buildOrder')}`);
            for (const b of r.buildOrder) { lines.push(`    ${b.target}:${b.action}`); }
        }
        if (r.repos && r.repos.length > 0) {
            lines.push(`  ${T('repos')}`);
            for (const rp of r.repos) { lines.push(`    ${rp.localName} → ${rp.remoteName}  role=${rp.role}`); }
        }
        if (r.transfer !== undefined) {
            if (r.transfer === null) {
                lines.push(`  ${T('transfer')} ${T('cleared')}`);
            } else {
                lines.push(`  ${T('transfer')} ${r.transfer.deployServer}:${r.transfer.deployPath}`);
            }
        }
    }

    if (result.nextAction) {
        lines.push(T('next'));
        if (result.nextAction) {
            const a = result.nextAction; lines.push(`  ${a}`); }
    }
    return lines.join('\n');
}

export interface UseResult extends ForjaJsonResult {
    action: 'use';
    useTarget?: string;  // 'target' | 'execution' | 'sync' | 'remote' | 'remote.workspace' | 'remote.repo' | 'remote.forjaBin' | 'remote.buildOrder' | 'remote.transfer' | 'qt' | 'sdk'
    changed: string[];
    remote?: {
        workspaceMode?: 'legacy' | 'staged';
        remoteWorkspace?: string;
        profile?: string;
        repos?: RemoteRepoSettings[];
        remoteForjaBin?: string;
        buildOrder?: RemoteBuildOrderItem[];
        transfer?: RemoteTransferSettings | null;
    };
}

export interface UseTargetArgs {
    project?: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
}

export function runUseTarget(workspace: string, args: UseTargetArgs): UseResult {
    const changed: string[] = [];

    // Check workspace exists
    if (!fs.existsSync(workspace)) {
        return {
            ok: false, action: 'use', useTarget: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.workspaceNotFound')}: ${workspace}` }],
        };
    }

    // Validate mode if provided
    if (args.mode && args.mode !== 'debug' && args.mode !== 'release') {
        return {
            ok: false, action: 'use', useTarget: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidMode')}: ${args.mode}. ${T('use.invalidModeDetail')}` }],
            nextAction: 'forja use target --mode debug',
        };
    }

    // Validate arch if provided
    if (args.arch && args.arch !== 'x86' && args.arch !== 'x64') {
        return {
            ok: false, action: 'use', useTarget: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidArch')}: ${args.arch}. ${T('use.invalidArchDetail')}` }],
            nextAction: 'forja use target --arch x64',
        };
    }

    const currentTarget = getActiveTarget(workspace);

    // --project: select or switch target
    if (args.project) {
        let resolvedProject = args.project;

        // If not an existing file path, try to resolve by project name (label match)
        const projectPath = path.isAbsolute(resolvedProject) ? resolvedProject : path.join(workspace, resolvedProject);
        if (!fs.existsSync(projectPath) || (fs.statSync(projectPath).isDirectory())) {
            const candidates = collectTargetCandidates(workspace);
            const inputLower = path.basename(resolvedProject).toLowerCase();
            const matches = candidates.filter(c => c.label.toLowerCase() === inputLower);
            if (matches.length === 1) {
                resolvedProject = matches[0].project;
            } else if (matches.length > 1) {
                return {
                    ok: false, action: 'use', useTarget: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${args.project}. ${T('idx.didYouMean')}: ${matches.map(m => m.project).join(', ')}?` }],
                    nextActions: matches.map(m => `forja use target --project ${m.project}`),
                };
            }
        }

        const finalPath = path.isAbsolute(resolvedProject) ? resolvedProject : path.join(workspace, resolvedProject);
        if (!fs.existsSync(finalPath)) {
            return {
                ok: false, action: 'use', useTarget: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${args.project}` }],
                nextAction: 'forja list targets',
            };
        }

        // Reject relative paths that escape the workspace boundary
        // Absolute paths (e.g. from manual UI browse) are allowed
        if (!path.isAbsolute(resolvedProject)) {
            const resolved = path.join(workspace, resolvedProject);
            const relCheck = path.relative(workspace, resolved);
            if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
                return {
                    ok: false, action: 'use', useTarget: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.projectOutsideWorkspace')}: ${args.project}` }],
                    nextAction: 'forja list targets',
                };
            }
        }

        // Infer kind from extension
        const ext = path.extname(resolvedProject).toLowerCase();
        let kind: 'qt' | 'sdk';
        if (ext === '.pro') { kind = 'qt'; }
        else if (ext === '.sln' || path.basename(resolvedProject).toLowerCase() === 'makefile' || path.basename(resolvedProject).toLowerCase() === 'cmakelists.txt') { kind = 'sdk'; }
        else {
            return {
                ok: false, action: 'use', useTarget: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.cannotDetermineKind')}: ${resolvedProject}. ${T('use.expectedExtensions')}` }],
                nextAction: 'forja list targets',
            };
        }

        const mode = args.mode ?? currentTarget?.mode ?? 'debug';
        const arch = args.arch ?? currentTarget?.arch ?? (process.platform === 'win32' ? 'x86' : 'x64');
        const runAt = currentTarget?.runAt ?? 'local';

        const newTarget: ActiveTarget = { kind, project: resolvedProject, mode, arch, runAt };

        // Sync domain-specific config FIRST so build/run can resolve the project
        // Save domain before activeTarget to avoid partial-write state on failure
        if (kind === 'qt') {
            const qt = loadQtSettings(workspace);
            const relativeProject = path.relative(workspace, finalPath).replace(/\\/g, '/');
            qt.pinnedProject = { root: workspace, relative: relativeProject };
            qt.mode = mode;
            qt.arch = arch;
            const saveResult = safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
            if (!saveResult.ok) {
                return { ok: false, action: 'use', useTarget: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: saveResult.error }],
                    nextAction: 'forja doctor' };
            }
            changed.push('qt.pinnedProject');
        } else {
            const sdk = loadSdkSettings(workspace);
            const relativeProject = path.relative(workspace, finalPath).replace(/\\/g, '/');
            sdk.pinnedProject = relativeProject;
            sdk.mode = mode;
            sdk.arch = arch;
            const saveResult = safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
            if (!saveResult.ok) {
                return { ok: false, action: 'use', useTarget: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: saveResult.error }],
                    nextAction: 'forja doctor' };
            }
            changed.push('sdk.pinnedProject');
        }

        try {
            setActiveTarget(workspace, newTarget);
        } catch (e) {
            return { ok: false, action: 'use', useTarget: 'target', changed,
                diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${e instanceof Error ? e.message : e}` }],
                nextAction: 'forja doctor' };
        }
        changed.push('activeTarget');

        return {
            ok: true, action: 'use', useTarget: 'target',
            workspace, activeTarget: newTarget, changed,
            nextAction: 'forja status',
        };
    }

    // --mode / --arch without --project: update current target
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useTarget: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const updated = { ...currentTarget };
    if (args.mode) { updated.mode = args.mode; changed.push('activeTarget.mode'); }
    if (args.arch) { updated.arch = args.arch; changed.push('activeTarget.arch'); }

    if (changed.length > 0) {
        // Update the config domain
        if (updated.kind === 'qt') {
            const qt = loadQtSettings(workspace);
            if (args.mode) { qt.mode = args.mode; }
            if (args.arch) { qt.arch = args.arch; }
            const saveResult_1 = safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
            if (!saveResult_1.ok) {
                return { ok: false, action: 'use', useTarget: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: saveResult_1.error }],
                    nextAction: 'forja doctor' };
            }
        } else {
            const sdk = loadSdkSettings(workspace);
            if (args.mode) { sdk.mode = args.mode; }
            if (args.arch) { sdk.arch = args.arch; }
            const saveResult_2 = safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
            if (!saveResult_2.ok) {
                return { ok: false, action: 'use', useTarget: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: saveResult_2.error }],
                    nextAction: 'forja doctor' };
            }
        }
        try {
            setActiveTarget(workspace, updated);
        } catch (e) {
            return { ok: false, action: 'use', useTarget: 'target', changed,
                diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${e instanceof Error ? e.message : e}` }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'target',
        workspace, activeTarget: updated, changed,
        nextAction: 'forja status',
    };
}

export function runUseExecution(workspace: string, local: boolean, remote: boolean): UseResult {
    // Validate: must specify exactly one of --local or --remote
    if (local && remote) {
        return {
            ok: false, action: 'use', useTarget: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.cannotSpecifyBothLocalRemote') }],
            nextAction: 'forja use execution --local',
        };
    }
    if (!local && !remote) {
        return {
            ok: false, action: 'use', useTarget: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.mustSpecifyLocalOrRemote') }],
            nextAction: 'forja use execution --local',
        };
    }

    const currentTarget = getActiveTarget(workspace);
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useTarget: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const runAt: 'local' | 'remote' = remote ? 'remote' : 'local';
    if (currentTarget.runAt === runAt) {
        return {
            ok: true, action: 'use', useTarget: 'execution',
            workspace, activeTarget: currentTarget, changed: [],
            nextAction: 'forja status',
        };
    }

    const updated = { ...currentTarget, runAt };
    const saveResult = safeSave(() => setActiveTarget(workspace, updated), 'Active target');
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useTarget: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveExecMode')}: ${saveResult.error}` }],
            nextAction: 'forja use execution --local',
        };
    }
    return {
        ok: true, action: 'use', useTarget: 'execution',
        workspace, activeTarget: updated, changed: ['activeTarget.runAt'],
        nextAction: 'forja status',
    };
}

export interface UseSyncArgs {
    server?: string;
    remotePath?: string;
    enable?: boolean;
    disable?: boolean;
}

export function runUseSync(workspace: string, args: UseSyncArgs): UseResult {
    const sync = loadSyncSettings(workspace);
    const changed: string[] = [];

    // Validate: cannot have both enable and disable
    if (args.enable && args.disable) {
        return {
            ok: false, action: 'use', useTarget: 'sync', changed: [],
            diagnostics: [{ level: 'error', message: T('use.cannotSpecifyBothEnableDisable') }],
            nextAction: 'forja use sync --enable',
        };
    }

    if (args.enable !== undefined) {
        sync.enabled = args.enable;
        changed.push('sync.enabled');
    }
    if (args.disable !== undefined) {
        sync.enabled = !args.disable;
        changed.push('sync.enabled');
    }

    if (args.server) {
        const server = getServerById(args.server);
        if (!server) {
            return {
                ok: false, action: 'use', useTarget: 'sync', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.serverNotFound')}: ${args.server}` }],
                nextAction: 'forja list servers',
            };
        }
        sync.selectedServer = server.id;
        changed.push('sync.selectedServer');

        // If server is provided, remotePath is required
        if (!args.remotePath) {
            return {
                ok: false, action: 'use', useTarget: 'sync', changed: [],
                diagnostics: [{ level: 'error', message: T('use.remotePathRequired') }],
                nextAction: 'forja use sync --server <name> --remote-path <path>',
            };
        }
    }

    if (args.remotePath && sync.selectedServer) {
        sync.remotePaths[sync.selectedServer] = args.remotePath;
        changed.push('sync.remotePath');
    } else if (args.remotePath && !sync.selectedServer) {
        // Error: remotePath provided but no server configured
        return {
            ok: false, action: 'use', useTarget: 'sync', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noServerConfigured') }],
            nextAction: 'forja use sync --server <name> --remote-path <path>',
        };
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveSyncSettings(workspace, sync), 'Sync settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'sync', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'sync',
        workspace, changed,
        nextAction: 'forja status',
    };
}

export interface UseRemoteArgs {
    server?: string;
    remotePath?: string;
}

export function runUseRemote(workspace: string, args: UseRemoteArgs): UseResult {
    const remote = loadRemoteSettings(workspace);
    const changed: string[] = [];

    if (args.server) {
        const resolved = resolveServerSelector(args.server);
        if (!resolved.server) {
            const msg = resolved.ambiguous
                ? `Ambiguous server name: ${args.server}. Use server ID instead.`
                : `${T('use.serverNotFound')}: ${args.server}`;
            return {
                ok: false, action: 'use', useTarget: 'remote', changed: [],
                diagnostics: [{ level: 'error', message: msg }],
                nextAction: 'forja list servers',
            };
        }
        // Set the remote execution server (separate from sync)
        remote.selectedServer = resolved.server.id;
        changed.push('remote.selectedServer');
    }

    if (args.remotePath && remote.selectedServer) {
        remote.remotePaths[remote.selectedServer] = args.remotePath;
        changed.push('remote.remotePath');
    } else if (args.remotePath && !remote.selectedServer) {
        // Error: remotePath provided but no server configured
        return {
            ok: false, action: 'use', useTarget: 'remote', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noServerConfigured') }],
            nextAction: 'forja use remote --server <name>',
        };
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'remote', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'remote',
        workspace, changed,
        nextAction: 'forja status',
    };
}

// ── Remote subcommands ──

export interface UseRemoteWorkspaceArgs {
    action: 'set' | 'clear';
    mode?: 'legacy' | 'staged';
    path?: string;
    profile?: string;
}

export function runUseRemoteWorkspace(workspace: string, args: UseRemoteWorkspaceArgs): UseResult {
    const remote = loadRemoteSettings(workspace);
    const changed: string[] = [];

    if (args.action === 'set') {
        if (!args.mode) {
            return {
                ok: false, action: 'use', useTarget: 'remote.workspace', changed: [],
                diagnostics: [{ level: 'error', message: T('use.workspaceSetRequiresMode') }],
                nextAction: 'forja use remote workspace set --mode staged',
            };
        }
        remote.workspaceMode = args.mode;
        changed.push('remote.workspaceMode');
        if (args.path !== undefined) {
            remote.remoteWorkspace = args.path;
            changed.push('remote.remoteWorkspace');
        }
        if (args.profile !== undefined) {
            remote.profile = args.profile;
            changed.push('remote.profile');
        }
    } else if (args.action === 'clear') {
        remote.workspaceMode = 'legacy';
        remote.remoteWorkspace = '';
        remote.profile = '';
        remote.repos = [];
        changed.push('remote.workspaceMode', 'remote.remoteWorkspace', 'remote.profile', 'remote.repos');
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote workspace settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'remote.workspace', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'remote.workspace',
        workspace, changed,
        remote: { workspaceMode: remote.workspaceMode, remoteWorkspace: remote.remoteWorkspace, profile: remote.profile },
        nextAction: 'forja status',
    };
}

// Valid repo name pattern: no path separators, no .., no leading dot
const REPO_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

function isValidRepoName(name: string): boolean {
    return REPO_NAME_PATTERN.test(name) && name !== '..' && !name.includes('/');
}

export interface UseRemoteRepoArgs {
    action: 'set' | 'remove' | 'clear';
    localName?: string;
    remoteName?: string;
    role?: 'primary' | 'mapped' | 'remote-only' | 'existing-remote' | 'skip';
    remotePath?: string;
    baseline?: 'auto' | 'status-only';
    overlay?: boolean;
    mount?: 'symlink';
    assets?: { localPath: string; remotePath?: string }[];
}

export function runUseRemoteRepo(workspace: string, args: UseRemoteRepoArgs): UseResult {
    const remote = loadRemoteSettings(workspace);
    const changed: string[] = [];

    if (args.action === 'set') {
        if (!args.localName || !args.remoteName || !args.role) {
            return {
                ok: false, action: 'use', useTarget: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: T('use.repoSetRequires') }],
                nextAction: 'forja use remote repo set --local <name> --remote <name> --role primary',
            };
        }
        // Validate repo names
        if (!isValidRepoName(args.localName)) {
            return {
                ok: false, action: 'use', useTarget: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.invalidLocalRepoName')}: ${args.localName}` }],
                nextAction: 'forja use remote repo set --local <name> --remote <name> --role primary',
            };
        }
        if (!isValidRepoName(args.remoteName)) {
            return {
                ok: false, action: 'use', useTarget: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.invalidRemoteRepoName')}: ${args.remoteName}` }],
                nextAction: 'forja use remote repo set --local <name> --remote <name> --role primary',
            };
        }
        const repo: RemoteRepoSettings = {
            localName: args.localName,
            remoteName: args.remoteName,
            role: args.role,
        };
        if (args.remotePath) { repo.remotePath = args.remotePath; }
        if (args.baseline) { repo.baseline = args.baseline; }
        if (args.overlay !== undefined) { repo.overlay = args.overlay; }
        if (args.mount) { repo.mount = args.mount; }
        if (args.assets && args.assets.length > 0) { repo.assets = args.assets; }
        remote.repos = [...remote.repos.filter(r => r.localName !== args.localName), repo];
        changed.push('remote.repos');
    } else if (args.action === 'remove') {
        if (!args.localName) {
            return {
                ok: false, action: 'use', useTarget: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: T('use.repoRemoveRequiresLocal') }],
                nextAction: 'forja use remote repo remove --local <name>',
            };
        }
        remote.repos = remote.repos.filter(r => r.localName !== args.localName);
        changed.push('remote.repos');
    } else if (args.action === 'clear') {
        remote.repos = [];
        changed.push('remote.repos');
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote repo settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'remote.repo',
        workspace, changed,
        remote: { repos: remote.repos },
        nextAction: 'forja list remote',
    };
}

export interface UseRemoteForjaBinArgs {
    action: 'set' | 'clear';
    path?: string;
}

export function runUseRemoteForjaBin(workspace: string, args: UseRemoteForjaBinArgs): UseResult {
    const remote = loadRemoteSettings(workspace);
    const changed: string[] = [];

    if (args.action === 'set') {
        if (!args.path) {
            return {
                ok: false, action: 'use', useTarget: 'remote.forjaBin', changed: [],
                diagnostics: [{ level: 'error', message: T('use.forjaBinSetRequiresPath') }],
                nextAction: 'forja use remote forja-bin set --path <path>',
            };
        }
        remote.remoteForjaBin = args.path;
        changed.push('remote.remoteForjaBin');
    } else if (args.action === 'clear') {
        remote.remoteForjaBin = '';
        changed.push('remote.remoteForjaBin');
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote forja-bin settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'remote.forjaBin', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'remote.forjaBin',
        workspace, changed,
        remote: { remoteForjaBin: remote.remoteForjaBin },
        nextAction: 'forja status',
    };
}

export interface UseRemoteBuildOrderArgs {
    action: 'set' | 'clear';
    items?: Array<{ target: 'qt' | 'sdk'; action: string }>;
}

// Valid build order actions per target
const VALID_BUILD_ACTIONS: Record<string, string[]> = {
    qt: ['build', 'clean', 'qmake'],
    sdk: ['build', 'rebuild', 'clean'],
};

export function runUseRemoteBuildOrder(workspace: string, args: UseRemoteBuildOrderArgs): UseResult {
    const remote = loadRemoteSettings(workspace);
    const changed: string[] = [];

    if (args.action === 'set') {
        if (!args.items || args.items.length === 0) {
            return {
                ok: false, action: 'use', useTarget: 'remote.buildOrder', changed: [],
                diagnostics: [{ level: 'error', message: T('use.buildOrderRequiresItem') }],
                nextAction: 'forja use remote build-order set qt:build sdk:rebuild',
            };
        }
        // Validate each item's action
        for (const item of args.items) {
            const validActions = VALID_BUILD_ACTIONS[item.target] || [];
            if (!validActions.includes(item.action)) {
                return {
                    ok: false, action: 'use', useTarget: 'remote.buildOrder', changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.invalidActionFor')} ${item.target}: ${item.action}. ${T('use.validActions')}: ${validActions.join(', ')}` }],
                    nextAction: 'forja use remote build-order set qt:build sdk:rebuild',
                };
            }
        }
        remote.buildOrder = args.items.map(i => ({
            target: i.target,
            action: i.action as RemoteBuildOrderItem['action'],
            args: [],
        }));
        changed.push('remote.buildOrder');
    } else if (args.action === 'clear') {
        remote.buildOrder = [];
        changed.push('remote.buildOrder');
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote build-order settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'remote.buildOrder', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'remote.buildOrder',
        workspace, changed,
        remote: { buildOrder: remote.buildOrder },
        nextAction: 'forja status',
    };
}

export interface UseRemoteTransferArgs {
    action: 'set' | 'clear';
    deployServer?: string;
    deployPath?: string;
    artifacts?: string[];
}

export function runUseRemoteTransfer(workspace: string, args: UseRemoteTransferArgs): UseResult {
    const remote = loadRemoteSettings(workspace);
    const changed: string[] = [];

    if (args.action === 'set') {
        if (!args.deployServer || !args.deployPath) {
            return {
                ok: false, action: 'use', useTarget: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: T('use.transferSetRequiresServerPath') }],
                nextAction: 'forja use remote transfer set --server <name> --path <path> --artifact <path>',
            };
        }
        if (!args.artifacts || args.artifacts.length === 0) {
            return {
                ok: false, action: 'use', useTarget: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: T('use.transferSetRequiresArtifact') }],
                nextAction: 'forja use remote transfer set --server <name> --path <path> --artifact <path>',
            };
        }
        const server = getServerById(args.deployServer);
        if (!server) {
            return {
                ok: false, action: 'use', useTarget: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.serverNotFound')}: ${args.deployServer}` }],
                nextAction: 'forja list servers',
            };
        }
        remote.transfer = {
            deployServer: args.deployServer,
            deployPath: args.deployPath,
            artifacts: args.artifacts,
        };
        changed.push('remote.transfer');
    } else if (args.action === 'clear') {
        remote.transfer = null;
        changed.push('remote.transfer');
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote transfer settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'remote.transfer',
        workspace, changed,
        remote: { transfer: remote.transfer },
        nextAction: 'forja status',
    };
}

export interface UseQtArgs {
    qtPath?: string;
    vsDevShell?: string;
    qmakeTarget?: string;
    qmakeArgs?: string;
}

export function runUseQt(workspace: string, args: UseQtArgs): UseResult {
    const qt = loadQtSettings(workspace);
    const changed: string[] = [];

    // Validate qmakeTarget if provided
    if (args.qmakeTarget !== undefined && args.qmakeTarget.trim() === '') {
        return {
            ok: false, action: 'use', useTarget: 'qt', changed: [],
            diagnostics: [{ level: 'error', message: T('use.qmakeTargetCannotBeEmpty') }],
            nextAction: 'forja use qt --qmake-target <name>',
        };
    }

    if (args.qtPath) { qt.qtPath = args.qtPath; changed.push('qt.qtPath'); }
    if (args.vsDevShell) {
        const inferred = inferVsInstall(args.vsDevShell);
        qt.vsInstall = inferred || args.vsDevShell;
        changed.push('qt.vsInstall');
    }
    if (args.qmakeTarget) { qt.target = args.qmakeTarget; changed.push('qt.target'); }
    if (args.qmakeArgs) { qt.qmakeArgs = args.qmakeArgs; changed.push('qt.qmakeArgs'); }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'qt', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'qt',
        workspace, changed,
        nextAction: 'forja status',
    };
}

export interface UseSdkArgs {
    vsDevCmd?: string;
}

export function runUseSdk(workspace: string, args: UseSdkArgs): UseResult {
    const sdk = loadSdkSettings(workspace);
    const changed: string[] = [];

    if (args.vsDevCmd) {
        const inferred = inferVsInstall(args.vsDevCmd);
        sdk.vsInstall = inferred || args.vsDevCmd;
        changed.push('sdk.vsInstall');
    }

    if (changed.length > 0) {
        const saveResult_1 = safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
        if (!saveResult_1.ok) {
            return { ok: false, action: 'use', useTarget: 'sdk', changed: [],
                diagnostics: [{ level: 'error', message: saveResult_1.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useTarget: 'sdk',
        workspace, changed,
        nextAction: 'forja status',
    };
}

export function runUseLang(value: string, locale: Locale): UseResult {
    if (value !== 'zh' && value !== 'en') {
        return {
            ok: false, action: 'use', useTarget: 'lang', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidLanguage')}: ${value}. ${T('use.useZhOrEn')}` }],
            nextAction: 'forja use lang zh',
        };
    }
    const saveResult = safeSave(() => saveGlobalConfig({ lang: value }), 'Global config');
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useTarget: 'lang', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveLanguage')}: ${saveResult.error}` }],
            nextAction: 'forja use lang zh',
        };
    }
    return {
        ok: true, action: 'use', useTarget: 'lang', changed: ['lang'],
        diagnostics: [{ level: 'info', message: `${T('langSetPrefix')} ${value}` }],
    };
}
