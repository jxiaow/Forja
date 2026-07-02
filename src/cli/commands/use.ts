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

// ── Config summary ──

export interface ConfigSummary {
    qt?: { configured: boolean; project?: string; mode?: string; arch?: string; qtPath?: string; vsInstall?: string; target?: string; qmakeArgs?: string };
    sdk?: { configured: boolean; project?: string; mode?: string; arch?: string; vsInstall?: string };
    sync?: { configured: boolean; enabled: boolean; selectedServer?: string; remotePath?: string };
    remote?: { configured: boolean; server?: string; remotePath?: string };
}

function buildConfigSummary(workspace: string, scope: string, target?: ActiveTarget): ConfigSummary | undefined {
    switch (scope) {
        case 'target':
        case 'qt': {
            if (target?.kind === 'qt') {
                const qt = loadQtSettings(workspace);
                return { qt: { configured: true, project: qt.pinnedProject?.relative, mode: qt.mode, arch: qt.arch, qtPath: qt.qtPath, vsInstall: qt.vsInstall, target: qt.target, qmakeArgs: qt.qmakeArgs } };
            }
            if (target?.kind === 'sdk') {
                const sdk = loadSdkSettings(workspace);
                return { sdk: { configured: true, project: sdk.pinnedProject ?? undefined, mode: sdk.mode, arch: sdk.arch, vsInstall: sdk.vsInstall } };
            }
            return undefined;
        }
        case 'sync': {
            const sync = loadSyncSettings(workspace);
            const hasConfig = !!(sync.selectedServer || sync.enabled);
            return { sync: { configured: hasConfig, enabled: sync.enabled, selectedServer: sync.selectedServer, remotePath: sync.selectedServer ? sync.remotePaths[sync.selectedServer] : undefined } };
        }
        case 'remote': {
            const remote = loadRemoteSettings(workspace);
            const hasConfig = !!remote.selectedServer;
            return { remote: { configured: hasConfig, server: remote.selectedServer, remotePath: remote.selectedServer ? remote.remotePaths[remote.selectedServer] : undefined } };
        }
        default:
            return undefined;
    }
}

// ── Text formatting ──

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
            lines.push(`  ${result.nextAction}`);
        } else if (result.nextActions && (result.nextActions as string[]).length > 0) {
            lines.push(T('next'));
            for (const a of result.nextActions as string[]) { lines.push(`  ${a}`); }
        }
        return lines.join('\n');
    }

    const scope = result.useScope || 'use';
    lines.push(`${scope} ${T('updated')}`);

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
        lines.push(`  ${result.nextAction}`);
    } else if (result.nextActions && (result.nextActions as string[]).length > 0) {
        lines.push(T('next'));
        for (const a of result.nextActions as string[]) { lines.push(`  ${a}`); }
    }
    return lines.join('\n');
}

// ── Result interface ──

export interface UseResult extends ForjaJsonResult {
    action: 'use';
    useScope?: string;  // 'target' | 'execution' | 'sync' | 'remote' | 'remote.workspace' | 'remote.repo' | 'remote.forjaBin' | 'remote.buildOrder' | 'remote.transfer' | 'qt' | 'sdk' | 'lang'
    activeTarget?: ActiveTarget;
    config?: ConfigSummary;
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

// ── Helpers for runUseTarget ──

function resolveProjectPath(workspace: string, projectInput: string): { resolvedPath: string; matchedCandidate?: { label: string; project: string } } | { error: UseResult } {
    const projectPath = path.isAbsolute(projectInput) ? projectInput : path.join(workspace, projectInput);

    if (fs.existsSync(projectPath) && !fs.statSync(projectPath).isDirectory()) {
        return { resolvedPath: projectInput };
    }

    const candidates = collectTargetCandidates(workspace);
    const inputLower = path.basename(projectInput).toLowerCase();
    const matches = candidates.filter(c => c.label.toLowerCase() === inputLower);

    if (matches.length === 1) {
        return { resolvedPath: matches[0].project, matchedCandidate: matches[0] };
    }
    if (matches.length > 1) {
        return {
            error: {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${projectInput}. ${T('idx.didYouMean')}: ${matches.map(m => m.project).join(', ')}?` }],
                nextActions: matches.map(m => `forja use target --project ${m.project}`),
            },
        };
    }

    return {
        error: {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${projectInput}` }],
            nextAction: 'forja list targets',
        },
    };
}

