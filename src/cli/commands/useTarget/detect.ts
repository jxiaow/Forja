/**
 * useTarget/detect — Phase 1: scan targets + detect toolchain environment.
 */
import * as fs from 'fs';
import * as os from 'os';
import { collectTargetCandidates } from '../candidates';
import { detectEnv } from '../../../qt/env/envDetector';
import { setSilent } from '../../../core/loggerBase';
import {
    loadQtSettings, loadSdkSettings, loadActiveTarget, loadTargetToolchains,
} from '../../../core/settingsIO';
import type { DetectContext, ToolchainInfo } from './types';

export async function detectContext(workspace: string): Promise<DetectContext> {
    const candidates = collectTargetCandidates(workspace);
    const toolchain = await detectToolchain(workspace);

    const existingTarget = loadActiveTarget(workspace);
    const qt = loadQtSettings(workspace);
    const sdk = loadSdkSettings(workspace);
    const storedToolchains = loadTargetToolchains(workspace);

    return {
        workspace,
        candidates,
        qtCandidates: candidates.filter(c => c.kind === 'qt'),
        sdkCandidates: candidates.filter(c => c.kind === 'sdk'),
        toolchain,
        existingTarget,
        existingQt: {
            pinnedProject: qt.pinnedProject,
            qtPath: qt.qtPath || '',
            vsInstall: qt.vsInstall || '',
            jomPath: qt.jomPath || '',
            mode: qt.mode || '',
            arch: qt.arch || '',
            target: qt.target || '',
        },
        existingSdk: {
            pinnedProject: sdk.pinnedProject ?? null,
            vsInstall: sdk.vsInstall || '',
            mode: sdk.mode || '',
            arch: sdk.arch || '',
        },
        storedToolchains,
    };
}

async function detectToolchain(workspace: string): Promise<ToolchainInfo> {
    const result: ToolchainInfo = { qt: false, vs: false, jom: false, make: false, qtCandidates: [], vsCandidates: [] };

    setSilent(true);
    const env = await detectEnv();
    setSilent(false);

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

    // Fall back to saved config
    if (!result.qt || !result.vs || (!result.jom && !result.make)) {
        const qt = loadQtSettings(workspace);
        if (!result.qt && qt.qtPath && fs.existsSync(qt.qtPath)) { result.qt = true; result.qtPath = qt.qtPath; }
        if (!result.vs && qt.vsInstall && fs.existsSync(qt.vsInstall)) { result.vs = true; result.vsInstall = qt.vsInstall; }
        if (!result.jom && !result.make && qt.jomPath && fs.existsSync(qt.jomPath)) {
            if (os.platform() === 'win32') { result.jom = true; result.jomPath = qt.jomPath; }
            else { result.make = true; }
        }
        const sdk = loadSdkSettings(workspace);
        if (!result.vs && sdk.vsInstall && fs.existsSync(sdk.vsInstall)) { result.vs = true; result.vsInstall = sdk.vsInstall; }
    }

    return result;
}
