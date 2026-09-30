/**
 * `forja sync` — sync changed files to remote.
 */
import * as path from 'path';
import { planSyncCli, executeSyncCli, resetSyncCli, ClassifiedChanges, configureSyncSettings } from '../../sync/cli';
import { readProjectSyncConfig, writeProjectSyncConfig, getServerById, readServers, addServer, ServerConfig } from '../../core/serverStore';
import { loadRemoteSettings } from '../../core/settingsIO';
import { Diagnostic, SyncPlan, ForjaJsonResult, diag, Locale, T } from './types';
import { prompt, choose, confirm } from './prompt';
import { outputResult } from './output';
import { extractAllFlags, extractFlag, findUnknownFlags, hasEmptyFlagValue, hasFlag, unknownFlagsMessage } from './args';
import { resolveGitRoots } from '../../core/gitRepoResolver';

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
    skippedDetails?: Array<{ file: string; reason: string }>;
    failed?: Array<{ file: string; error: string }>;
    // status fields
    enabled?: boolean;
    serverDetail?: { name: string; host: string; username: string; port: number };
    ignore?: string[];
    // ignore sub-command
    ignoreAction?: 'list' | 'add' | 'rm';
    ignorePattern?: string;
}

// ── Formatter ──

export function formatSyncText(result: SyncResult, _locale: Locale): string {
    const lines: string[] = [];

    if (!result.ok) {
        lines.push(T('error'));
        if (result.failed?.length) {
            for (const f of result.failed) {
                lines.push(`  ${f.file ? f.file + ': ' : ''}${f.error}`);
            }
        } else if (result.diagnostics) {
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
            if (result.server) { lines.push(`  ${T('serverLabel')}: ${result.server}`); }
            if (result.remotePath) { lines.push(`  ${T('remotePathLabel')}: ${result.remotePath}`); }
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
            if (result.server) { lines.push(`  ${T('serverLabel')}: ${result.server}`); }
            if (result.remotePath) { lines.push(`  ${T('remotePathLabel')}: ${result.remotePath}`); }
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
                lines.push(`  ${T('serverLabel')}: ${s.name} (${s.username}@${s.host}:${s.port})`);
            }
            if (result.remotePath) {
                lines.push(`  ${T('remotePathLabel')}: ${result.remotePath}`);
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
                lines.push(T('syncIgnoreAdded', [result.ignorePattern || '']));
                if (result.ignore?.length) {
                    lines.push(`  ${result.ignore.join(', ')}`);
                }
            } else if (result.ignoreAction === 'rm') {
                lines.push(T('syncIgnoreRemoved', [result.ignorePattern || '']));
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
                skippedDetails: plan.skippedDetails?.length ? plan.skippedDetails : undefined,
            },
            server: plan.server,
            remotePath: plan.remotePath,
            diagnostics: plan.ok ? undefined : plan.failed.map(f => diag('error', `${T('sync.planFailed')}: ${f.error}`)),
            nextAction: plan.ok ? 'forja sync' : (plan.nextAction || 'forja sync'),
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
            skippedDetails: result.skippedDetails?.length ? result.skippedDetails : undefined,
            failed: result.failed?.length ? result.failed : undefined,
            diagnostics: result.ok ? undefined : (result.failed?.length ? result.failed.map(f => diag('error', `${T('sync.syncFailed')}: ${f.error}`)) : [diag('error', T('sync.syncFailed'))]),
            nextAction: result.ok ? 'forja status' : (result.nextAction || 'forja sync'),
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
    const remote = loadRemoteSettings(workspace);
    const server = remote.selectedServer ? getServerById(remote.selectedServer) : null;
    const remotePath = server ? (remote.remotePaths[server.id] || '') : '';

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
    // Reject whitespace-only patterns
    if (!pattern || !pattern.trim()) {
        return {
            ok: false,
            action: 'sync',
            syncAction: 'ignore',
            ignoreAction: 'add',
            workspace,
            ignore: readProjectSyncConfig(workspace).ignore,
            ignorePattern: pattern,
            diagnostics: [diag('error', 'Ignore pattern cannot be empty or whitespace-only')],
        };
    }
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
            diagnostics: [diag('error', T('syncIgnoreAlreadyExists', [pattern]))],
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
            diagnostics: [diag('error', T('syncIgnoreNotFound', [pattern]))],
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
        nextAction: 'forja sync',
    };
}