function inferKind(filePath: string): 'qt' | 'sdk' | null {
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    if (ext === '.pro') { return 'qt'; }
    if (ext === '.sln' || base === 'makefile' || base === 'cmakelists.txt') { return 'sdk'; }
    return null;
}

function saveDomainConfig(workspace: string, kind: 'qt' | 'sdk', finalPath: string, mode: 'debug' | 'release', arch: 'x86' | 'x64'): { ok: true } | { ok: false; error: string } {
    const relativeProject = path.relative(workspace, finalPath).replace(/\\/g, '/');
    if (kind === 'qt') {
        const qt = loadQtSettings(workspace);
        qt.pinnedProject = { root: workspace, relative: relativeProject };
        qt.mode = mode;
        qt.arch = arch;
        return safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
    }
    const sdk = loadSdkSettings(workspace);
    sdk.pinnedProject = relativeProject;
    sdk.mode = mode;
    sdk.arch = arch;
    return safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
}

function updateDomainModeArch(workspace: string, kind: 'qt' | 'sdk', mode?: 'debug' | 'release', arch?: 'x86' | 'x64'): { ok: true } | { ok: false; error: string } {
    if (kind === 'qt') {
        const qt = loadQtSettings(workspace);
        if (mode) { qt.mode = mode; }
        if (arch) { qt.arch = arch; }
        return safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
    }
    const sdk = loadSdkSettings(workspace);
    if (mode) { sdk.mode = mode; }
    if (arch) { sdk.arch = arch; }
    return safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
}

// ── runUseTarget ──

export interface UseTargetArgs {
    project?: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
}

