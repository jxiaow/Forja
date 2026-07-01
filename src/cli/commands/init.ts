/**
 * Internal init module — called by `forja setup`. Not user-facing.
 * Detects toolchain paths and saves unambiguous config.
 * Idempotent: does not overwrite existing user choices.
 */
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { ForjaJsonResult, Diagnostic, CommandPlan, ActiveTarget, T } from './types';
import { collectTargetCandidates } from './candidates';
import {
    loadQtSettings, saveQtSettings, loadSdkSettings, saveSdkSettings,
    loadActiveTarget, saveActiveTarget,
} from '../../core/settingsIO';
import { choose } from './prompt';

export interface InitResult extends ForjaJsonResult {
    action: 'init';
    mode: 'local' | 'remote';
    detected: {
        qtTargets: number;
        sdkTargets: number;
        toolchain: { qt?: boolean; vs?: boolean; jom?: boolean; make?: boolean };
    };
    saved?: { mode?: string; arch?: string; toolchain?: string[] };
    ambiguous?: boolean;
    plan?: CommandPlan;
}

export interface InitOptions {
    interactive?: boolean;
    mode?: string;
    arch?: string;
    project?: string;
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    reset?: boolean;
}

export async function runInit(workspace: string, options: InitOptions = {}): Promise<InitResult> {
    const diagnostics: Diagnostic[] = [];

    // Check workspace
    if (!fs.existsSync(workspace)) {
        return {
            ok: false,
            action: 'init',
            mode: 'local',
            detected: { qtTargets: 0, sdkTargets: 0, toolchain: {} },
            diagnostics: [{
                level: 'error',
                message: `${T('init.workspaceNotFound')}: ${workspace}`,
                params: { path: workspace },
            }],
        };
    }

    // Scan targets
    const candidates = collectTargetCandidates(workspace);
    const qtCandidates = candidates.filter(c => c.kind === 'qt');
    const sdkCandidates = candidates.filter(c => c.kind === 'sdk');
    const totalTargets = qtCandidates.length + sdkCandidates.length;

    // Detect toolchain (lightweight — just check existing config or try platform detection)
    const toolchainDetected = detectToolchain(workspace);

    // Apply flag overrides for toolchain paths
    if (options.qtPath) { toolchainDetected.qt = true; toolchainDetected.qtPath = options.qtPath; }
    if (options.vsInstall) { toolchainDetected.vs = true; toolchainDetected.vsInstall = options.vsInstall; }
    if (options.jomPath) { toolchainDetected.jom = true; toolchainDetected.jomPath = options.jomPath; }

    // Determine default mode/arch (use options or platform defaults)
    const validModes = ['debug', 'release'];
    const validArches = ['x86', 'x64'];
    if (options.mode && !validModes.includes(options.mode)) {
        return {
            ok: false, action: 'init', mode: 'local',
            detected: { qtTargets: 0, sdkTargets: 0, toolchain: {} },
            workspace,
            diagnostics: [{ level: 'error', message: `${T('init.invalidMode')}: ${options.mode} (${validModes.join('|')})` }],
            nextAction: 'forja setup',
        };
    }
    if (options.arch && !validArches.includes(options.arch)) {
        return {
            ok: false, action: 'init', mode: 'local',
            detected: { qtTargets: 0, sdkTargets: 0, toolchain: {} },
            workspace,
            diagnostics: [{ level: 'error', message: `${T('init.invalidArch')}: ${options.arch} (${validArches.join('|')})` }],
            nextAction: 'forja setup',
        };
    }
    const defaultMode = (options.mode || 'release') as 'debug' | 'release';
    const defaultArch = (options.arch || (os.platform() === 'win32' ? 'x86' : 'x64')) as 'x86' | 'x64';

    // Check if already initialized (reset bypasses this check)
    const existingActiveTarget = options.reset ? null : loadActiveTarget(workspace);
    const existingQt = loadQtSettings(workspace);
    const existingSdk = loadSdkSettings(workspace);
    const alreadyInitialized = !options.reset && (existingActiveTarget !== null || !!existingQt.qtPath || !!existingSdk.vsInstall);

    // Resolve target selection early — validate project flag BEFORE any state mutation
    let effectiveCandidates = candidates;
    if (options.project) {
        const match = candidates.find(c => c.project === options.project)
            || candidates.find(c => c.label === options.project);
        if (match) {
            effectiveCandidates = [match];
        } else {
            diagnostics.push({
                level: 'error',
                message: `${T('init.projectNotFound')}: ${options.project}`,
                params: { project: options.project },
            });
            return {
                ok: false,
                action: 'init',
                mode: 'local',
                detected: { qtTargets: qtCandidates.length, sdkTargets: sdkCandidates.length, toolchain: { qt: toolchainDetected.qt, vs: toolchainDetected.vs, jom: toolchainDetected.jom, make: toolchainDetected.make } },
                workspace,
                diagnostics,
                nextAction: 'forja list targets',
            };
        }
    } else if (totalTargets > 1 && options.interactive) {
        const chosen = await choose(
            T('init.selectTarget'),
            candidates,
            c => `${c.label} (${c.kind}) — ${c.project}`,
        );
        if (chosen) {
            effectiveCandidates = [chosen];
        }
    }

    // Save toolchain defaults (only fill missing)
    const savedToolchain: string[] = [];
    const detected = {
        qtTargets: qtCandidates.length,
        sdkTargets: sdkCandidates.length,
        toolchain: { qt: toolchainDetected.qt, vs: toolchainDetected.vs, jom: toolchainDetected.jom, make: toolchainDetected.make },
    };

    if (qtCandidates.length > 0 || existingQt.qtPath || options.reset) {
        const qt = { ...existingQt };
        let changed = false;
        if ((options.reset || !qt.qtPath) && toolchainDetected.qtPath) { qt.qtPath = toolchainDetected.qtPath; savedToolchain.push('qtPath'); changed = true; }
        if ((options.reset || !qt.vsInstall) && toolchainDetected.vsInstall) { qt.vsInstall = toolchainDetected.vsInstall; savedToolchain.push('vsInstall'); changed = true; }
        if ((options.reset || !qt.jomPath) && toolchainDetected.jomPath) { qt.jomPath = toolchainDetected.jomPath; savedToolchain.push('jomPath'); changed = true; }
        if (!existingActiveTarget) {
            if (options.reset || !qt.mode) { qt.mode = defaultMode; savedToolchain.push('mode'); changed = true; }
            if (options.reset || !qt.arch) { qt.arch = defaultArch; savedToolchain.push('arch'); changed = true; }
        }
        if (changed) {
            try { saveQtSettings(workspace, qt); } catch (e) {
                return initWriteFailed(e, detected);
            }
        }
    }

    if (sdkCandidates.length > 0 || existingSdk.vsInstall || options.reset) {
        const sdk = { ...existingSdk };
        let changed = false;
        if ((options.reset || !sdk.vsInstall) && toolchainDetected.vsInstall) { sdk.vsInstall = toolchainDetected.vsInstall; savedToolchain.push('vsInstall'); changed = true; }
        if (changed) {
            try { saveSdkSettings(workspace, sdk); } catch (e) {
                return initWriteFailed(e, detected);
            }
        }
    }

    const saved: { mode?: string; arch?: string; toolchain?: string[] } = {};
    if (savedToolchain.includes('mode')) { saved.mode = defaultMode; }
    if (savedToolchain.includes('arch')) { saved.arch = defaultArch; }
    if (savedToolchain.length > 0) { saved.toolchain = savedToolchain; }

    // Auto-select single target (preserve existing user choices)
    let activeTarget: ActiveTarget | undefined;
    let ambiguous = false;

    if (effectiveCandidates.length === 1) {
        const single = effectiveCandidates[0];
        // Preserve existing activeTarget settings if they exist
        const existing = existingActiveTarget;
        activeTarget = {
            kind: single.kind,
            project: single.project,
            mode: (options.reset ? defaultMode : existing?.mode) || defaultMode,
            arch: (options.reset ? defaultArch : existing?.arch) || defaultArch,
            runAt: existing?.kind === single.kind ? (existing?.runAt || 'local') : 'local',
        };
        // Only save if not already initialized or target changed
        if (!existing || existing.project !== single.project || existing.kind !== single.kind) {
            try {
                // Domain config first, activeTarget last — reduces partial-write window (not fully atomic)
                if (single.kind === 'qt') {
                    const qt = loadQtSettings(workspace);
                    qt.pinnedProject = { root: workspace, relative: single.project };
                    if (!qt.mode) { qt.mode = defaultMode as 'debug' | 'release'; }
                    if (!qt.arch) { qt.arch = defaultArch as 'x86' | 'x64'; }
                    saveQtSettings(workspace, qt);
                } else {
                    const sdk = loadSdkSettings(workspace);
                    sdk.pinnedProject = single.project;
                    if (!sdk.mode) { sdk.mode = defaultMode as 'debug' | 'release'; }
                    if (!sdk.arch) { sdk.arch = defaultArch as 'x86' | 'x64'; }
                    saveSdkSettings(workspace, sdk);
                }
                saveActiveTarget(workspace, activeTarget!);
            } catch (e) {
                return initWriteFailed(e, detected);
            }
        }
    } else if (effectiveCandidates.length > 1) {
        ambiguous = true;
        if (qtCandidates.length > 0 && sdkCandidates.length > 0) {
            const qtNames = qtCandidates.map(c => c.label).join(', ');
            const sdkNames = sdkCandidates.map(c => c.label).join(', ');
            diagnostics.push({
                level: 'info',
                message: `${T('init.foundQtSdkNotAutoSelecting')}: ${qtCandidates.length} Qt (${qtNames}), ${sdkCandidates.length} SDK (${sdkNames})`,
                params: { qtCount: String(qtCandidates.length), sdkCount: String(sdkCandidates.length) },
            });
        } else {
            const names = candidates.map(c => c.label).join(', ');
            diagnostics.push({
                level: 'info',
                message: `${T('init.foundTargetsNotAutoSelecting')}: ${totalTargets} (${names})`,
                params: { count: String(totalTargets) },
            });
        }
    } else {
        diagnostics.push({
            level: 'info',
            message: T('init.noTargetsToolchainOnly'),
        });
    }

    // Toolchain warnings
    if (!toolchainDetected.qt) {
        diagnostics.push({
            level: 'warning',
            message: T('init.qtMissing'),
        });
    }
    if (process.platform === 'win32' && !toolchainDetected.vs) {
        diagnostics.push({
            level: 'warning',
            message: T('init.vsMissing'),
        });
    }
    if (process.platform === 'win32' && !toolchainDetected.jom) {
        diagnostics.push({
            level: 'warning',
            message: T('init.jomMissing'),
        });
    }
    if (process.platform !== 'win32' && !toolchainDetected.make) {
        diagnostics.push({
            level: 'warning',
            message: T('init.makeMissing'),
        });
    }

    if (alreadyInitialized && savedToolchain.length === 0 && !activeTarget) {
        diagnostics.push({
            level: 'info',
            message: T('init.configAlreadyExists'),
        });
    }

    // Build next actions
    let nextAction: string | undefined = undefined;
    if (activeTarget) {
        nextAction = 'forja build';
    } else if (ambiguous) {
        nextAction = 'forja list targets';
    } else if (totalTargets === 0) {
        nextAction = undefined;
    } else {
        nextAction = 'forja list targets';
    }

    return {
        ok: true,
        action: 'init',
        mode: 'local',
        workspace,
        detected,
        saved: Object.keys(saved).length > 0 ? saved : undefined,
        ambiguous: ambiguous || undefined,
        activeTarget,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        nextAction,
    };
}

