/**
 * `forja list` — read-only enumeration of targets, servers, env, remote, config.
 */
import { ForjaJsonResult, TargetCandidate, ServerSummary, ServerDetail, EnvSummary, ConfigSummary, Locale, T, resolveLocale } from './types';
import { collectTargetCandidates } from './candidates';
import { listServers, getServerDetail } from './server';
import { loadQtSettings, loadSdkSettings, loadSyncSettings, loadRemoteSettings, loadGlobalConfig } from '../../core/settingsIO';
import { detectMake, detectVsInstallations, VsInstallation } from '../../sdk/cli/envDetector';
import { detectEnv } from '../../qt/env/envDetector';

export type ListCategory = 'targets' | 'servers' | 'remote-repos' | 'env' | 'remote' | 'config' | 'lang';
export type EnvSubCategory = 'qt' | 'vs';

export interface ListResult extends ForjaJsonResult {
    action: 'list';
    category: ListCategory;
    targets?: TargetCandidate[];
    servers?: ServerSummary[] | ServerDetail;
    env?: EnvSummary;
    envSubCategory?: EnvSubCategory;
    envAvailable?: Array<{ path: string; version?: string; edition?: string }>;
    config?: ConfigSummary;
    remote?: RemoteConfigDetail;
    remoteRepos?: import('../../core/settingsIO').RemoteRepoSettings[];
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
        nextAction: 'forja use lang zh',
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
            } else {
                lines.push(T('environment'));
                const env = result.env || {};
                if (env.qt) {
                    for (const q of env.qt) { lines.push(`  ${T('qtLabel')}${q.path}${q.version ? ` (${q.version})` : ''}`); }
                }
                if (env.vs) {
                    for (const v of env.vs) { lines.push(`  ${T('vsLabel')}${v.path}${v.version ? ` (${v.version})` : ''}`); }
                }
                if (env.jom) { lines.push(`  ${T('jomLabel')}${env.jom}`); }
                if (env.make) { lines.push(`  ${T('makeLabel')}${T('available')}`); }
                if (!env.qt && !env.vs && !env.jom && !env.make) {
                    lines.push(`  ${T('nothingDetected')}`);
                }
            }
            break;
        }
        case 'config': {
            lines.push(T('configuration'));
            if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }
            const cfg = result.config || {};
            if (cfg.lang) {
                lines.push(`  ${T('language')}${cfg.lang}`);
            }
            if (cfg.qt) {
                if (cfg.qt.configured) {
                    lines.push(`  ${T('qtLabel')}${T('configured')}`);
                    if (cfg.qt.project) { lines.push(`    ${T('project')}${cfg.qt.project}`); }
                    if (cfg.qt.mode) { lines.push(`    ${T('mode')}${cfg.qt.mode}`); }
                    if (cfg.qt.arch) { lines.push(`    ${T('arch')}${cfg.qt.arch}`); }
                    if (cfg.qt.qtPath) { lines.push(`    ${T('qtPathLabel')}${cfg.qt.qtPath}`); }
                    if (cfg.qt.vsInstall) { lines.push(`    ${T('vsInstallLabel')}${cfg.qt.vsInstall}`); }
                } else {
                    lines.push(`  ${T('qtLabel')}${T('notConfigured')}`);
                }
            }
            if (cfg.sdk) {
                if (cfg.sdk.configured) {
                    lines.push(`  ${T('sdkLabel')}${T('configured')}`);
                    if (cfg.sdk.project) { lines.push(`    ${T('project')}${cfg.sdk.project}`); }
                    if (cfg.sdk.mode) { lines.push(`    ${T('mode')}${cfg.sdk.mode}`); }
                    if (cfg.sdk.arch) { lines.push(`    ${T('arch')}${cfg.sdk.arch}`); }
                    if (cfg.sdk.vsInstall) { lines.push(`    ${T('vsInstallLabel')}${cfg.sdk.vsInstall}`); }
                } else {
                    lines.push(`  ${T('sdkLabel')}${T('notConfigured')}`);
                }
            }
            if (cfg.sync) {
                if (cfg.sync.configured) {
                    lines.push(`  ${T('syncLabel')}${T('enabled')}${cfg.sync.enabled}  ${T('server')}${cfg.sync.selectedServer}`);
                    if (cfg.sync.remotePath) { lines.push(`    ${T('remotePath')}${cfg.sync.remotePath}`); }
                } else {
                    lines.push(`  ${T('syncLabel')}${T('notConfigured')}`);
                }
            }
            if (cfg.remote) {
                lines.push(`  ${T('remoteLabel')}`);
                if (cfg.remote.selectedServer) { lines.push(`    ${T('server')}${cfg.remote.selectedServer}`); }
                if (cfg.remote.remoteWorkspace) { lines.push(`    ${T('configWorkspace')}${cfg.remote.remoteWorkspace}`); }
                if (cfg.remote.remoteForjaBin) { lines.push(`    ${T('configForjaBin')}${cfg.remote.remoteForjaBin}`); }
                if (cfg.remote.buildOrder) { lines.push(`    ${T('configBuildOrder')}${cfg.remote.buildOrder.join(', ')}`); }
                if (cfg.remote.transferConfigured) { lines.push(`    ${T('configTransfer')}${T('configured')}`); }
            }
            break;
        }
        case 'remote': {
            lines.push(T('remoteConfiguration'));
            if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }
            const rem = result.remote;
            if (rem) {
                lines.push(`  ${T('workspaceMode')}${rem.workspaceMode}`);
                if (rem.remoteWorkspace) { lines.push(`  ${T('remoteWorkspace')}${rem.remoteWorkspace}`); }
                if (rem.remoteForjaBin) { lines.push(`  ${T('forjaBin')}${rem.remoteForjaBin}`); }
                if (rem.buildOrder && rem.buildOrder.length > 0) {
                    lines.push(`  ${T('buildOrder')}`);
                    for (const b of rem.buildOrder) { lines.push(`    ${b.target}:${b.action}`); }
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
        case 'remote-repos': {
            lines.push(T('remoteRepos'));
            if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }
            const repos = result.remoteRepos || [];
            if (repos.length === 0) {
                lines.push(`  ${T('none')}`);
            } else {
                for (const r of repos) {
                    lines.push(`  ${r.localName} → ${r.remoteName}  ${T('roleLabel')}${r.role}`);
                    if (r.remotePath) { lines.push(`    ${T('path')}${r.remotePath}`); }
                    if (r.baseline) { lines.push(`    ${T('baseline')}${r.baseline}`); }
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

export async function runList(workspace: string, category: ListCategory, options: { detailId?: string; envSubCategory?: EnvSubCategory } = {}): Promise<ListResult> {
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
        case 'config':
            return listConfig(workspace);
        case 'remote':
            return listRemote(workspace);
        case 'remote-repos':
            return listRemoteRepos(workspace);
        case 'lang':
            return listLang();
    }
    /* istanbul ignore next */
    throw new Error(`Unknown list category: ${category}`);
}

function listTargets(workspace: string): ListResult {
    const targets = collectTargetCandidates(workspace);
    const diagnostics: import('./types').Diagnostic[] = [];

    const qt = loadQtSettings(workspace);
    const sdk = loadSdkSettings(workspace);
    if (!qt.qtPath) {
        diagnostics.push({ level: 'warning', message: T('lst.qtPathNotConfigured') });
    }
    if (process.platform === 'win32' && !qt.vsInstall && !sdk.vsInstall) {
        diagnostics.push({ level: 'warning', message: T('lst.vsInstallNotConfigured') });
    }

    return {
        ok: true,
        action: 'list',
        category: 'targets',
        workspace,
        targets,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        nextAction: targets.length === 0 ? 'forja setup' : 'forja use target --project <path>',
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
                nextAction: 'forja list servers',
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
    const qtConfig = loadQtSettings(workspace);
    const sdkConfig = loadSdkSettings(workspace);
    const env = await detectEnv();

    const summary: import('./types').EnvSummary = {};
    if (qtConfig.qtPath) {
        summary.qt = [{ path: qtConfig.qtPath, version: (qtConfig.qtPath.match(/(\d+\.\d+\.\d+)/) || [])[1] }];
    }
    const vsPath = qtConfig.vsInstall || sdkConfig.vsInstall;
    if (vsPath) {
        summary.vs = [{ path: vsPath }];
    }
    if (env.jom) { summary.jom = env.jom; }
    if (process.platform !== 'win32') {
        try { require('child_process').execSync('which make', { stdio: 'ignore', timeout: 5000 }); summary.make = true; } catch { /* no make */ }
    }

    return {
        ok: true,
        action: 'list',
        category: 'env',
        env: summary,
    };
}

async function listEnvSub(workspace: string, sub: EnvSubCategory): Promise<ListResult> {
    if (sub === 'qt') { return listEnvQt(workspace); }
    return listEnvVs(workspace);
}

async function listEnvQt(workspace: string): Promise<ListResult> {
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

function listEnvVs(_workspace: string): ListResult {
    const qtConfig = loadQtSettings(_workspace);
    const sdkConfig = loadSdkSettings(_workspace);
    const configuredPath = qtConfig.vsInstall || sdkConfig.vsInstall;
    const configured = configuredPath ? { path: configuredPath } : undefined;

    let available: Array<{ path: string; version?: string; edition?: string }> = [];
    if (process.platform === 'win32') {
        const installations = detectVsInstallations();
        available = installations.map(v => ({
            path: v.vsDevCmdPath,
            version: v.version,
            edition: v.edition,
        }));
    }

    return {
        ok: true,
        action: 'list',
        category: 'env',
        envSubCategory: 'vs',
        env: { vs: configured ? [configured] : undefined },
        envAvailable: available,
    };
}

function listConfig(workspace: string): ListResult {
    const qt = loadQtSettings(workspace);
    const sdk = loadSdkSettings(workspace);
    const sync = loadSyncSettings(workspace);
    const remote = loadRemoteSettings(workspace);
    const globalCfg = loadGlobalConfig();

    const config: ConfigSummary = {};

    // Lang
    if (globalCfg.lang) {
        config.lang = globalCfg.lang;
    }

    // Qt
    if (qt.pinnedProject || qt.qtPath) {
        config.qt = {
            configured: true,
            project: qt.pinnedProject?.relative || undefined,
            mode: qt.mode || undefined,
            arch: qt.arch || undefined,
            qtPath: qt.qtPath || undefined,
            vsInstall: qt.vsInstall || undefined,
            qmakeTarget: qt.target || undefined,
        };
    } else {
        config.qt = { configured: false };
    }

    // SDK
    if (sdk.pinnedProject || sdk.vsInstall) {
        config.sdk = {
            configured: true,
            project: sdk.pinnedProject || undefined,
            mode: sdk.mode,
            arch: sdk.arch,
            vsInstall: sdk.vsInstall || undefined,
        };
    } else {
        config.sdk = { configured: false };
    }

    // Sync
    if (sync.selectedServer) {
        config.sync = {
            configured: true,
            enabled: sync.enabled,
            selectedServer: sync.selectedServer,
            remotePath: sync.remotePaths[sync.selectedServer] || undefined,
        };
    } else {
        config.sync = { configured: false };
    }

    // Remote
    if (remote.selectedServer || remote.remoteWorkspace || remote.remoteForjaBin || remote.repos.length > 0) {
        config.remote = {
            selectedServer: remote.selectedServer || undefined,
            remoteWorkspace: remote.remoteWorkspace || undefined,
            remoteForjaBin: remote.remoteForjaBin || undefined,
            buildOrder: remote.buildOrder.length > 0 ? remote.buildOrder.map(b => `${b.target}:${b.action}`) : undefined,
            transferConfigured: remote.transfer !== null,
        };
    }

    return {
        ok: true,
        action: 'list',
        category: 'config',
        workspace,
        config,
        nextAction: 'forja use target --project <path>',
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

function listRemoteRepos(workspace: string): ListResult {
    const remote = loadRemoteSettings(workspace);
    return {
        ok: true,
        action: 'list',
        category: 'remote-repos',
        workspace,
        remoteRepos: remote.repos,
    };
}
