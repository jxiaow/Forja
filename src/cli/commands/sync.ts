/**
 * `forja sync` — sync changed files to remote.
 * Each action is a standalone function; no monolithic dispatcher.
 */
import { loadSyncSettings, loadRemoteSettings } from '../../core/settingsIO';
import { getServerById } from '../../core/serverStore';
import { planSyncCli, executeSyncCli, resetSyncCli, statusSyncCli } from '../../sync/cli';
import { executeRemoteTransfer } from '../../remote/core/transfer';
import { resolveRemoteConfig, resolveRemotePrimaryActionPath } from '../../remote/core/config';
import { createSshRunner } from '../../remote/core/shell';
import { Diagnostic, SyncPlan, diag, Locale, T } from './types';

// ── Types ──

export type SyncAction = 'run' | 'plan' | 'reset' | 'transfer' | 'status';

export interface SyncResult {
    ok: boolean;
    action: 'sync';
    syncAction: SyncAction;
    workspace?: string;
    plan?: SyncPlan;
    server?: string;
    remotePath?: string;
    uploaded?: string[];
    deleted?: string[];
    skipped?: string[];
    transfer?: {
        configured: boolean;
        planned?: boolean;
        executed?: boolean;
        artifacts?: string[];
    };
    status?: {
        ready: boolean;
        enabled: boolean;
        server: { id: string; name: string; host: string; port: number; username: string; authMode: string } | null;
        remotePath: string;
        missing: string[];
    };
    diagnostics?: Diagnostic[];
    nextAction?: string;
    [key: string]: unknown;
}

interface SyncOptions {
    file?: string[];
    repo?: string;
    server?: string;
}

// ── Formatter ──

export function formatSyncText(result: SyncResult, locale: Locale): string {
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
            const a = result.nextAction; lines.push(`  ${a}`);
        }
        return lines.join('\n');
    }

    switch (result.syncAction) {
        case 'plan': {
            lines.push(T('syncPlan'));
            if (result.server) { lines.push(`  ${T('serverLabel')} ${result.server}`); }
            if (result.remotePath) { lines.push(`  ${T('remotePathLabel')} ${result.remotePath}`); }
            if (result.plan) {
                if (result.plan.pending?.length) {
                    lines.push(`  ${T('pending')} (${result.plan.pending.length}):`);
                    for (const f of result.plan.pending) { lines.push(`    ${f}`); }
                }
                if (result.plan.deleted?.length) {
                    lines.push(`  ${T('deleted')} (${result.plan.deleted.length}):`);
                    for (const f of result.plan.deleted) { lines.push(`    ${f}`); }
                }
                if (result.plan.skipped?.length) {
                    lines.push(`  ${T('skipped')} (${result.plan.skipped.length}):`);
                    for (const f of result.plan.skipped) { lines.push(`    ${f}`); }
                }
            }
            break;
        }
        case 'run': {
            lines.push(T('syncComplete'));
            if (result.server) { lines.push(`  ${T('serverLabel')} ${result.server}`); }
            if (result.remotePath) { lines.push(`  ${T('remotePathLabel')} ${result.remotePath}`); }
            if (result.uploaded?.length) {
                lines.push(`  ${T('uploaded')} (${result.uploaded.length}):`);
                for (const f of result.uploaded) { lines.push(`    ${f}`); }
            }
            if (result.deleted?.length) {
                lines.push(`  ${T('deleted')} (${result.deleted.length}):`);
                for (const f of result.deleted) { lines.push(`    ${f}`); }
            }
            if (result.skipped?.length) {
                lines.push(`  ${T('skipped')} (${result.skipped.length})`);
            }
            break;
        }
        case 'reset': {
            lines.push(T('syncStateReset'));
            break;
        }
        case 'transfer': {
            lines.push(T('transferComplete'));
            if (result.transfer?.artifacts?.length) {
                lines.push(`  ${T('artifacts')} (${result.transfer.artifacts.length}):`);
                for (const f of result.transfer.artifacts) { lines.push(`    ${f}`); }
            }
            break;
        }
        case 'status': {
            lines.push(T('syncStatus'));
            if (result.status) {
                const s = result.status;
                lines.push(`  ${T('syncEnabled')} ${s.enabled ? T('enabledStatus') : T('disabledStatus')}`);
                if (s.server) {
                    lines.push(`  ${T('syncServer')} ${s.server.name} (${s.server.username}@${s.server.host}:${s.server.port})`);
                    lines.push(`  ${T('syncAuth')} ${s.server.authMode}`);
                } else {
                    lines.push(`  ${T('syncServer')} -`);
                }
                lines.push(`  ${T('syncRemotePath')} ${s.remotePath || '-'}`);
                lines.push(`  ${s.ready ? T('syncReady') : T('syncNotReady')}`);
                if (s.missing.length > 0) {
                    const missingMsgs: Record<string, string> = {
                        enabled: T('syncMissingEnabled'),
                        servers: T('syncMissingServers'),
                        selectedServer: T('syncMissingSelectedServer'),
                        server: T('syncMissingServer'),
                        remotePath: T('syncMissingRemotePath'),
                    };
                    for (const key of s.missing) {
                        const msg = missingMsgs[key] || key;
                        lines.push(`  ${msg}`);
                    }
                }
            }
            break;
        }
    }

    if (result.nextAction) {
        lines.push(T('next'));
        const a = result.nextAction; lines.push(`  ${a}`);
    }
    return lines.join('\n');
}

