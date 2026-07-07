/**
 * `forja sync` — sync changed files to remote.
 */
import { planSyncCli, executeSyncCli, resetSyncCli, ClassifiedChanges } from '../../sync/cli';
import { readProjectSyncConfig, writeProjectSyncConfig, getServerById } from '../../core/serverStore';
import { Diagnostic, SyncPlan, ForjaJsonResult, diag, Locale, T } from './types';

// ── Types ──

export type SyncAction = 'run' | 'plan' | 'reset' | 'status' | 'ignore';

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
    // ignore sub-command
    ignoreAction?: 'list' | 'add' | 'rm';
    ignorePattern?: string;
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
        case 'ignore': {
            if (result.ignoreAction === 'list') {
                lines.push(T('syncIgnore'));
                if (result.ignore?.length) {
                    for (const p of result.ignore) { lines.push(`  ${p}`); }
                } else {
                    lines.push(`  ${T('syncIgnoreEmpty')}`);
                }
            } else if (result.ignoreAction === 'add') {
                lines.push(T('syncIgnoreAdded').replace('{pattern}', result.ignorePattern || ''));
                if (result.ignore?.length) {
                    lines.push(`  ${result.ignore.join(', ')}`);
                }
            } else if (result.ignoreAction === 'rm') {
                lines.push(T('syncIgnoreRemoved').replace('{pattern}', result.ignorePattern || ''));
                if (result.ignore?.length) {
                    lines.push(`  ${result.ignore.join(', ')}`);
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

    let nextAction: string | undefined;
    if (!sync.enabled || !server) {
        nextAction = 'forja sync';
    } else if (!remotePath) {
        nextAction = 'forja sync';
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

export function runSyncIgnoreList(workspace: string): SyncResult {
    const sync = readProjectSyncConfig(workspace);
    return {
        ok: true,
        action: 'sync',
        syncAction: 'ignore',
        ignoreAction: 'list',
        workspace,
        ignore: sync.ignore,
    };
}

export function runSyncIgnoreAdd(workspace: string, pattern: string): SyncResult {
    const sync = readProjectSyncConfig(workspace);
    if (sync.ignore.includes(pattern)) {
        return {
            ok: false,
            action: 'sync',
            syncAction: 'ignore',
            ignoreAction: 'add',
            workspace,
            ignore: sync.ignore,
            ignorePattern: pattern,
            diagnostics: [diag('error', T('syncIgnoreAlreadyExists').replace('{pattern}', pattern))],
        };
    }
    const updated = [...sync.ignore, pattern];
    try {
        writeProjectSyncConfig(workspace, { ignore: updated });
    } catch (e) {
        return {
            ok: false,
            action: 'sync',
            syncAction: 'ignore',
            ignoreAction: 'add',
            workspace,
            ignore: sync.ignore,
            ignorePattern: pattern,
            diagnostics: [diag('error', `${T('error')}: ${e instanceof Error ? e.message : String(e)}`)],
        };
    }
    return {
        ok: true,
        action: 'sync',
        syncAction: 'ignore',
        ignoreAction: 'add',
        workspace,
        ignore: updated,
        ignorePattern: pattern,
    };
}

export function runSyncIgnoreRm(workspace: string, pattern: string): SyncResult {
    const sync = readProjectSyncConfig(workspace);
    const idx = sync.ignore.indexOf(pattern);
    if (idx === -1) {
        return {
            ok: false,
            action: 'sync',
            syncAction: 'ignore',
            ignoreAction: 'rm',
            workspace,
            ignore: sync.ignore,
            ignorePattern: pattern,
            diagnostics: [diag('error', T('syncIgnoreNotFound').replace('{pattern}', pattern))],
        };
    }
    const updated = sync.ignore.filter((_, i) => i !== idx);
    try {
        writeProjectSyncConfig(workspace, { ignore: updated });
    } catch (e) {
        return {
            ok: false,
            action: 'sync',
            syncAction: 'ignore',
            ignoreAction: 'rm',
            workspace,
            ignore: sync.ignore,
            ignorePattern: pattern,
            diagnostics: [diag('error', `${T('error')}: ${e instanceof Error ? e.message : String(e)}`)],
        };
    }
    return {
        ok: true,
        action: 'sync',
        syncAction: 'ignore',
        ignoreAction: 'rm',
        workspace,
        ignore: updated,
        ignorePattern: pattern,
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
