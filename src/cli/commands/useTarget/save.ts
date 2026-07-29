/**
 * useTarget/save — Phase 3: unified save functions.
 * Kind dispatch happens once inside each function, not at every call site.
 */
import * as path from 'path';
import { ActiveTarget } from '../types';
import {
    loadQtSettings, saveQtSettings,
    loadSdkSettings, saveSdkSettings,
    loadActiveTarget, saveActiveTarget,
    loadTargetToolchains, saveTargetToolchains,
} from '../../../core/settingsIO';
import type { ResolvedConfig } from './types';

/**
 * Save target fields to the appropriate domain config (Qt or SDK).
 * Kind dispatch happens here — callers don't need if/else on kind.
 */
export function saveDomainFields(workspace: string, config: ResolvedConfig): { ok: true } | { ok: false; error: string } {
    try {
        if (config.kind === 'qt') {
            const qt = loadQtSettings(workspace);
            qt.pinnedProject = { root: workspace, relative: config.project };
            if (config.mode) qt.mode = config.mode;
            if (config.arch) qt.arch = config.arch;
            if (config.qtPath) qt.qtPath = config.qtPath;
            if (config.qtVersion) qt.qtVersion = config.qtVersion;
            if (config.vsInstall) qt.vsInstall = config.vsInstall;
            if (config.jomPath) qt.jomPath = config.jomPath;
            if (config.qmakeTarget) qt.target = config.qmakeTarget;
            saveQtSettings(workspace, qt);
        } else {
            const sdk = loadSdkSettings(workspace);
            sdk.pinnedProject = config.project;
            if (config.mode) sdk.mode = config.mode;
            if (config.arch) sdk.arch = config.arch;
            if (config.vsInstall) sdk.vsInstall = config.vsInstall;
            saveSdkSettings(workspace, sdk);
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Save the active target pointer.
 */
export function saveActive(workspace: string, target: ActiveTarget): { ok: true } | { ok: false; error: string } {
    try {
        saveActiveTarget(workspace, target);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Save per-target toolchain snapshot.
 */
export function saveToolchain(workspace: string, config: ResolvedConfig): void {
    const toolchains = loadTargetToolchains(workspace);
    toolchains[config.project] = {
        qtPath: config.qtPath,
        qtVersion: config.qtVersion,
        vsInstall: config.vsInstall,
        jomPath: config.jomPath,
        qmakeTarget: config.qmakeTarget,
    };
    saveTargetToolchains(workspace, toolchains);
}

/**
 * Build an ActiveTarget from resolved config.
 */
export function buildActiveTarget(config: ResolvedConfig): ActiveTarget {
    return {
        kind: config.kind,
        project: config.project,
        mode: (config.mode || 'debug') as 'debug' | 'release',
        arch: (config.arch || (process.platform === 'win32' ? 'x86' : 'x64')) as 'x86' | 'x64',
        runAt: config.runAt,
        qtPath: config.qtPath,
        vsInstall: config.vsInstall,
        jomPath: config.jomPath,
        qmakeTarget: config.qmakeTarget,
    };
}

/**
 * Full save: domain config + active target + per-target toolchain.
 * Returns list of changed field names (only fields whose value actually differs).
 */
export function saveAll(workspace: string, config: ResolvedConfig): { ok: true; changed: string[] } | { ok: false; error: string } {
    const oldTarget = loadActiveTarget(workspace);
    const oldQt = config.kind === 'qt' ? loadQtSettings(workspace) : null;
    const oldSdk = config.kind === 'sdk' ? loadSdkSettings(workspace) : null;

    const domainSave = saveDomainFields(workspace, config);
    if (!domainSave.ok) return domainSave;

    const target = buildActiveTarget(config);
    const activeSave = saveActive(workspace, target);
    if (!activeSave.ok) return activeSave;

    saveToolchain(workspace, config);

    const changed: string[] = [];
    const oldProject = oldTarget?.project || oldQt?.pinnedProject?.relative || oldSdk?.pinnedProject || '';
    if (config.project !== oldProject) {
        changed.push(config.kind === 'qt' ? 'qt.pinnedProject' : 'sdk.pinnedProject');
    }
    if (config.qtPath && config.qtPath !== (oldQt?.qtPath || oldTarget?.qtPath)) changed.push('qtPath');
    if (config.vsInstall && config.vsInstall !== (oldQt?.vsInstall || oldSdk?.vsInstall || oldTarget?.vsInstall)) changed.push('vsInstall');
    if (config.jomPath && config.jomPath !== (oldQt?.jomPath || oldTarget?.jomPath)) changed.push('jomPath');
    if (config.mode && config.mode !== (oldTarget?.mode || oldQt?.mode || oldSdk?.mode)) changed.push('mode');
    if (config.arch && config.arch !== (oldTarget?.arch || oldQt?.arch || oldSdk?.arch)) changed.push('arch');
    if (config.qmakeTarget && config.qmakeTarget !== oldQt?.target) changed.push('qmakeTarget');

    return { ok: true, changed };
}
