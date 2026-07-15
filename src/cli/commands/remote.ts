/**
 * `forja remote` — remote configuration and repo operations.
 * Top-level command: show config, set server/path, restore/reset remote repos.
 */
import { ForjaJsonResult, Diagnostic, Locale, T } from './types';
import {
    loadRemoteSettings, saveRemoteSettings,
    RemoteRepoSettings, RemoteBuildOrderItem, RemoteTransferSettings,
} from '../../core/settingsIO';
import { resolveServerSelector } from '../../core/serverStore';
import { executeRemoteRestore } from '../../remote/core/restore';
import { executeRemoteCleanUntracked } from '../../remote/core/cleanUntracked';
import { createSshRunner, remoteCommand } from '../../remote/core/shell';
import { resolveRemoteConfig, resolveRemoteActionPath } from '../../remote/core/config';
import { buildRemoteRepoDirSetup } from '../../remote/core/repoPath';
import { ServerConfig } from '../../core/serverStore';
import * as path from 'path';

function resolveSshPassword(server: ServerConfig): string | null {
    return server.password || process.env.FORJA_SSH_PASSWORD || null;
}

// Helper to safely save settings and return error result on failure
function safeSave(fn: () => void, configName: string): { ok: true } | { ok: false; error: string } {
    try {
        fn();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: `${T('cmd.failedToSave')} ${configName}: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// ── Result interface ──

export type RemoteAction = 'show' | 'set' | 'restore' | 'reset';

export interface RemoteResult extends ForjaJsonResult {
    action: 'remote';
    remoteAction: RemoteAction;
    changed: string[];
    remote?: {
        selectedServer?: string;
        remotePath?: string;
        workspaceMode?: 'legacy' | 'staged';
        remoteWorkspace?: string;
        profile?: string;
        repos?: RemoteRepoSettings[];
        remoteForjaBin?: string;
        buildOrder?: RemoteBuildOrderItem[];
        transfer?: RemoteTransferSettings | null;
        restored?: number;
        resetPaths?: number;
        cleaned?: number;
    };
}

// ── Text formatting ──

export function formatRemoteText(result: RemoteResult, locale: Locale): string {
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

    switch (result.remoteAction) {
        case 'show': {
            lines.push(T('remoteLabel'));
            const r = result.remote;
            if (!r || (!r.selectedServer && !r.remoteWorkspace && !r.remoteForjaBin)) {
                lines.push(`  ${T('doctorNoServer')}`);
            } else {
                if (r.selectedServer) {
                    lines.push(`  ${T('serverLabel')} ${r.selectedServer}`);
                }
                if (r.remotePath) {
                    lines.push(`  ${T('remotePathLabel')} ${r.remotePath}`);
                }
                if (r.workspaceMode && r.workspaceMode !== 'legacy') {
                    lines.push(`  ${T('workspaceMode')}: ${r.workspaceMode}`);
                }
                if (r.remoteWorkspace) {
                    lines.push(`  ${T('remoteWorkspace')}: ${r.remoteWorkspace}`);
                }
                if (r.profile) {
                    lines.push(`  ${T('profile')}: ${r.profile}`);
                }
                if (r.remoteForjaBin) {
                    lines.push(`  ${T('forjaBin')}: ${r.remoteForjaBin}`);
                }
                if (r.buildOrder && r.buildOrder.length > 0) {
                    lines.push(`  ${T('buildOrder')}:`);
                    for (const b of r.buildOrder) { lines.push(`    ${b.target}:${b.action}`); }
                }
                if (r.repos && r.repos.length > 0) {
                    lines.push(`  ${T('repos')}:`);
                    for (const rp of r.repos) { lines.push(`    ${rp.localName} → ${rp.remoteName}  role=${rp.role}`); }
                }
                if (r.transfer !== undefined) {
                    if (r.transfer === null) {
                        lines.push(`  ${T('transfer')}: ${T('cleared')}`);
                    } else {
                        lines.push(`  ${T('transfer')}: ${r.transfer.deployServer}:${r.transfer.deployPath}`);
                    }
                }
            }
            break;
        }
        case 'set': {
            lines.push(`Remote ${result.remoteAction} ${T('updated')}`);
            if (result.changed && result.changed.length > 0) {
                lines.push(`  ${T('changed')} ${result.changed.join(', ')}`);
            }
            break;
        }
        case 'restore': {
            lines.push(`Remote restore ${T('updated')}`);
            if (result.remote?.restored !== undefined) {
                lines.push(`  ${T('doctorRestored')} ${result.remote.restored} ${T('paths')}`);
            }
            break;
        }
        case 'reset': {
            lines.push(`Remote reset ${T('updated')}`);
            if (result.remote?.resetPaths !== undefined) {
                lines.push(`  ${T('doctorResetDone')} ${result.remote.resetPaths} ${T('paths')}`);
            }
            if (result.remote?.cleaned !== undefined) {
                lines.push(`  ${T('doctorCleanDone')} ${result.remote.cleaned} ${T('paths')}`);
            }
            break;
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

// ── runRemoteShow ──

export function runRemoteShow(workspace: string): RemoteResult {
    const remote = loadRemoteSettings(workspace);

    return {
        ok: true,
        action: 'remote',
        remoteAction: 'show',
        workspace,
        changed: [],
        remote: {
            selectedServer: remote.selectedServer,
            remotePath: remote.selectedServer ? remote.remotePaths[remote.selectedServer] : undefined,
            workspaceMode: remote.workspaceMode,
            remoteWorkspace: remote.remoteWorkspace,
            profile: remote.profile,
            repos: remote.repos.length > 0 ? remote.repos : undefined,
            remoteForjaBin: remote.remoteForjaBin || undefined,
            buildOrder: remote.buildOrder.length > 0 ? remote.buildOrder : undefined,
            transfer: remote.transfer,
        },
    };
}

// ── runRemoteSet ──

export interface RemoteSetArgs {
    server?: string;
    remotePath?: string;
}

export function runRemoteSet(workspace: string, args: RemoteSetArgs): RemoteResult {
    if (!args.server && !args.remotePath) {
        return {
            ok: false, action: 'remote', remoteAction: 'set', changed: [],
            diagnostics: [{ level: 'error', message: T('remote.setRequiresFlag') }],
            nextAction: 'forja remote set --server <name>',
        };
    }
    const remote = loadRemoteSettings(workspace);
    const changed: string[] = [];

    if (args.server) {
        const resolved = resolveServerSelector(args.server);
        if (!resolved.server) {
            const msg = resolved.ambiguous
                ? `${T('use.ambiguousServerName')}: ${args.server}. ${T('use.useServerIdInstead')}`
                : `${T('use.serverNotFound')}: ${args.server}`;
            return {
                ok: false, action: 'remote', remoteAction: 'set', changed: [],
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
            ok: false, action: 'remote', remoteAction: 'set', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noServerConfigured') }],
            nextAction: 'forja remote set --server <name>',
        };
    }

    if (changed.length > 0) {
        const saveResult = safeSave(() => saveRemoteSettings(workspace, remote), 'Remote settings');
        if (!saveResult.ok) {
            return { ok: false, action: 'remote', remoteAction: 'set', changed: [],
                diagnostics: [{ level: 'error', message: saveResult.error }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'remote', remoteAction: 'set',
        workspace, changed,
        remote: {
            selectedServer: remote.selectedServer,
            remotePath: remote.selectedServer ? remote.remotePaths[remote.selectedServer] : undefined,
        },
        nextAction: 'forja status',
    };
}

// ── runRemoteRestore ──

export interface RemoteRestoreArgs {
    repo: string;
    paths: string[];
    server?: string;
}

export async function runRemoteRestore(workspace: string, args: RemoteRestoreArgs): Promise<RemoteResult> {
    const resolved = resolveRemoteConfig(workspace, args.server);
    if (!resolved.config) {
        return {
            ok: false, action: 'remote', remoteAction: 'restore', changed: [],
            diagnostics: resolved.diagnostics.map(d => ({ level: 'error' as const, message: d.message })),
            nextAction: 'forja remote set',
        };
    }

    const password = resolveSshPassword(resolved.config.server);
    const runner = createSshRunner(resolved.config.server, password);
    const remotePath = resolveRemoteActionPath(workspace, resolved.config.remotePath);

    const result = await executeRemoteRestore({
        remotePath, repo: args.repo, paths: args.paths, runner,
    });

    if (result.ok) {
        return {
            ok: true, action: 'remote', remoteAction: 'restore',
            workspace, changed: [`restore.${args.repo}(${result.restored.length} paths)`],
            remote: { restored: result.restored.length },
            nextAction: 'forja status',
        };
    }
    return {
        ok: false, action: 'remote', remoteAction: 'restore', changed: [],
        diagnostics: result.diagnostics.map(d => ({ level: d.level as 'error' | 'warning', message: d.message })),
        nextAction: 'forja doctor',
    };
}

// ── runRemoteReset ──

export interface RemoteResetArgs {
    repo: string;
    paths: string[];
    all?: boolean;
    server?: string;
}

export async function runRemoteReset(workspace: string, args: RemoteResetArgs): Promise<RemoteResult> {
    const resolved = resolveRemoteConfig(workspace, args.server);
    if (!resolved.config) {
        return {
            ok: false, action: 'remote', remoteAction: 'reset', changed: [],
            diagnostics: resolved.diagnostics.map(d => ({ level: 'error' as const, message: d.message })),
            nextAction: 'forja remote set',
        };
    }

    const password = resolveSshPassword(resolved.config.server);
    const runner = createSshRunner(resolved.config.server, password);
    const remotePath = resolveRemoteActionPath(workspace, resolved.config.remotePath);
    const changed: string[] = [];
    const diagnostics: Diagnostic[] = [];
    let resetPaths = 0;
    let cleaned = 0;

    // Validate paths - reject absolute paths and .. segments
    for (const p of args.paths) {
        if (path.isAbsolute(p) || p.includes('..')) {
            return {
                ok: false, action: 'remote', remoteAction: 'reset', changed: [],
                diagnostics: [{ level: 'error', message: `${T('remote.invalidPath')}: ${p}` }],
                nextAction: 'forja remote reset <repo> <paths...>',
            };
        }
    }

    // Reset: git reset --hard HEAD
    const pathArgs = remoteCommand(args.paths);
    const command = buildRemoteRepoDirSetup(remotePath, args.repo, true) + ' cd "$repo_dir" && git reset --hard HEAD -- ' + pathArgs;
    const executed = await runner.run(command, 30000);
    if (executed.exitCode !== 0) {
        return {
            ok: false, action: 'remote', remoteAction: 'reset', changed: [],
            diagnostics: [{ level: 'error', message: executed.stderr.trim() || 'Remote reset failed' }],
            nextAction: 'forja doctor',
        };
    }
    changed.push(`reset.${args.repo}(${args.paths.length} paths)`);
    resetPaths = args.paths.length;

    // --all: also clean untracked files
    if (args.all) {
        const cleanResult = await executeRemoteCleanUntracked({
            remotePath, repo: args.repo, paths: args.paths,
            recursive: true, runner,
        });
        if (cleanResult.ok) {
            changed.push(`clean-untracked.${args.repo}(${cleanResult.cleaned.length} paths)`);
            cleaned = cleanResult.cleaned.length;
        } else {
            // Reset succeeded but clean failed — report as success with warning
            const cleanDetail = cleanResult.diagnostics?.map(d => d.message).join('; ') || 'unknown error';
            diagnostics.push({ level: 'warning', message: `${T('remote.cleanFailedWarning')}: ${cleanDetail}` });
        }
    }

    return {
        ok: true, action: 'remote', remoteAction: 'reset',
        workspace, changed,
        remote: { resetPaths, cleaned },
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        nextAction: 'forja status',
    };
}
