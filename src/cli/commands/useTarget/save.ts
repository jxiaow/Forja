/**
 * useTarget/save — Phase 3: save to workspaceStore.
 * Single source of truth: per-workspace config file.
 */
import {
    resolveWorkroot, loadWorkspaceConfig, saveWorkspaceConfig,
    generateTargetId, registerWorkroot,
} from '../../../core/workspaceStore';
import type { TargetProfile } from '../../../core/workspaceStore';
import type { ResolvedConfig } from './types';

/**
 * Build a TargetProfile from resolved config (for result output).
 */
export function buildTargetProfile(config: ResolvedConfig): TargetProfile {
    const mode = (config.mode || 'debug') as 'debug' | 'release';
    const arch = (config.arch || (process.platform === 'win32' ? 'x86' : 'x64')) as 'x86' | 'x64';
    const id = generateTargetId(config.kind, config.project, mode, arch, new Set());
    const basename = config.project.split('/').pop()?.replace(/\.\w+$/, '') || config.project;
    return {
        id,
        name: `${basename} ${mode} ${arch}`,
        kind: config.kind,
        project: config.project,
        mode: (config.mode || 'debug') as 'debug' | 'release',
        arch: (config.arch || (process.platform === 'win32' ? 'x86' : 'x64')) as 'x86' | 'x64',
        runAt: config.runAt,
        toolchain: {
            qtPath: config.qtPath,
            qtVersion: config.qtVersion,
            vsInstall: config.vsInstall,
            vsVersion: config.vsVersion,
            jomPath: config.jomPath,
            qmakeTarget: config.qmakeTarget,
        },
    };
}

/**
 * Full save: write target profile to workspaceStore.
 * Returns list of changed field names.
 */
export function saveAll(workspace: string, config: ResolvedConfig): { ok: true; changed: string[] } | { ok: false; error: string } {
    try {
        const workroot = resolveWorkroot(workspace) || workspace;
        const wsConfig = loadWorkspaceConfig(workroot);

        // Ensure workroot is registered
        registerWorkroot(workroot);

        const mode = (config.mode || 'debug') as 'debug' | 'release';
        const arch = (config.arch || (process.platform === 'win32' ? 'x86' : 'x64')) as 'x86' | 'x64';

        // Reuse existing target with same kind/project/mode/arch instead of creating a duplicate
        const matchId = Object.values(wsConfig.targets).find(
            t => t.kind === config.kind && t.project === config.project && t.mode === mode && t.arch === arch
        )?.id;

        const existingIds = new Set(Object.keys(wsConfig.targets));
        const id = matchId ?? generateTargetId(config.kind, config.project, mode, arch, existingIds);
        const basename = config.project.split('/').pop()?.replace(/\.\w+$/, '') || config.project;

        const oldProfile = wsConfig.activeTarget ? wsConfig.targets[wsConfig.activeTarget] : null;

        const profile: TargetProfile = {
            id,
            name: `${basename} ${mode} ${arch}`,
            kind: config.kind,
            project: config.project,
            mode,
            arch,
            runAt: config.runAt || 'local',
            toolchain: {
                qtPath: config.qtPath,
                qtVersion: config.qtVersion,
                vsInstall: config.vsInstall,
                vsVersion: config.vsVersion,
                jomPath: config.jomPath,
                qmakeTarget: config.qmakeTarget,
            },
        };

        wsConfig.targets[id] = profile;
        wsConfig.activeTarget = id;
        saveWorkspaceConfig(wsConfig);

        // Compute changed fields
        const changed: string[] = [];
        if (!oldProfile || oldProfile.project !== config.project) changed.push('project');
        if (config.qtPath && config.qtPath !== oldProfile?.toolchain.qtPath) changed.push('qtPath');
        if (config.vsInstall && config.vsInstall !== oldProfile?.toolchain.vsInstall) changed.push('vsInstall');
        if (config.jomPath && config.jomPath !== oldProfile?.toolchain.jomPath) changed.push('jomPath');
        if (config.mode && config.mode !== oldProfile?.mode) changed.push('mode');
        if (config.arch && config.arch !== oldProfile?.arch) changed.push('arch');
        if (config.qmakeTarget && config.qmakeTarget !== oldProfile?.toolchain.qmakeTarget) changed.push('qmakeTarget');

        return { ok: true, changed };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
