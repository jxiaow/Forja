/**
 * useTarget/detect — Phase 1: scan targets + detect toolchain environment.
 * Reads from workspaceStore instead of old settingsIO.
 */
import * as fs from 'fs';
import * as os from 'os';
import { collectTargetCandidates } from '../candidates';
import { detectEnv } from '../../../qt/env/envDetector';
import { setSilent } from '../../../core/loggerBase';
import { resolveWorkroot, loadWorkspaceConfig, getActiveTarget } from '../../../core/workspaceStore';
import type { DetectContext, ToolchainInfo } from './types';

export async function detectContext(workspace: string): Promise<DetectContext> {
    setSilent(true);
    let candidates;
    try { candidates = collectTargetCandidates(workspace); } finally { setSilent(false); }
    const toolchain = await detectToolchain(workspace);

    const workroot = resolveWorkroot(workspace);
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const profile = wsConfig ? getActiveTarget(wsConfig) : null;

    // Pass profile directly as existingTarget (now TargetProfile)
    const existingTarget = profile;

    return {
        workspace,
        candidates,
        qtCandidates: candidates.filter(c => c.kind === 'qt'),
        cppCandidates: candidates.filter(c => c.kind === 'cpp'),
        toolchain,
        existingTarget,
        existingQt: {
            pinnedProject: profile && profile.kind === 'qt' ? { root: workroot || workspace, relative: profile.project } : null,
            qtPath: profile?.toolchain.qtPath || '',
            vsInstall: profile?.toolchain.vsInstall || '',
            jomPath: profile?.toolchain.jomPath || '',
            mode: profile?.mode || '',
            arch: profile?.arch || '',
        },
        existingCpp: {
            pinnedProject: profile && profile.kind === 'cpp' ? profile.project : null,
            vsInstall: profile?.toolchain.vsInstall || '',
            mode: profile?.mode || '',
            arch: profile?.arch || '',
        },
        storedToolchains: {},
    };
}

async function detectToolchain(workspace: string): Promise<ToolchainInfo> {
    const result: ToolchainInfo = { qt: false, vs: false, jom: false, make: false, qtCandidates: [], vsCandidates: [] };

    setSilent(true);
    let env;
    try { env = await detectEnv(); } finally { setSilent(false); }

    result.qtCandidates = env.qtCandidates.map(q => ({ path: q.path, version: q.version }));
    result.vsCandidates = env.vsCandidates.map(v => ({ installPath: v.installPath, version: v.version, edition: v.edition }));

    if (env.qt) {
        result.qt = true;
        result.qtPath = env.qt.path;
        result.qtVersion = env.qt.version;
        if (result.qtCandidates.length > 1) { result.qt = false; result.qtPath = undefined; }
    }
    if (env.vs) {
        result.vs = true;
        result.vsInstall = env.vs.installPath;
        result.vsVersion = env.vs.version;
        if (result.vsCandidates.length > 1) { result.vs = false; result.vsInstall = undefined; }
    }
    if (env.jom) {
        if (os.platform() === 'win32') { result.jom = true; result.jomPath = env.jom; }
        else { result.make = true; }
    }

    // Fall back to saved config from workspaceStore
    if (!result.qt || !result.vs || (!result.jom && !result.make)) {
        const workroot = resolveWorkroot(workspace);
        if (workroot) {
            const wsConfig = loadWorkspaceConfig(workroot);
            const profile = getActiveTarget(wsConfig);
            if (profile) {
                if (!result.qt && profile.toolchain.qtPath && fs.existsSync(profile.toolchain.qtPath)) {
                    result.qt = true; result.qtPath = profile.toolchain.qtPath;
                }
                if (!result.vs && profile.toolchain.vsInstall && fs.existsSync(profile.toolchain.vsInstall)) {
                    result.vs = true; result.vsInstall = profile.toolchain.vsInstall;
                }
                if (!result.jom && !result.make && profile.toolchain.jomPath && fs.existsSync(profile.toolchain.jomPath)) {
                    if (os.platform() === 'win32') { result.jom = true; result.jomPath = profile.toolchain.jomPath; }
                    else { result.make = true; }
                }
            }
        }
    }

    return result;
}