interface ToolchainDetection {
    qt: boolean;
    vs: boolean;
    jom: boolean;
    make: boolean;
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
}

function detectToolchain(workspace: string): ToolchainDetection {
    const result: ToolchainDetection = { qt: false, vs: false, jom: false, make: false };

    // Check existing config first
    const qt = loadQtSettings(workspace);
    if (qt.qtPath && fs.existsSync(qt.qtPath)) {
        result.qt = true;
        result.qtPath = qt.qtPath;
    }
    if (qt.vsInstall && fs.existsSync(qt.vsInstall)) {
        result.vs = true;
        result.vsInstall = qt.vsInstall;
    }
    if (qt.jomPath && fs.existsSync(qt.jomPath)) {
        result.jom = true;
        result.jomPath = qt.jomPath;
    }

    const sdk = loadSdkSettings(workspace);
    if (!result.vs && sdk.vsInstall && fs.existsSync(sdk.vsInstall)) {
        result.vs = true;
        result.vsInstall = sdk.vsInstall;
    }

    // Check make on POSIX
    if (os.platform() !== 'win32') {
        try {
            execSync('which make', { stdio: 'ignore', timeout: 5000 });
            result.make = true;
        } catch { /* make not found */ }
    }

    return result;
}

function initWriteFailed(e: unknown, detected?: InitResult['detected']): InitResult {
    return {
        ok: false,
        action: 'init',
        mode: 'local',
        detected: detected ?? { qtTargets: 0, sdkTargets: 0, toolchain: {} },
        diagnostics: [{
            level: 'error',
            message: `${T('init.configWriteFailed')}: ${e instanceof Error ? e.message : String(e)}`,
            params: { detail: e instanceof Error ? e.message : String(e) },
        }],
    };
}

