/**
 * `forja sync` — sync changed files to remote.
 */
import { planSyncCli, executeSyncCli, resetSyncCli, ClassifiedChanges } from '../../sync/cli';
import { readProjectSyncConfig, getServerById } from '../../core/serverStore';
import { Diagnostic, SyncPlan, ForjaJsonResult, diag, Locale, T } from './types';

// ── Types ──

export type SyncAction = 'run' | 'plan' | 'reset' | 'status';

export interface SyncResult extends ForjaJsonResult {
    action: 'sync';
    syncAction: SyncAction;
    plan?: SyncPlan;
    server?: string;
    remotePath?: string;
    uploaded?: string[];
    deleted?: string[];
    skipped?: string[];
    // status fields
    enabled?: boolean;
    serverDetail?: { name: string; host: string; username: string; port: number };
    ignore?: string[];
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
        case 'status': {
            lines.push(T('syncLabel'));
            lines.push(`  ${result.enabled ? T('enabledStatus') : T('disabledStatus')}`);
            if (result.serverDetail) {
                const s = result.serverDetail;
                lines.push(`  ${T('serverLabel')} ${s.name} (${s.username}@${s.host}:${s.port})`);
            }
            if (result.remotePath) {
                lines.push(`  ${T('remotePathLabel')} ${result.remotePath}`);
            }
            if (result.ignore?.length) {
                lines.push(`  ${T('syncIgnore')}: ${result.ignore.join(', ')}`);
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

// ── Action functions ──

export async function runSyncPlan(workspace: string, fileFilters: string[] = []): Promise<SyncResult> {
    try {
        const plan = await planSyncCli(workspace, fileFilters);
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
            nextAction: plan.ok ? 'forja sync' : (plan.nextAction || 'forja doctor --remote'),
        };
    } catch (e) {
        return syncCatchResult('plan', workspace, e);
    }
}

export async function runSyncExecute(workspace: string, fileFilters: string[] = [], classified?: ClassifiedChanges): Promise<SyncResult> {
    try {
        const result = await executeSyncCli(workspace, fileFilters, classified);
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
            nextAction: result.ok ? 'forja status' : (result.nextAction || 'forja doctor --remote'),
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

export function runSyncStatus(workspace: string): SyncResult {
    const sync = readProjectSyncConfig(workspace);
    const server = sync.selectedServer ? getServerById(sync.selectedServer) : null;
    const remotePath = server ? (sync.remotePaths[server.id] || '') : '';

    let nextAction: string;
    if (!sync.enabled || !server) {
        nextAction = 'forja sync --server <name> --remote-path <path>';
    } else if (!remotePath) {
        nextAction = `forja sync --server ${server.name} --remote-path <path>`;
    } else {
        nextAction = 'forja build';
    }

    return {
        ok: true,
        action: 'sync',
        syncAction: 'status',
        workspace,
        enabled: sync.enabled,
        serverDetail: server ? { name: server.name, host: server.host, username: server.username, port: server.port } : undefined,
        remotePath: remotePath || undefined,
        ignore: sync.ignore,
        nextAction,
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