export function runUseTarget(workspace: string, args: UseTargetArgs): UseResult {
    const changed: string[] = [];

    if (!fs.existsSync(workspace)) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.workspaceNotFound')}: ${workspace}` }],
        };
    }

    if (args.mode && args.mode !== 'debug' && args.mode !== 'release') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidMode')}: ${args.mode}. ${T('use.invalidModeDetail')}` }],
            nextAction: 'forja use target --mode debug',
        };
    }

    if (args.arch && args.arch !== 'x86' && args.arch !== 'x64') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidArch')}: ${args.arch}. ${T('use.invalidArchDetail')}` }],
            nextAction: 'forja use target --arch x64',
        };
    }

    const currentTarget = getActiveTarget(workspace);

    // --project: select or switch target
    if (args.project) {
        const resolveResult = resolveProjectPath(workspace, args.project);
        if ('error' in resolveResult) { return resolveResult.error; }

        const { resolvedPath, matchedCandidate } = resolveResult;
        const finalPath = path.isAbsolute(resolvedPath) ? resolvedPath : path.join(workspace, resolvedPath);

        if (!fs.existsSync(finalPath)) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${args.project}` }],
                nextAction: 'forja list targets',
            };
        }

        // Reject relative paths that escape the workspace boundary
        if (!path.isAbsolute(resolvedPath)) {
            const resolved = path.join(workspace, resolvedPath);
            const relCheck = path.relative(workspace, resolved);
            if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
                return {
                    ok: false, action: 'use', useScope: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.projectOutsideWorkspace')}: ${args.project}` }],
                    nextAction: 'forja list targets',
                };
            }
        }

        // Infer kind from the resolved file path (not the original user input)
        const kind = inferKind(finalPath);
        if (!kind) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.cannotDetermineKind')}: ${finalPath}. ${T('use.expectedExtensions')}` }],
                nextAction: 'forja list targets',
            };
        }

        const mode = args.mode ?? currentTarget?.mode ?? 'debug';
        const arch = args.arch ?? currentTarget?.arch ?? (process.platform === 'win32' ? 'x86' : 'x64');
        const runAt = currentTarget?.runAt ?? 'local';

        const newTarget: ActiveTarget = { kind, project: resolvedPath, mode, arch, runAt };

        const domainSave = saveDomainConfig(workspace, kind, finalPath, mode, arch);
        if (!domainSave.ok) {
            return { ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: domainSave.error }],
                nextAction: 'forja doctor' };
        }
        changed.push(kind === 'qt' ? 'qt.pinnedProject' : 'sdk.pinnedProject');

        try {
            setActiveTarget(workspace, newTarget);
        } catch (e) {
            return { ok: false, action: 'use', useScope: 'target', changed,
                diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${e instanceof Error ? e.message : e}` }],
                nextAction: 'forja doctor' };
        }
        changed.push('activeTarget');

        return {
            ok: true, action: 'use', useScope: 'target',
            workspace, activeTarget: newTarget,
            config: buildConfigSummary(workspace, 'target', newTarget),
            changed,
            nextAction: 'forja status',
        };
    }

    // --mode / --arch without --project: update current target
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const updated = { ...currentTarget };
    if (args.mode && args.mode !== currentTarget.mode) { updated.mode = args.mode; changed.push('activeTarget.mode'); }
    if (args.arch && args.arch !== currentTarget.arch) { updated.arch = args.arch; changed.push('activeTarget.arch'); }

    if (changed.length > 0) {
        const domainSave = updateDomainModeArch(workspace, updated.kind,
            args.mode && args.mode !== currentTarget.mode ? args.mode : undefined,
            args.arch && args.arch !== currentTarget.arch ? args.arch : undefined);
        if (!domainSave.ok) {
            return { ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: domainSave.error }],
                nextAction: 'forja doctor' };
        }
        try {
            setActiveTarget(workspace, updated);
        } catch (e) {
            return { ok: false, action: 'use', useScope: 'target', changed,
                diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${e instanceof Error ? e.message : e}` }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'target',
        workspace, activeTarget: updated,
        config: buildConfigSummary(workspace, 'target', updated),
        changed,
        nextAction: 'forja status',
    };
}

// ── runUseExecution ──

export function runUseExecution(workspace: string, local: boolean, remote: boolean): UseResult {
    if (local && remote) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.cannotSpecifyBothLocalRemote') }],
            nextAction: 'forja use execution --local',
        };
    }
    if (!local && !remote) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.mustSpecifyLocalOrRemote') }],
            nextAction: 'forja use execution --local',
        };
    }

    const currentTarget = getActiveTarget(workspace);
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const runAt: 'local' | 'remote' = remote ? 'remote' : 'local';
    if (currentTarget.runAt === runAt) {
        return {
            ok: true, action: 'use', useScope: 'execution',
            workspace, activeTarget: currentTarget, changed: [],
            nextAction: 'forja status',
        };
    }

    const updated = { ...currentTarget, runAt };
    const saveResult = safeSave(() => setActiveTarget(workspace, updated), 'Active target');
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveExecMode')}: ${saveResult.error}` }],
            nextAction: 'forja use execution --local',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'execution',
        workspace, activeTarget: updated, changed: ['activeTarget.runAt'],
        nextAction: 'forja status',
    };
}

// ── runUseSync ──

export interface UseSyncArgs {
    server?: string;
    remotePath?: string;
    enable?: boolean;
    disable?: boolean;
}