// ── Shared validation ──

interface ResolvedServer {
    serverId: string;
    serverName: string;
    remotePath: string;
}

function validateSyncConfig(workspace: string, options: SyncOptions): { resolved: ResolvedServer } | { error: SyncResult } {
    const syncConfig = loadSyncSettings(workspace);
    const serverId = options.server || syncConfig.selectedServer;

    if (!serverId) {
        return {
            error: {
                ok: false, action: 'sync', syncAction: 'run', workspace,
                diagnostics: [diag('error', T('sync.notConfigured'))],
                nextAction: 'forja list servers',
            },
        };
    }
    const server = getServerById(serverId);
    if (!server) {
        return {
            error: {
                ok: false, action: 'sync', syncAction: 'run', workspace,
                diagnostics: [diag('error', `${T('sync.serverNotFound')}: ${serverId}`)],
                nextAction: 'forja list servers',
            },
        };
    }
    const remotePath = syncConfig.remotePaths[serverId];
    if (!remotePath) {
        return {
            error: {
                ok: false, action: 'sync', syncAction: 'run', workspace,
                diagnostics: [diag('error', T('sync.remotePathMissing'))],
                nextAction: 'forja use sync --server <name> --remote-path <path>',
            },
        };
    }
    return { resolved: { serverId: server.id, serverName: server.name, remotePath } };
}

// ── Action functions ──

export async function runSyncPlan(workspace: string, options: SyncOptions): Promise<SyncResult> {
    const validation = validateSyncConfig(workspace, options);
    if ('error' in validation) { return validation.error; }

    const repoFilter = options.repo;
    const fileFilters = options.file ?? [];
    const resolvedServer = options.server || undefined;

    try {
        const plan = await planSyncCli(workspace, resolvedServer, repoFilter, fileFilters);
        return {
            ok: plan.ok,
            action: 'sync',
            syncAction: 'plan',
            workspace,
            plan: {
                mode: 'dryRun',
                server: plan.server,
                remotePath: plan.remotePath,
                repos: plan.repos,
                pending: plan.pending,
                deleted: plan.deleted,
                skipped: plan.skipped,
            },
            server: plan.server,
            remotePath: plan.remotePath,
            diagnostics: plan.ok ? undefined : plan.failed.map(f => diag('error', `${T('sync.planFailed')}: ${f.error}`)),
            nextAction: plan.ok ? 'forja sync' : 'forja doctor --remote',
        };
    } catch (e) {
        return syncCatchResult('plan', workspace, e);
    }
}