// ── Interactive setup ──

/**
 * Interactive sync setup — guides user to select/create server and input remote path.
 * Returns true if configuration was completed successfully.
 */
export async function interactiveRemoteSetup(workroot: string): Promise<{ ok: true } | { ok: false; reason: 'cancelled' | 'configError'; error?: string }> {
    const existingServers = readServers();
    let serverId: string | undefined;
    let selectedServer: ServerConfig | undefined;

    if (existingServers.length === 0) {
        // No servers — guide creation
        console.log(T('sync.notConfigured'));
        const host = await prompt(T('setupPromptHost'));
        if (!host) return { ok: false, reason: 'cancelled' };
        const username = await prompt(T('setupPromptUsername'));
        if (!username) return { ok: false, reason: 'cancelled' };
        const portStr = await prompt(T('setupPromptPort'), '22');
        const port = parseInt(portStr || '22', 10);
        if (isNaN(port) || port < 1 || port > 65535) return { ok: false, reason: 'cancelled' };
        const authChoice = await choose(T('setupPromptAuthMode'), ['key', 'password'] as const, m => m === 'key' ? T('setupAuthKey') : T('setupAuthPassword'));
        const authMode = authChoice || 'key';
        let privateKeyPath = '';
        let password = '';
        if (authMode === 'key') {
            privateKeyPath = await prompt(T('setupPromptPrivateKey'), '') || '';
        } else {
            password = await prompt(T('setupPromptPassword')) || '';
        }
        const name = await prompt(T('setupPromptName'), host) || host;
        try {
            const created = addServer({ name, host, username, port, authMode, privateKeyPath, password });
            serverId = created.id;
            selectedServer = created;
            console.log(`${T('setupServerCreated')}: ${created.name} (${created.host})`);
        } catch {
            return { ok: false, reason: 'cancelled' };
        }
    } else if (existingServers.length === 1) {
        // Single server — auto-select
        serverId = existingServers[0].id;
        selectedServer = existingServers[0];
    } else {
        // Multiple servers — interactive selection
        const server = await choose(T('setupSelectServer'), existingServers, s => `${s.name} (${s.username}@${s.host})`);
        if (!server) return { ok: false, reason: 'cancelled' };
        serverId = server.id;
        selectedServer = server;
    }

    // Remote path: reuse a server-specific history entry or prompt for a new one.
    const remoteCfg = loadRemoteSettings(workroot);
    let remotePath = remoteCfg.remotePaths[serverId || ''] || '';
    if (!remotePath) {
        const history = selectedServer?.remotePathHistory || [];
        if (history.length > 0) {
            const choice = await choose(T('setupRemotePathPrompt'), [...history, ''], item => item || 'Enter a new path');
            if (choice !== null) { remotePath = choice; }
        }
        if (!remotePath) {
            const defaultPath = `/home/${selectedServer?.username || 'user'}/${path.basename(workroot)}`;
            remotePath = await prompt(T('setupRemotePathPrompt'), defaultPath);
        }
        if (!remotePath) return { ok: false, reason: 'cancelled' };
    }

    const cfg = configureSyncSettings(workroot, { serverId: serverId!, remotePath, enable: true });
    if (!cfg.ok) {
        return { ok: false, reason: 'configError', error: cfg.error || T('syncConfigFailed') };
    }

    console.log();
    return { ok: true };
}

// ── Sync ──