export function runUseSync(workspace: string, args: UseSyncArgs): UseResult {
    const sync = loadSyncSettings(workspace);
    const changed: string[] = [];

    if (args.enable && args.disable) {
        return {
            ok: false, action: 'use', useScope: 'sync', changed: [],
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
                ok: false, action: 'use', useScope: 'sync', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.serverNotFound')}: ${args.server}` }],
                nextAction: 'forja server',
            };
        }
        sync.selectedServer = server.id;
        changed.push('sync.selectedServer');

        if (!args.remotePath) {
            return {
                ok: false, action: 'use', useScope: 'sync', changed: [],
                diagnostics: [{ level: 'error', message: T('use.remotePathRequired') }],
                nextAction: 'forja use sync --server <name> --remote-path <path>',
            };
        }
    }

    if (args.remotePath && sync.selectedServer) {
        sync.remotePaths[sync.selectedServer] = args.remotePath;
        changed.push('sync.remotePath');
    } else if (args.remotePath && !sync.selectedServer) {
        return {
            ok: false, action: 'use', useScope: 'sync', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noServerConfigured') }],
            nextAction: 'forja use sync --server <name> --remote-path <path>',
        };
    }

    if (changed.length > 0) {
        const saveResult = safeSave(() => saveSyncSettings(workspace, sync), 'Sync settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'sync', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'sync',
        workspace, changed,
        config: buildConfigSummary(workspace, 'sync'),
        nextAction: 'forja status',
    };
}

// ── runUseRemote ──

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
                ? `${T('use.ambiguousServerName')}: ${args.server}. ${T('use.useServerIdInstead')}`
                : `${T('use.serverNotFound')}: ${args.server}`;
            return {
                ok: false, action: 'use', useScope: 'remote', changed: [],
                diagnostics: [{ level: 'error', message: msg }],
                nextAction: 'forja server',
            };
        }
        remote.selectedServer = resolved.server.id;
        changed.push('remote.selectedServer');
    }

    if (args.remotePath && remote.selectedServer) {
        remote.remotePaths[remote.selectedServer] = args.remotePath;
        changed.push('remote.remotePath');
    } else if (args.remotePath && !remote.selectedServer) {
        return {
            ok: false, action: 'use', useScope: 'remote', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noServerConfigured') }],
            nextAction: 'forja use remote --server <name>',
        };
    }

    if (changed.length > 0) {
        const saveResult = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'remote', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'remote',
        workspace, changed,
        config: buildConfigSummary(workspace, 'remote'),
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
                ok: false, action: 'use', useScope: 'remote.workspace', changed: [],
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
        changed.push('remote.workspaceMode', 'remote.remoteWorkspace', 'remote.profile');
    }

    if (changed.length > 0) {
        const saveResult = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote workspace settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'remote.workspace', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'remote.workspace',
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
                ok: false, action: 'use', useScope: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: T('use.repoSetRequires') }],
                nextAction: 'forja use remote repo set --local <name> --remote <name> --role primary',
            };
        }
        if (!isValidRepoName(args.localName)) {
            return {
                ok: false, action: 'use', useScope: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.invalidLocalRepoName')}: ${args.localName}` }],
                nextAction: 'forja use remote repo set --local <name> --remote <name> --role primary',
            };
        }
        if (!isValidRepoName(args.remoteName)) {
            return {
                ok: false, action: 'use', useScope: 'remote.repo', changed: [],
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
                ok: false, action: 'use', useScope: 'remote.repo', changed: [],
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
        const saveResult = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote repo settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'remote.repo', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'remote.repo',
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
                ok: false, action: 'use', useScope: 'remote.forjaBin', changed: [],
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
        const saveResult = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote forja-bin settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'remote.forjaBin', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'remote.forjaBin',
        workspace, changed,
        remote: { remoteForjaBin: remote.remoteForjaBin },
        nextAction: 'forja status',
    };
}