export async function runSyncExecute(workspace: string, options: SyncOptions): Promise<SyncResult> {
    const validation = validateSyncConfig(workspace, options);
    if ('error' in validation) { return validation.error; }

    const repoFilter = options.repo;
    const fileFilters = options.file ?? [];
    const resolvedServer = options.server || undefined;

    try {
        const result = await executeSyncCli(workspace, resolvedServer, repoFilter, fileFilters);
        return {
            ok: result.ok,
            action: 'sync',
            syncAction: 'run',
            workspace,
            server: result.server,
            remotePath: result.remotePath,
            uploaded: result.uploaded,
            deleted: result.deleted,
            skipped: result.skipped,
            diagnostics: result.ok ? undefined : result.failed.map(f => diag('error', `${T('sync.syncFailed')}: ${f.error}`)),
            nextAction: result.ok ? 'forja status' : 'forja doctor --remote',
        };
    } catch (e) {
        return syncCatchResult('run', workspace, e);
    }
}

export function runSyncReset(workspace: string): SyncResult {
    const reset = resetSyncCli(workspace);
    return {
        ok: reset.ok,
        action: 'sync',
        syncAction: 'reset',
        workspace,
        diagnostics: reset.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
        nextAction: reset.nextAction,
    };
}

export async function runSyncTransfer(workspace: string): Promise<SyncResult> {
    const remoteSettings = loadRemoteSettings(workspace);
    const transfer = remoteSettings.transfer;
    if (!transfer) {
        return {
            ok: false, action: 'sync', syncAction: 'transfer', workspace,
            diagnostics: [diag('error', T('sync.transferNotConfigured'))],
            nextAction: 'forja doctor --remote',
        };
    }
    const resolved = resolveRemoteConfig(workspace);
    if (!resolved.config) {
        return {
            ok: false, action: 'sync', syncAction: 'transfer', workspace,
            diagnostics: resolved.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: resolved.nextAction,
        };
    }
    const deployServer = getServerById(transfer.deployServer);
    if (!deployServer) {
        return {
            ok: false, action: 'sync', syncAction: 'transfer', workspace,
            diagnostics: [diag('error', `${T('sync.transferServerMissing')}: ${transfer.deployServer}`)],
            nextAction: 'forja list servers',
        };
    }

    try {
        const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
        const runner = createSshRunner(resolved.config.server, password);
        const actionRemotePath = resolveRemotePrimaryActionPath(resolved.config.workspace, resolved.config.remotePath);
        const transferResult = await executeRemoteTransfer({ remotePath: actionRemotePath, transfer, deployServer, runner });
        return {
            ok: transferResult.ok,
            action: 'sync',
            syncAction: 'transfer',
            workspace,
            transfer: {
                configured: true,
                executed: transferResult.ok,
                artifacts: transferResult.transferred?.map(t => t.source),
            },
            diagnostics: transferResult.ok ? undefined : transferResult.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: transferResult.ok ? 'forja status' : 'forja doctor --remote',
        };
    } catch (e) {
        return syncCatchResult('transfer', workspace, e);
    }
}

export function runSyncStatus(workspace: string, options: SyncOptions): SyncResult {
    const st = statusSyncCli(workspace, options.server || undefined);
    return {
        ok: st.ok,
        action: 'sync',
        syncAction: 'status',
        workspace,
        status: {
            ready: st.ready,
            enabled: st.checks.enabled,
            server: st.server ? { id: st.server.id, name: st.server.name, host: st.server.host, port: st.server.port, username: st.server.username, authMode: st.server.authMode } : null,
            remotePath: st.remotePath,
            missing: st.missing,
        },
        nextAction: st.nextAction,
    };
}

// ── Helpers ──

function syncCatchResult(syncAction: SyncAction, workspace: string, e: unknown): SyncResult {
    const message = e instanceof Error ? e.message : String(e);
    return {
        ok: false, action: 'sync', syncAction, workspace,
        diagnostics: [diag('error', `${T('sync.remoteBlocked')}: ${message}`)],
        nextAction: 'forja doctor --remote',
    };
}
