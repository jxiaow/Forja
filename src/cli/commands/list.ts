/**
 * `forja list` — read-only enumeration of targets, env, remote, lang.
 */
import { ForjaJsonResult, TargetCandidate, ServerSummary, ServerDetail, EnvSummary, Diagnostic, Locale, T, resolveLocale } from './types';
import { collectTargetCandidates } from './candidates';
import { listServers, getServerDetail } from './server';
import { loadQtSettings, loadSdkSettings, loadSyncSettings, loadRemoteSettings, loadGlobalConfig } from '../../core/settingsIO';
import { detectMake } from '../../sdk/cli/envDetector';
import { detectEnv } from '../../qt/env/envDetector';
import { setSilent } from '../../core/loggerBase';

export type ListCategory = 'targets' | 'env' | 'remote' | 'lang';
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
    envAvailable?: Array<{ path: string; version?: string; edition?: string }>;
    remote?: RemoteConfigDetail;
    lang?: string;
}

export interface RemoteConfigDetail {
    workspaceMode: 'legacy' | 'staged';
    remoteWorkspace?: string;
    remoteForjaBin?: string;
    buildOrder?: { target: string; action: string; args: string[] }[];
    transfer?: { configured: boolean; deployServer?: string; deployPath?: string; artifacts?: string[] };
    repos?: import('../../core/settingsIO').RemoteRepoSettings[];
}

function listLang(): ListResult {
    const globalCfg = loadGlobalConfig();
    const lang = globalCfg.lang || resolveLocale() || 'en';
    return {
        ok: true,
        action: 'list',
        category: 'lang',
        lang,
        nextAction: lang === 'zh' ? 'forja use lang en' : 'forja use lang zh',
    };
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
                    const marker = t.current ? ' *' : '';
                    const cfg = t.configured ? ` ${T('configuredMark')}` : '';
                    lines.push(`  ${t.kind}  ${t.label}${marker}${cfg}`);
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
                        lines.push(`  ${T('jomLabel')}${env.jom}`);
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
                    const configured = result.envSubCategory === 'qt' ? env.qt : env.vs;
                    if (configured && configured.length > 0) {
                        lines.push(`  ${T('configured')}:`);
                        for (const c of configured) {
                            const ver = c.version ? ` (${c.version})` : '';
                            lines.push(`    ${c.path}${ver}`);
                        }
                    } else {
                        lines.push(`  ${T('notConfigured')}`);
                    }
                    const available = result.envAvailable || [];
                    if (available.length > 0) {
                        lines.push(`  ${T('available')}:`);
                        for (const a of available) {
                            const ver = a.version ? ` (${a.version})` : '';
                            const ed = a.edition ? ` [${a.edition}]` : '';
                            lines.push(`    ${a.path}${ver}${ed}`);
                        }
                    } else {
                        lines.push(`  ${T('noneFound')}`);
                    }
                }
            } else {
                lines.push(T('environment'));
                const env = result.env || {};

                // Qt
                lines.push(`  ${T('qtLabel')}`);
                if (env.qt && env.qt.length > 0) {
                    lines.push(`    ${T('configured')}:`);
                    for (const q of env.qt) { lines.push(`      ${q.path}${q.version ? ` (${q.version})` : ''}`); }
                } else {
                    lines.push(`    ${T('notConfigured')}`);
                }
                const qtAvail = env.qtAvailable || [];
                if (qtAvail.length > 0) {
                    lines.push(`    ${T('available')}:`);
                    for (const q of qtAvail) { lines.push(`      ${q.path}${q.version ? ` (${q.version})` : ''}`); }
                } else {
                    lines.push(`    ${T('noneFound')}`);
                }

                // VS
                lines.push(`  ${T('vsLabel')}`);
                if (env.vs && env.vs.length > 0) {
                    lines.push(`    ${T('configured')}:`);
                    for (const v of env.vs) { lines.push(`      ${v.path}${v.version ? ` (${v.version})` : ''}`); }
                } else {
                    lines.push(`    ${T('notConfigured')}`);
                }
                const vsAvail = env.vsAvailable || [];
                if (vsAvail.length > 0) {
                    lines.push(`    ${T('available')}:`);
                    for (const v of vsAvail) {
                        const ed = v.edition ? ` [${v.edition}]` : '';
                        lines.push(`      ${v.path}${v.version ? ` (${v.version})` : ''}${ed}`);
                    }
                } else {
                    lines.push(`    ${T('noneFound')}`);
                }

                // jom / make
                if (env.jom) {
                    lines.push(`  ${T('jomLabel')}${env.jom}`);
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
        case 'remote': {
            lines.push(T('remoteConfiguration'));
            if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }
            const rem = result.remote;
            if (rem) {
                const hasRealConfig = rem.remoteWorkspace || rem.remoteForjaBin
                    || (rem.buildOrder && rem.buildOrder.length > 0)
                    || rem.transfer?.configured
                    || (rem.repos && rem.repos.length > 0);
                if (hasRealConfig) {
                    lines.push(`  ${T('workspaceMode')}${rem.workspaceMode}`);
                }
                if (rem.remoteWorkspace) { lines.push(`  ${T('remoteWorkspace')}${rem.remoteWorkspace}`); }
                if (rem.remoteForjaBin) { lines.push(`  ${T('forjaBin')}${rem.remoteForjaBin}`); }
                if (rem.buildOrder && rem.buildOrder.length > 0) {
                    lines.push(`  ${T('buildOrder')}`);
                    for (const b of rem.buildOrder) {
                        const args = b.args?.length ? ` ${b.args.join(' ')}` : '';
                        lines.push(`    ${b.target}:${b.action}${args}`);
                    }
                }
                if (rem.transfer) {
                    lines.push(`  ${T('transfer')}${rem.transfer.configured ? T('configured') : T('notConfigured')}`);
                    if (rem.transfer.configured) {
                        if (rem.transfer.deployServer) { lines.push(`    ${T('server')}${rem.transfer.deployServer}`); }
                        if (rem.transfer.deployPath) { lines.push(`    ${T('path')}${rem.transfer.deployPath}`); }
                        if (rem.transfer.artifacts?.length) { lines.push(`    ${T('artifacts')}${rem.transfer.artifacts.join(', ')}`); }
                    }
                }
                if (rem.repos && rem.repos.length > 0) {
                    lines.push(`  ${T('repos')}`);
                    for (const r of rem.repos) { lines.push(`    ${r.localName} → ${r.remoteName}  ${T('roleLabel')}${r.role}`); }
                }
            }
            break;
        }
        case 'lang': {
            lines.push(`${T('language')} ${result.lang || 'en'}`);
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
        case 'remote':
            return listRemote(workspace);
        case 'lang':
            return listLang();
    }
    /* istanbul ignore next */
    throw new Error(`Unknown list category: ${category}`);
}