export interface UseRemoteBuildOrderArgs {
    action: 'set' | 'clear';
    items?: Array<{ target: 'qt' | 'sdk'; action: string }>;
    /** Raw positional tokens that failed to parse — used for error reporting */
    invalidItems?: string[];
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
        // Report unparseable positional tokens as an error
        if (args.invalidItems && args.invalidItems.length > 0) {
            return {
                ok: false, action: 'use', useScope: 'remote.buildOrder', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.invalidActionFor')} ${args.invalidItems.join(', ')}. ${T('use.validActions')}: qt:${VALID_BUILD_ACTIONS.qt.join('|')}, sdk:${VALID_BUILD_ACTIONS.sdk.join('|')}` }],
                nextAction: 'forja use remote build-order set qt:build sdk:rebuild',
            };
        }
        if (!args.items || args.items.length === 0) {
            return {
                ok: false, action: 'use', useScope: 'remote.buildOrder', changed: [],
                diagnostics: [{ level: 'error', message: T('use.buildOrderRequiresItem') }],
                nextAction: 'forja use remote build-order set qt:build sdk:rebuild',
            };
        }
        for (const item of args.items) {
            const validActions = VALID_BUILD_ACTIONS[item.target] || [];
            if (!validActions.includes(item.action)) {
                return {
                    ok: false, action: 'use', useScope: 'remote.buildOrder', changed: [],
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
        const saveResult = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote build-order settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'remote.buildOrder', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'remote.buildOrder',
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
                ok: false, action: 'use', useScope: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: T('use.transferSetRequiresServerPath') }],
                nextAction: 'forja use remote transfer set --server <name> --path <path> --artifact <path>',
            };
        }
        if (!args.artifacts || args.artifacts.length === 0) {
            return {
                ok: false, action: 'use', useScope: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: T('use.transferSetRequiresArtifact') }],
                nextAction: 'forja use remote transfer set --server <name> --path <path> --artifact <path>',
            };
        }
        const server = getServerById(args.deployServer);
        if (!server) {
            return {
                ok: false, action: 'use', useScope: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.serverNotFound')}: ${args.deployServer}` }],
                nextAction: 'forja server',
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
        const saveResult = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote transfer settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'remote.transfer', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'remote.transfer',
        workspace, changed,
        remote: { transfer: remote.transfer },
        nextAction: 'forja status',
    };
}

// ── runUseQt ──

export interface UseQtArgs {
    qtPath?: string;
    vsDevShell?: string;
    qmakeTarget?: string;
    qmakeArgs?: string;
}

export function runUseQt(workspace: string, args: UseQtArgs): UseResult {
    const qt = loadQtSettings(workspace);
    const changed: string[] = [];

    if (args.qmakeTarget !== undefined && args.qmakeTarget.trim() === '') {
        return {
            ok: false, action: 'use', useScope: 'qt', changed: [],
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
        const saveResult = safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'qt', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    const currentTarget = getActiveTarget(workspace);
    return {
        ok: true, action: 'use', useScope: 'qt',
        workspace, changed,
        config: buildConfigSummary(workspace, 'qt', currentTarget ?? undefined),
        nextAction: 'forja status',
    };
}

// ── runUseSdk ──

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
        const saveResult = safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'use', useScope: 'sdk', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    const currentTarget = getActiveTarget(workspace);
    return {
        ok: true, action: 'use', useScope: 'sdk',
        workspace, changed,
        config: buildConfigSummary(workspace, 'target', currentTarget ?? undefined),
        nextAction: 'forja status',
    };
}

// ── runUseLang ──

export function runUseLang(value: string, locale: Locale): UseResult {
    if (value !== 'zh' && value !== 'en') {
        return {
            ok: false, action: 'use', useScope: 'lang', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidLanguage')}: ${value}. ${T('use.useZhOrEn')}` }],
            nextAction: 'forja use lang zh',
        };
    }
    const saveResult = safeSave(() => saveGlobalConfig({ lang: value }), 'Global config');
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useScope: 'lang', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveLanguage')}: ${saveResult.error}` }],
            nextAction: 'forja use lang zh',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'lang', changed: ['lang'],
    };
}
