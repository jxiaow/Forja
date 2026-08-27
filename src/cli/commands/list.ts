/**
 * `forja list` — read-only enumeration of targets, env.
 */
import { ForjaJsonResult, TargetCandidate, ServerSummary, ServerDetail, EnvSummary, Diagnostic, Locale, T } from './types';
import { collectTargetCandidates } from './candidates';
import { getProjectGroup } from './projectGrouping';
import { listServers, getServerDetail } from './server';
import { loadRemoteSettings } from '../../core/settingsIO';
import { resolveWorkroot, loadWorkspaceConfig, getActiveTarget as getActiveTargetFromStore } from '../../core/workspaceStore';
import { detectMake } from '../../cpp/cli/envDetector';
import { detectEnv } from '../../qt/env/envDetector';
import { setSilent } from '../../core/loggerBase';

function quotePath(p: string): string {
    return p.includes(' ') ? `"${p}"` : p;
}

export type ListCategory = 'targets' | 'env';
/** @internal 'servers' is accessed via `forja server`, not `forja list servers` */
export type InternalListCategory = ListCategory | 'servers';
export type EnvSubCategory = 'qt' | 'vs' | 'jom' | 'make';

export interface SavedTargetInfo {
    id: string;
    name: string;
    kind: 'qt' | 'cpp';
    project: string;
    buildScript?: string;
    mode: string;
    arch: string;
    active: boolean;
}

export interface ListResult extends ForjaJsonResult {
    action: 'list';
    category: InternalListCategory;
    targetGroups?: Record<string, TargetCandidate[]>;
    savedTargets?: SavedTargetInfo[];
    servers?: ServerSummary[] | ServerDetail;
    env?: EnvSummary;
    envSubCategory?: EnvSubCategory;
}