function listTargets(workspace: string): ListResult {
    const targets = collectTargetCandidates(workspace);
    const diagnostics: Diagnostic[] = [];

    const qt = loadQtSettings(workspace);
    const sdk = loadSdkSettings(workspace);
    if (!qt.qtPath) {
        diagnostics.push({ level: 'warning', message: T('lst.qtPathNotConfigured') });
    }
    if (process.platform === 'win32' && !qt.vsInstall && !sdk.vsInstall) {
        diagnostics.push({ level: 'warning', message: T('lst.vsInstallNotConfigured') });
    }

    const hasCurrent = targets.some(t => t.current);
    let nextAction: string;
    if (targets.length === 0) {
        nextAction = 'forja setup';
    } else if (hasCurrent) {
        nextAction = 'forja status';
    } else {
        nextAction = 'forja use target --project <path>';
    }

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
        nextAction = `forja use remote --server ${servers[0].name}`;
    } else if (servers.length <= 5) {
        const names = servers.map(s => s.name).join('|');
        nextAction = `forja use remote --server <${names}>`;
    } else {
        nextAction = 'forja use remote --server <name>';
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
    if (qtConfig.qtPath) {
        summary.qt = [{ path: qtConfig.qtPath, version: (qtConfig.qtPath.match(/(\d+\.\d+\.\d+)/) || [])[1] }];
    }
    const vsPath = qtConfig.vsInstall || sdkConfig.vsInstall;
    if (vsPath) {
        summary.vs = [{ path: vsPath }];
    }
    if (process.platform === 'win32') {
        if (env.jom) { summary.jom = env.jom; }
        summary.vsAvailable = env.vsCandidates.map(v => ({ path: v.installPath, version: v.version, edition: v.edition }));
    } else {
        if (env.jom) { summary.make = true; }
    }
    summary.qtAvailable = env.qtCandidates.map(c => ({ path: c.path, version: c.version }));

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
    const configured = qtConfig.qtPath
        ? { path: qtConfig.qtPath, version: (qtConfig.qtPath.match(/(\d+\.\d+\.\d+)/) || [])[1] }
        : undefined;
    const env = await detectEnv();
    const available = env.qtCandidates.map(c => ({ path: c.path, version: c.version }));

    return {
        ok: true,
        action: 'list',
        category: 'env',
        envSubCategory: 'qt',
        env: { qt: configured ? [configured] : undefined },
        envAvailable: available,
    };
}

async function listEnvVs(_workspace: string): Promise<ListResult> {
    const qtConfig = loadQtSettings(_workspace);
    const sdkConfig = loadSdkSettings(_workspace);
    const configuredPath = qtConfig.vsInstall || sdkConfig.vsInstall;
    const configured = configuredPath ? { path: configuredPath } : undefined;

    setSilent(true);
    const env = await detectEnv();
    const available = env.vsCandidates.map(v => ({
        path: v.installPath,
        version: v.version,
        edition: v.edition,
    }));

    return {
        ok: true,
        action: 'list',
        category: 'env',
        envSubCategory: 'vs',
        env: { vs: configured ? [configured] : undefined },
        envAvailable: available,
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

function listRemote(workspace: string): ListResult {
    const remote = loadRemoteSettings(workspace);
    const detail: RemoteConfigDetail = {
        workspaceMode: remote.workspaceMode,
        remoteWorkspace: remote.remoteWorkspace || undefined,
        remoteForjaBin: remote.remoteForjaBin || undefined,
        buildOrder: remote.buildOrder.length > 0 ? remote.buildOrder : undefined,
        transfer: remote.transfer ? {
            configured: true,
            deployServer: remote.transfer.deployServer,
            deployPath: remote.transfer.deployPath,
            artifacts: remote.transfer.artifacts,
        } : { configured: false },
        repos: remote.repos.length > 0 ? remote.repos : undefined,
    };

    return {
        ok: true,
        action: 'list',
        category: 'remote',
        workspace,
        remote: detail,
    };
}