export async function handleSync(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const syncUnknown = findUnknownFlags(argv, new Set(['--yes', '--file', '--force', '--dry-run', '--add', '--rm']), new Set(['--file', '--add', '--rm']));
    if (syncUnknown.length > 0) {
        outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `${T('sync.unknownFlag')}: ${syncUnknown.join(', ')}` }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    if (hasEmptyFlagValue(argv, '--file')) {
        outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: '--file requires a non-empty value' }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const fmt = (r: SyncResult) => formatSyncText(r, locale);
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    const files = extractAllFlags(argv, '--file');

    // ── 子命令校验 ──
    if (subArg !== '' && subArg !== 'status' && subArg !== 'reset' && subArg !== 'ignore') {
        outputResult({
            ok: false,
            action: 'sync',
            syncAction: 'run',
            workroot,
            diagnostics: [{
                level: 'error',
                message: `${T('sync.unknownAction')}: ${subArg}`,
            }],
            nextAction: 'forja sync',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // X2: --file is only valid for default sync (execute/plan), not for subcommands
    if (files.length > 0 && subArg !== '') {
        outputResult({ ok: false, action: 'sync', syncAction: 'run', diagnostics: [{ level: 'error', message: T('sync.fileOnlyForExecute') }], nextAction: 'forja sync --file <path>' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // X3: --add/--rm are only valid for the ignore subcommand
    if (subArg !== 'ignore' && (hasFlag(argv, '--add') || hasFlag(argv, '--rm'))) {
        outputResult({ ok: false, action: 'sync', syncAction: 'ignore', diagnostics: [{ level: 'error', message: T('sync.ignoreFlagsOnlyWithIgnore') }], nextAction: 'forja sync ignore --add <pattern>' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // X1: --dry-run and --yes are mutually exclusive
    if (hasFlag(argv, '--dry-run') && hasFlag(argv, '--yes')) {
        outputResult({ ok: false, action: 'sync', syncAction: 'run', diagnostics: [{ level: 'error', message: T('sync.dryRunYesConflict') }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // reset subcommand: clear sync state (destructive — requires confirmation)
    if (subArg === 'reset') {
        if (hasFlag(argv, '--dry-run')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'reset', workroot, diagnostics: [{ level: 'error', message: T('sync.dryRunIncompatible') }], nextAction: 'forja sync reset' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const forceFlag = hasFlag(argv, '--force');
        if (!wantsJson && !forceFlag) {
            const yes = await confirm(T('syncResetConfirm'), false);
            if (!yes) {
                outputResult({ ok: false, action: 'sync', syncAction: 'reset', diagnostics: [{ level: 'info', message: T('cancelled') }] }, wantsJson);
                return;
            }
        } else if (wantsJson && !forceFlag) {
            outputResult({ ok: false, action: 'sync', syncAction: 'reset', diagnostics: [{ level: 'error', message: T('destructiveRequiresForce') }], nextAction: 'forja sync reset --force' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = runSyncReset(workroot);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // status: 显示配置，不需要 sync 前置配置
    if (subArg === 'status') {
        if (hasFlag(argv, '--dry-run')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'status', diagnostics: [{ level: 'error', message: T('sync.dryRunIncompatible') }], nextAction: 'forja sync status' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = runSyncStatus(workroot);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // ignore: 管理忽略规则，不需要 sync 前置配置
    if (subArg === 'ignore') {
        if (hasFlag(argv, '--dry-run')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'ignore', diagnostics: [{ level: 'error', message: T('sync.dryRunIncompatible') }], nextAction: 'forja sync ignore' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        if (hasFlag(argv, '--add') && hasFlag(argv, '--rm')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'ignore', workroot, diagnostics: [diag('error', T('syncIgnoreAddRmConflict'))] }, wantsJson, fmt);
            process.exitCode = 1;
            return;
        }
        if (hasFlag(argv, '--add') || hasFlag(argv, '--rm')) {
            const hasAdd = hasFlag(argv, '--add');
            const hasRm = hasFlag(argv, '--rm');
            const addPattern = hasAdd ? extractFlag(argv, '--add') : undefined;
            const rmPattern = hasRm ? extractFlag(argv, '--rm') : undefined;
            if (hasAdd && !addPattern) {
                outputResult({ ok: false, action: 'sync', syncAction: 'ignore', ignoreAction: 'add', workroot, diagnostics: [diag('error', T('syncIgnorePatternRequired'))] }, wantsJson, fmt);
                process.exitCode = 1;
                return;
            }
            if (hasRm && !rmPattern) {
                outputResult({ ok: false, action: 'sync', syncAction: 'ignore', ignoreAction: 'rm', workroot, diagnostics: [diag('error', T('syncIgnorePatternRequired').replace('--add', '--rm'))] }, wantsJson, fmt);
                process.exitCode = 1;
                return;
            }
            if (addPattern) {
                const result = runSyncIgnoreAdd(workroot, addPattern);
                outputResult(result, wantsJson, fmt);
                if (!result.ok) process.exitCode = 1;
            } else if (rmPattern) {
                const result = runSyncIgnoreRm(workroot, rmPattern);
                outputResult(result, wantsJson, fmt);
                if (!result.ok) process.exitCode = 1;
            }
        } else {
            outputResult(runSyncIgnoreList(workroot), wantsJson, fmt);
        }
        return;
    }

    // ── 检查配置是否完整 ──
    const syncCfg = readProjectSyncConfig(workroot);
    const remoteCfg = loadRemoteSettings(workroot);
    const serverExists = remoteCfg.selectedServer ? readServers().some(s => s.id === remoteCfg.selectedServer) : false;
    const needsSetup = !syncCfg.enabled || !remoteCfg.selectedServer || !serverExists || !remoteCfg.remotePaths[remoteCfg.selectedServer];
    if (needsSetup) {
        if (wantsJson) {
            // JSON mode: return choices for AI to guide user
            outputResult({
                ok: false, action: 'sync',
                diagnostics: [{ level: 'error', message: T('sync.notConfigured') }],
                choices: [
                    { label: 'forja sync', command: 'forja sync', description: T('syncInteractiveSetup') },
                ],
            }, wantsJson);
            process.exitCode = 1;
            return;
        } else {
            outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: T('sync.notConfigured') }], nextAction: 'forja sync' }, false);
            process.exitCode = 1;
            return;
        }
    }

    if (hasFlag(argv, '--dry-run')) {
        const result = await runSyncPlan(workroot, files);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // Default: interactive plan → confirm → execute
    if (!wantsJson && !hasFlag(argv, '--yes')) {
        const plan = await runSyncPlan(workroot, files);
        if (!plan.ok) { outputResult(plan, false, fmt); process.exitCode = 1; return; }
        const pendingCount = (plan.plan?.pending?.length ?? 0) + (plan.plan?.deleted?.length ?? 0);
        if (pendingCount === 0) { console.log(T('syncNothing')); return; }
        // 交互确认中的 plan 只是中间步骤，不显示 nextAction（用户已在 forja sync 流程中）
        plan.nextAction = undefined;
        console.log(formatSyncText(plan, locale));
        console.log();
        const yes = await confirm(T('syncConfirm'), false);
        if (!yes) { console.log(T('syncCancelled')); process.exitCode = 1; return; }

        // Reuse plan data to avoid re-running git status
        const gitRoots = resolveGitRoots(workroot);
        const classified: ClassifiedChanges = {
            pending: plan.plan?.pending ?? [],
            deleted: plan.plan?.deleted ?? [],
            skipped: plan.plan?.skipped ?? [],
            skippedDetails: plan.plan?.skippedDetails ?? [],
            gitRoots: (plan.plan?.repos ?? []).map(name => gitRoots.find(g => g.name === name)).filter(Boolean) as ReturnType<typeof resolveGitRoots>,
            requestedFilesNotFound: false,
        };
        const result = await runSyncExecute(workroot, files, classified);
        outputResult(result, wantsJson, fmt);
        return;
    }
    const result = await runSyncExecute(workroot, files);
    outputResult(result, wantsJson, fmt);
}
