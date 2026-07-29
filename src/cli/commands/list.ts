/**
 * `forja list` — read-only enumeration of targets, env.
 */
import { ForjaJsonResult, TargetCandidate, ServerSummary, ServerDetail, EnvSummary, Diagnostic, Locale, T } from './types';
import { collectTargetCandidates } from './candidates';
import { listServers, getServerDetail } from './server';
import { loadQtSettings, loadSdkSettings, loadSyncSettings, loadRemoteSettings } from '../../core/settingsIO';
import { detectMake } from '../../sdk/cli/envDetector';
import { detectEnv } from '../../qt/env/envDetector';
import { setSilent } from '../../core/loggerBase';

function quotePath(p: string): string {
    return p.includes(' ') ? `"${p}"` : p;
}

export type ListCategory = 'targets' | 'env';
/** @internal 'servers' is accessed via `forja server`, not `forja list servers` */
export type InternalListCategory = ListCategory | 'servers';
export type EnvSubCategory = 'qt' | 'vs' | 'jom' | 'make';

export interface ListResult extends ForjaJsonResult {
    action: 'list';
    category: InternalListCategory;
    targets?: TargetCandidate[];
    servers?: ServerSummary[] | ServerDetail;
    env?: EnvSummary;
    envSubCategory?: EnvSubCategory;
}