export function formatListText(result: ListResult, _locale: Locale): string {
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
            if (result.workspace) { lines.push(`${T('workspace')}: ${result.workspace}`); }

            // Show saved targets first (from workspaceStore)
            const saved = result.savedTargets || [];
            const targetGroups = result.targetGroups || {};
            const hasDiscovered = Object.values(targetGroups).some(group => group.length > 0);
            if (saved.length > 0) {
                // Only show section header when both sections are present
                if (hasDiscovered) { lines.push(`  ${T('lst.savedTargets')}:`); }
                // Extract project name (strip trailing mode/arch from name)
                const displayNames = saved.map(t => t.name.replace(/\s+(debug|release)\s+(x86|x64)$/, ''));
                const variants = saved.map(t => `${t.mode}|${t.arch}`);
                const maxLen = Math.max(...displayNames.map(n => n.length));
                const maxVariantLen = Math.max(...variants.map(v => v.length));
                for (let i = 0; i < saved.length; i++) {
                    const t = saved[i];
                    const marker = t.active ? '* ' : '  ';
                    const displayName = displayNames[i];
                    const projectDisplay = t.buildScript || t.project;
                    lines.push(`  ${marker}${displayName.padEnd(maxLen)}  ${variants[i].padEnd(maxVariantLen)}  —  ${projectDisplay}`);
                }
                if (hasDiscovered) { lines.push(''); }
            }

            // Show discovered targets
            if (hasDiscovered) {
                lines.push(`  ${T('lst.discoveredTargets')}:`);
                for (const [group, groupTargets] of Object.entries(targetGroups).sort(([a], [b]) => a.localeCompare(b))) {
                    lines.push(`    ${group}:`);
                    const targetLabels = groupTargets.map(t => {
                        const cfg = t.configured ? `${T('configuredMark')} ` : '';
                        return `${cfg}${t.label}`;
                    });
                    const maxTargetLen = Math.max(...targetLabels.map(l => l.length));
                    for (let i = 0; i < groupTargets.length; i++) {
                        const t = groupTargets[i];
                        const marker = t.current ? '* ' : '  ';
                        lines.push(`      ${marker}${targetLabels[i].padEnd(maxTargetLen)}  —  ${t.project}`);
                    }
                }
            } else if (saved.length === 0) {
                lines.push(`  ${T('noneFound')}`);
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
                        const sel = s.selected ? '* ' : '  ';
                        lines.push(`  ${sel}${s.id}  ${s.name}  ${s.username}@${s.host}:${s.port}  auth=${s.authMode}`);
                    }
                }
            } else if (servers) {
                const s = servers as ServerDetail;
                lines.push(`  ${T('serverIdLabel')}: ${s.id}`);
                lines.push(`  ${T('serverNameLabel')}: ${s.name}`);
                lines.push(`  ${T('serverHostLabel')}: ${s.host}`);
                lines.push(`  ${T('serverPortLabel')}: ${s.port}`);
                lines.push(`  ${T('serverUsernameLabel')}: ${s.username}`);
                lines.push(`  ${T('serverAuthLabel')}: ${s.authMode}`);
                if (s.privateKeyPath) { lines.push(`  ${T('key')}: ${s.privateKeyPath}`); }
                if (s.strictHostKeyChecking !== undefined) { lines.push(`  ${T('strictHostKey')}: ${s.strictHostKeyChecking}`); }
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
                        lines.push(`  ${T('jomLabel')}: ${quotePath(env.jom)}`);
                    } else {
                        lines.push(`  ${T('nothingDetected')}`);
                    }
                } else if (result.envSubCategory === 'make') {
                    if (env.make) {
                        lines.push(`  ${T('makeLabel')}: ${T('available')}`);
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
                            lines.push(`  ${T('jomLabel')}: ${env.jom ? quotePath(env.jom) : T('nothingDetected')}`);
                        } else {
                            lines.push(`  ${T('makeLabel')}: ${env.make ? T('available') : T('nothingDetected')}`);
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
                    lines.push(`  ${T('jomLabel')}: ${quotePath(env.jom)}`);
                } else {
                    lines.push(`  ${T('jomLabel')}: ${T('nothingDetected')}`);
                }
                if (env.make) {
                    lines.push(`  ${T('makeLabel')}: ${T('available')}`);
                } else if (process.platform !== 'win32') {
                    lines.push(`  ${T('makeLabel')}: ${T('nothingDetected')}`);
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

export async function runList(workspace: string, category: InternalListCategory, options: { detailId?: string; envSubCategory?: EnvSubCategory; savedOnly?: boolean } = {}): Promise<ListResult> {
    switch (category) {
        case 'targets':
            return listTargets(workspace, options.savedOnly);
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

function listTargets(workspace: string, savedOnly?: boolean): ListResult {
    const diagnostics: Diagnostic[] = [];

    const workroot = resolveWorkroot(workspace);
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const activeProfile = wsConfig ? getActiveTargetFromStore(wsConfig) : null;

    // Build saved targets info from workspaceStore
    const savedTargets: SavedTargetInfo[] = [];
    if (wsConfig) {
        for (const [id, profile] of Object.entries(wsConfig.targets)) {
            savedTargets.push({
                id,
                name: profile.name,
                kind: profile.kind,
                project: profile.project,
                buildScript: profile.buildScript,
                mode: profile.mode,
                arch: profile.arch,
                active: id === wsConfig.activeTarget,
            });
        }
    }

    // Default: only saved targets (skip discovery)
    if (savedOnly) {
        return {
            ok: true,
            action: 'list',
            category: 'targets',
            workspace,
            targetGroups: {},
            savedTargets: savedTargets.length > 0 ? savedTargets : undefined,
            nextAction: savedTargets.length > 0 ? 'forja use target --project <name|path>' : 'forja list targets --all',
        };
    }

    setSilent(true);
    let rawTargets;
    try { rawTargets = collectTargetCandidates(workspace); } finally { setSilent(false); }

    const hasQtTargets = rawTargets.some(t => t.kind === 'qt');
    const hasQtToolchain = activeProfile?.toolchain.qtPath;
    const hasVsToolchain = activeProfile?.toolchain.vsInstall;

    if (!hasQtToolchain && hasQtTargets) {
        diagnostics.push({ level: 'warning', message: T('lst.qtPathNotConfigured') });
    }
    if (process.platform === 'win32' && !hasVsToolchain) {
        diagnostics.push({ level: 'warning', message: T('lst.vsInstallNotConfigured') });
    }

    const groups = new Map<string, TargetCandidate[]>();
    for (const target of rawTargets) {
        const group = getProjectGroup(target.project);
        const groupTargets = groups.get(group) || [];
        groupTargets.push(target);
        groups.set(group, groupTargets);
    }
    const targetGroups = Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));

    const nextAction = savedTargets.length > 0
        ? 'forja use target --project <name|path>'
        : (workroot ? 'forja use target' : 'forja init');

    return {
        ok: true,
        action: 'list',
        category: 'targets',
        workspace,
        targetGroups,
        savedTargets: savedTargets.length > 0 ? savedTargets : undefined,
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
    const remote = loadRemoteSettings(workspace);
    const selectedId = remote.selectedServer || undefined;
    const servers = listServers(selectedId);
    let nextAction: string | undefined = undefined;
    if (servers.length === 0) {
        nextAction = 'forja server add --name <name> --host <host> --username <name>';
    } else if (servers.length === 1) {
        nextAction = `forja remote setup --server ${servers[0].name} --remote-path <path>`;
    } else if (servers.length <= 5) {
        const names = servers.map(s => s.name).join('|');
        nextAction = `forja remote setup --server <${names}> --remote-path <path>`;
    } else {
        nextAction = 'forja remote setup --server <name> --remote-path <path>';
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
    try {
        const env = await detectEnv();

        // Get configured paths from workspaceStore (active target's toolchain)
        const workroot = resolveWorkroot(workspace);
        const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
        const activeProfile = wsConfig ? getActiveTargetFromStore(wsConfig) : null;
        const configuredQtPath = activeProfile?.toolchain.qtPath || '';
        const configuredVsPath = activeProfile?.toolchain.vsInstall || '';

        const summary: EnvSummary = {};
        summary.qt = env.qtCandidates.map(c => ({
            path: c.path, version: c.version,
            ...(c.path === configuredQtPath ? { configured: true } : {}),
        }));
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
    } finally {
        setSilent(false);
    }
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
    try {
        const workroot = resolveWorkroot(workspace);
        const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
        const activeProfile = wsConfig ? getActiveTargetFromStore(wsConfig) : null;
        const configuredPath = activeProfile?.toolchain.qtPath || '';
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
    } finally {
        setSilent(false);
    }
}

async function listEnvVs(workspace: string): Promise<ListResult> {
    const workroot = resolveWorkroot(workspace);
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const activeProfile = wsConfig ? getActiveTargetFromStore(wsConfig) : null;
    const configuredPath = activeProfile?.toolchain.vsInstall || '';

    setSilent(true);
    try {
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
    } finally {
        setSilent(false);
    }
}

async function listEnvJom(): Promise<ListResult> {
    setSilent(true);
    try {
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
    } finally {
        setSilent(false);
    }
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