export function formatListText(result: ListResult, locale: Locale): string {
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

    switch (result.category) {
        case 'targets': {
            lines.push(T('targets'));
            if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }
            const targets = result.targets || [];
            if (targets.length === 0) {
                lines.push(`  ${T('noneFound')}`);
            } else {
                for (const t of targets) {
                    const marker = t.current ? '* ' : '  ';
                    const cfg = t.configured ? `${T('configuredMark')} ` : '';
                    lines.push(`  ${marker}${cfg}${t.label} — ${t.project}`);
                }
            }
            if (result.diagnostics?.length) {
                lines.push('');
                for (const d of result.diagnostics) {
                    lines.push(`  ${T(d.level)}: ${d.message}`);
                }
            }
            break;
        }
        case 'servers': {
            lines.push(T('servers'));
            const servers = result.servers;
            if (Array.isArray(servers)) {
                if (servers.length === 0) {
                    lines.push(`  ${T('none')}`);
                } else {
                    for (const s of servers) {
                        const sel = s.selected ? ' *' : '';
                        lines.push(`  ${s.id}  ${s.name}  ${s.username}@${s.host}:${s.port}  auth=${s.authMode}${sel}`);
                    }
                }
            } else if (servers) {
                const s = servers as ServerDetail;
                lines.push(`  ${T('serverIdLabel')}${s.id}`);
                lines.push(`  ${T('serverNameLabel')}${s.name}`);
                lines.push(`  ${T('serverHostLabel')}${s.host}`);
                lines.push(`  ${T('serverPortLabel')}${s.port}`);
                lines.push(`  ${T('serverUsernameLabel')}${s.username}`);
                lines.push(`  ${T('serverAuthLabel')}${s.authMode}`);
                if (s.privateKeyPath) { lines.push(`  ${T('key')}${s.privateKeyPath}`); }
                if (s.strictHostKeyChecking !== undefined) { lines.push(`  ${T('strictHostKey')}${s.strictHostKeyChecking}`); }
            }
            break;
        }
        case 'env': {
            if (result.envSubCategory) {
                const label = result.envSubCategory.toUpperCase();
                lines.push(`${T('environment')} — ${label}`);
                const env = result.env || {};
                if (result.envSubCategory === 'jom') {
                    if (env.jom) {
                        lines.push(`  ${T('jomLabel')}${quotePath(env.jom)}`);
                    } else {
                        lines.push(`  ${T('nothingDetected')}`);
                    }
                } else if (result.envSubCategory === 'make') {
                    if (env.make) {
                        lines.push(`  ${T('makeLabel')}${T('available')}`);
                    } else {
                        lines.push(`  ${T('nothingDetected')}`);
                    }
                } else {
                    const items = (result.envSubCategory === 'qt' ? env.qt : env.vs) || [];
                    if (items.length === 0) {
                        lines.push(`  ${T('noneFound')}`);
                    } else {
                        for (const item of items) {
                            const star = item.configured ? '* ' : '  ';
                            const ver = item.version ? `(${item.version})` : '';
                            const ed = 'edition' in item && item.edition ? `[${item.edition}]` : '';
                            const tag = [ver, ed].filter(Boolean).join(' ');
                            lines.push(`  ${star}${tag ? tag + '  ' : ''}${quotePath(item.path)}`);
                        }
                    }
                    // Show jom/make alongside Qt/VS
                    if (result.envSubCategory === 'qt') {
                        if (process.platform === 'win32') {
                            lines.push(`  ${T('jomLabel')}${env.jom ? quotePath(env.jom) : T('nothingDetected')}`);
                        } else {
                            lines.push(`  ${T('makeLabel')}${env.make ? T('available') : T('nothingDetected')}`);
                        }
                    }
                }
            } else {
                lines.push(T('environment'));
                const env = result.env || {};

                // Qt
                lines.push(`  ${T('qtLabel')}`);
                {
                    const items = env.qt || [];
                    if (items.length === 0) {
                        lines.push(`    ${T('noneFound')}`);
                    } else {
                        for (const q of items) {
                            const star = q.configured ? '* ' : '  ';
                            const ver = q.version ? `(${q.version})` : '';
                            lines.push(`    ${star}${ver ? ver + '  ' : ''}${quotePath(q.path)}`);
                        }
                    }
                }

                // VS
                lines.push(`  ${T('vsLabel')}`);
                {
                    const items = env.vs || [];
                    if (items.length === 0) {
                        lines.push(`    ${T('noneFound')}`);
                    } else {
                        for (const v of items) {
                            const star = v.configured ? '* ' : '  ';
                            const ed = v.edition ? `[${v.edition}]` : '';
                            const ver = v.version ? `(${v.version})` : '';
                            const tag = [ver, ed].filter(Boolean).join(' ');
                            lines.push(`    ${star}${tag ? tag + '  ' : ''}${quotePath(v.path)}`);
                        }
                    }
                }

                // jom / make
                if (env.jom) {
                    lines.push(`  ${T('jomLabel')}${quotePath(env.jom)}`);
                } else {
                    lines.push(`  ${T('jomLabel')}${T('nothingDetected')}`);
                }
                if (env.make) {
                    lines.push(`  ${T('makeLabel')}${T('available')}`);
                } else if (process.platform !== 'win32') {
                    lines.push(`  ${T('makeLabel')}${T('nothingDetected')}`);
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

export async function runList(workspace: string, category: InternalListCategory, options: { detailId?: string; envSubCategory?: EnvSubCategory } = {}): Promise<ListResult> {
    switch (category) {
        case 'targets':
        case undefined as unknown as ListCategory:
            return listTargets(workspace);
        case 'servers':
            return listServersCmd(workspace, options.detailId);
        case 'env':
            if (!options.envSubCategory) {
                return listEnvAll(workspace);
            }
            return listEnvSub(workspace, options.envSubCategory);
    }
    /* istanbul ignore next */
    throw new Error(`Unknown list category: ${category}`);
}

function listTargets(workspace: string): ListResult {
    const rawTargets = collectTargetCandidates(workspace);
    const diagnostics: Diagnostic[] = [];

    const qt = loadQtSettings(workspace);
    const sdk = loadSdkSettings(workspace);
    const hasQtTargets = rawTargets.some(t => t.kind === 'qt');
    if (!qt.qtPath && hasQtTargets) {
        diagnostics.push({ level: 'warning', message: T('lst.qtPathNotConfigured') });
    }
    if (process.platform === 'win32' && !qt.vsInstall && !sdk.vsInstall) {
        diagnostics.push({ level: 'warning', message: T('lst.vsInstallNotConfigured') });
    }

    // Strip internal 'kind' field from output
    const targets = rawTargets.map(({ kind: _kind, ...rest }) => rest as TargetCandidate);

    const nextAction = 'forja use target --project <name|path>';

    return {
        ok: true,
        action: 'list',
        category: 'targets',
        workspace,
        targets,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        nextAction,
    };
}

function listServersCmd(workspace: string, detailId?: string): ListResult {
    if (detailId) {
        const detail = getServerDetail(detailId);
        if (!detail) {
            return {
                ok: false,
                action: 'list',
                category: 'servers',
                diagnostics: [{ level: 'error', message: `${T('lst.serverNotFound')}: ${detailId}` }],
                nextAction: 'forja server',
            };
        }
        return {
            ok: true,
            action: 'list',
            category: 'servers',
            servers: detail,
        };
    }
    const sync = loadSyncSettings(workspace);
    const remote = loadRemoteSettings(workspace);
    const selectedId = remote.selectedServer || sync.selectedServer || undefined;
    const servers = listServers(selectedId);
    let nextAction: string | undefined = undefined;
    if (servers.length === 0) {
        nextAction = 'forja server add --name <name> --host <host> --username <name>';
    } else if (servers.length === 1) {
        nextAction = `forja remote --server ${servers[0].name}`;
    } else if (servers.length <= 5) {
        const names = servers.map(s => s.name).join('|');
        nextAction = `forja remote --server <${names}>`;
    } else {
        nextAction = 'forja remote --server <name>';
    }
    return {
        ok: true,
        action: 'list',
        category: 'servers',
        servers,
        nextAction,
    };
}

async function listEnvAll(workspace: string): Promise<ListResult> {
    setSilent(true);
    const qtConfig = loadQtSettings(workspace);
    const sdkConfig = loadSdkSettings(workspace);
    const env = await detectEnv();

    const summary: EnvSummary = {};
    const configuredQtPath = qtConfig.qtPath || '';
    summary.qt = env.qtCandidates.map(c => ({
        path: c.path, version: c.version,
        ...(c.path === configuredQtPath ? { configured: true } : {}),
    }));
    const configuredVsPath = qtConfig.vsInstall || sdkConfig.vsInstall || '';
    if (process.platform === 'win32') {
        if (env.jom) { summary.jom = env.jom; }
        summary.vs = env.vsCandidates.map(v => ({
            path: v.installPath, version: v.version, edition: v.edition,
            ...(v.installPath === configuredVsPath ? { configured: true } : {}),
        }));
    } else {
        if (detectMake()) { summary.make = true; }
    }

    return {
        ok: true,
        action: 'list',
        category: 'env',
        env: summary,
    };
}

async function listEnvSub(workspace: string, sub: EnvSubCategory): Promise<ListResult> {
    switch (sub) {
        case 'qt': return listEnvQt(workspace);
        case 'vs': return listEnvVs(workspace);
        case 'jom': return listEnvJom();
        case 'make': return listEnvMake();
    }
}

async function listEnvQt(workspace: string): Promise<ListResult> {
    setSilent(true);
    const qtConfig = loadQtSettings(workspace);
    const configuredPath = qtConfig.qtPath || '';
    const env = await detectEnv();
    const qt = env.qtCandidates.map(c => ({
        path: c.path, version: c.version,
        ...(c.path === configuredPath ? { configured: true } : {}),
    }));
    const summary: EnvSummary = { qt };
    if (process.platform === 'win32' && env.jom) { summary.jom = env.jom; }
    if (process.platform !== 'win32' && detectMake()) { summary.make = true; }

    return {
        ok: true,
        action: 'list',
        category: 'env',
        envSubCategory: 'qt',
        env: summary,
    };
}

async function listEnvVs(_workspace: string): Promise<ListResult> {
    const qtConfig = loadQtSettings(_workspace);
    const sdkConfig = loadSdkSettings(_workspace);
    const configuredPath = qtConfig.vsInstall || sdkConfig.vsInstall || '';

    setSilent(true);
    const env = await detectEnv();
    const vs = env.vsCandidates.map(v => ({
        path: v.installPath, version: v.version, edition: v.edition,
        ...(v.installPath === configuredPath ? { configured: true } : {}),
    }));

    return {
        ok: true,
        action: 'list',
        category: 'env',
        envSubCategory: 'vs',
        env: { vs },
    };
}

async function listEnvJom(): Promise<ListResult> {
    setSilent(true);
    const summary: EnvSummary = {};
    if (process.platform === 'win32') {
        const env = await detectEnv();
        if (env.jom) { summary.jom = env.jom; }
    }
    return {
        ok: true,
        action: 'list',
        category: 'env',
        envSubCategory: 'jom',
        env: summary,
    };
}

async function listEnvMake(): Promise<ListResult> {
    const summary: EnvSummary = {};
    if (process.platform !== 'win32') {
        const makePath = detectMake();
        if (makePath) { summary.make = true; }
    }
    return {
        ok: true,
        action: 'list',
        category: 'env',
        envSubCategory: 'make',
        env: summary,
    };
}
