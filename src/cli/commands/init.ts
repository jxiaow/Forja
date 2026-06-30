/**
 * Internal init module — called by `forja setup`. Not user-facing.
 * Detects toolchain paths and saves unambiguous config.
 * Idempotent: does not overwrite existing user choices.
 */
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { ForjaJsonResult, Diagnostic, CommandPlan, ActiveTarget, Locale, T } from './types';
import { collectTargetCandidates } from './candidates';
import {
    loadQtSettings, saveQtSettings, loadSdkSettings, saveSdkSettings,
    loadActiveTarget, saveActiveTarget,
    loadRemoteSettings, loadSyncSettings,
} from '../../core/settingsIO';
import { getServerById } from '../../core/serverStore';
import { executeRemoteBridge, RemoteBridgeTarget } from '../../remote/core/bridge';
import { createSshRunner } from '../../remote/core/shell';
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

export async function runInit(workspace: string, options: { plan?: boolean; remote?: boolean; server?: string; interactive?: boolean } = {}): Promise<InitResult> {
    const diagnostics: Diagnostic[] = [];

    // Check workspace
    if (!fs.existsSync(workspace)) {
        return {
            ok: false,
            action: 'init',
            mode: options.remote ? 'remote' : 'local',
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

    // Determine default mode/arch
    const defaultMode = 'release';
    const defaultArch = os.platform() === 'win32' ? 'x86' : 'x64';

    // Plan mode
    if (options.plan) {
        const willWrite: string[] = [];
        const willSave: Record<string, string> = {};
        const existingForPlan = loadActiveTarget(workspace);
        const existingQtForPlan = loadQtSettings(workspace);
        const existingSdkForPlan = loadSdkSettings(workspace);
        if (!existingForPlan) {
            willSave.mode = defaultMode;
            willSave.arch = defaultArch;
        }

        if (toolchainDetected.qt && !existingQtForPlan.qtPath) { willSave.qtPath = toolchainDetected.qtPath || ''; }
        if (toolchainDetected.vs && !existingQtForPlan.vsInstall && !existingSdkForPlan.vsInstall) { willSave.vsInstall = toolchainDetected.vsInstall || ''; }
        if (toolchainDetected.jom && !existingQtForPlan.jomPath) { willSave.jomPath = toolchainDetected.jomPath || ''; }

        if (totalTargets === 1) {
            const single = candidates[0];
            if (!existingForPlan || existingForPlan.project !== single.project || existingForPlan.kind !== single.kind) {
                willSave.activeTarget = single.project;
                willWrite.push(`~/.forja/projects/<hash(workspace:activeTarget)>.json`);
            }
        }
        if (qtCandidates.length > 0) {
            willWrite.push(`~/.forja/projects/<hash(workspace:qt)>.json`);
        }
        if (sdkCandidates.length > 0) {
            willWrite.push(`~/.forja/projects/<hash(workspace:sdk)>.json`);
        }

        const willRun: string[] = [];
        if (options.remote) {
            const remoteKinds: string[] = [];
            if (qtCandidates.length > 0) { remoteKinds.push('qt'); }
            if (sdkCandidates.length > 0) { remoteKinds.push('sdk'); }
            if (remoteKinds.length === 0) {
                // Consistent with execution: no targets → skip bridge
            } else {
                for (const kind of remoteKinds) {
                    willRun.push(`<remoteForjaBin> ${kind} init --workspace <remotePath> --json`);
                }
            }
        }

        const planDiagnostics: Diagnostic[] = [];
        if (totalTargets > 1) {
            if (qtCandidates.length > 0 && sdkCandidates.length > 0) {
                planDiagnostics.push({
                    level: 'info',
                    message: `${T('init.foundQtSdkNotAutoSelecting')}: ${qtCandidates.length} Qt, ${sdkCandidates.length} SDK`,
                    params: { qtCount: String(qtCandidates.length), sdkCount: String(sdkCandidates.length) },
                });
            } else {
                const names = candidates.map(c => c.label).join(', ');
                planDiagnostics.push({
                    level: 'info',
                    message: `${T('init.foundTargetsNotAutoSelecting')}: ${totalTargets} (${names})`,
                    params: { count: String(totalTargets) },
                });
            }
        }
        const alreadyInitForPlan = existingForPlan !== null || !!existingQtForPlan.qtPath || !!existingSdkForPlan.vsInstall;
        if (alreadyInitForPlan && Object.keys(willSave).length === 0) {
            planDiagnostics.push({ level: 'info', message: T('init.configAlreadyExists') });
        }

        return {
            ok: true,
            action: 'init',
            mode: options.remote ? 'remote' : 'local',
            workspace,
            detected: {
                qtTargets: qtCandidates.length,
                sdkTargets: sdkCandidates.length,
                toolchain: {
                    qt: toolchainDetected.qt,
                    vs: toolchainDetected.vs,
                    jom: toolchainDetected.jom,
                    make: toolchainDetected.make,
                },
            },
            plan: {
                mode: 'dryRun',
                willWrite,
                willRun,
            },
            diagnostics: planDiagnostics.length > 0 ? planDiagnostics : undefined,
            nextAction: 'forja setup',
        };
    }

    // Check if already initialized
    const existingActiveTarget = loadActiveTarget(workspace);
    const existingQt = loadQtSettings(workspace);
    const existingSdk = loadSdkSettings(workspace);
    const alreadyInitialized = existingActiveTarget !== null || !!existingQt.qtPath || !!existingSdk.vsInstall;

    // Save toolchain defaults (only fill missing)
    const savedToolchain: string[] = [];

    if (qtCandidates.length > 0 || existingQt.qtPath) {
        const qt = { ...existingQt };
        let changed = false;
        if (!qt.qtPath && toolchainDetected.qtPath) { qt.qtPath = toolchainDetected.qtPath; savedToolchain.push('qtPath'); changed = true; }
        if (!qt.vsInstall && toolchainDetected.vsInstall) { qt.vsInstall = toolchainDetected.vsInstall; savedToolchain.push('vsInstall'); changed = true; }
        if (!qt.jomPath && toolchainDetected.jomPath) { qt.jomPath = toolchainDetected.jomPath; savedToolchain.push('jomPath'); changed = true; }
        if (!existingActiveTarget) {
            if (!qt.mode) { qt.mode = defaultMode; savedToolchain.push('mode'); changed = true; }
            if (!qt.arch) { qt.arch = defaultArch; savedToolchain.push('arch'); changed = true; }
        }
        if (changed) {
            try { saveQtSettings(workspace, qt); } catch (e) {
                return initWriteFailed(e);
            }
        }
    }

    if (sdkCandidates.length > 0 || existingSdk.vsInstall) {
        const sdk = { ...existingSdk };
        let changed = false;
        if (!sdk.vsInstall && toolchainDetected.vsInstall) { sdk.vsInstall = toolchainDetected.vsInstall; savedToolchain.push('vsInstall'); changed = true; }
        if (changed) {
            try { saveSdkSettings(workspace, sdk); } catch (e) {
                return initWriteFailed(e);
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

    // Interactive selection when multiple targets found
    let effectiveCandidates = candidates;
    if (totalTargets > 1 && options.interactive && !options.plan) {
        const chosen = await choose(
            T('init.selectTarget'),
            candidates,
            c => `${c.label} (${c.kind}) — ${c.project}`,
        );
        if (chosen) {
            effectiveCandidates = [chosen];
        }
    }

    if (effectiveCandidates.length === 1) {
        const single = effectiveCandidates[0];
        // Preserve existing activeTarget settings if they exist
        const existing = existingActiveTarget;
        activeTarget = {
            kind: single.kind,
            project: single.project,
            mode: existing?.mode || (defaultMode as 'debug' | 'release'),
            arch: existing?.arch || (defaultArch as 'x86' | 'x64'),
            runAt: existing?.kind === single.kind ? (existing?.runAt || 'local') : 'local',
        };
        // Only save if not already initialized or target changed
        if (!existing || existing.project !== single.project || existing.kind !== single.kind) {
            try {
                // Domain config first, activeTarget last — avoids partial-write state
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
                saveActiveTarget(workspace, activeTarget);
            } catch (e) {
                return initWriteFailed(e);
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

    // Remote initialization — execute bridge init on remote
    let initMode: 'local' | 'remote' = 'local';
    if (options.remote) {
        initMode = 'remote';
        const remote = loadRemoteSettings(workspace);
        const sync = loadSyncSettings(workspace);
        const serverId = options.server || remote.selectedServer || sync.selectedServer;

        if (!serverId) {
            diagnostics.push({
                level: 'error',
                message: T('init.remoteNoServer'),
                hint: 'Use `forja use remote --server <name>` first',
            });
        } else {
            const server = getServerById(serverId);
            if (!server) {
                diagnostics.push({
                    level: 'error',
                    message: `${T('init.serverNotFound')}: ${serverId}`,
                });
            } else {
                const remotePath = remote.remotePaths[serverId] || sync.remotePaths[serverId];
                if (!remotePath) {
                    diagnostics.push({
                        level: 'error',
                        message: `${T('init.remotePathMissing')}: ${serverId}`,
                        hint: 'Use `forja use remote --server <name> --remote-path <path>`',
                    });
                } else {
                    // Execute remote bridge init — determine target kinds
                    const remoteForjaBin = remote.remoteForjaBin || undefined;
                    const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
                    const runner = createSshRunner(server, password);

                    const targetKinds = new Set<RemoteBridgeTarget>();
                    if (activeTarget) {
                        targetKinds.add(activeTarget.kind);
                    } else {
                        if (qtCandidates.length > 0) { targetKinds.add('qt'); }
                        if (sdkCandidates.length > 0) { targetKinds.add('sdk'); }
                    }

                    if (targetKinds.size === 0) {
                        diagnostics.push({
                            level: 'info',
                            message: T('init.noLocalTargetsSkipRemote'),
                        });
                    } else {
                        let allBridgesOk = true;
                        for (const kind of targetKinds) {
                            const bridgeResult = await executeRemoteBridge({
                                target: kind,
                                action: 'init',
                                args: [],
                                json: true,
                                remotePath,
                                runner,
                                remoteForjaBin,
                            });
                            if (!bridgeResult.ok) {
                                allBridgesOk = false;
                                const notFound = bridgeResult.exitCode === 127 || bridgeResult.exitCode === 126;
                                diagnostics.push({
                                    level: 'error',
                                    message: `${T('init.remoteInitFailed')} ${kind}: ${bridgeResult.diagnostics.map(d => d.message).join('; ')}`,
                                    hint: notFound
                                        ? 'Remote Forja binary not found. Use `forja doctor fix --remote` to install.'
                                        : undefined,
                                });
                            } else {
                                diagnostics.push({
                                    level: 'info',
                                    message: `${T('init.remoteInitSucceeded')} ${kind} (server=${server.name || serverId}, path=${remotePath})`,
                                });
                            }
                        }

                        // Only switch activeTarget to remote after bridge succeeds
                        if (allBridgesOk && activeTarget && activeTarget.runAt !== 'remote') {
                            activeTarget = { ...activeTarget, runAt: 'remote' };
                            try {
                                saveActiveTarget(workspace, activeTarget);
                            } catch (e) {
                                return initWriteFailed(e);
                            }
                        }
                    }
                }
            }
        }
    }

    // Build next actions
    let nextAction: string | undefined = undefined;
    if (activeTarget) {
        nextAction = 'forja build';
    } else if (ambiguous) {
        nextAction = 'forja list targets';
    } else {
        nextAction = 'forja list targets';
    }

    const hasRemoteError = options.remote && diagnostics.some(d => d.level === 'error');

    return {
        ok: !hasRemoteError,
        action: 'init',
        mode: initMode,
        workspace,
        detected: {
            qtTargets: qtCandidates.length,
            sdkTargets: sdkCandidates.length,
            toolchain: {
                qt: toolchainDetected.qt,
                vs: toolchainDetected.vs,
                jom: toolchainDetected.jom,
                make: toolchainDetected.make,
            },
        },
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

function initWriteFailed(e: unknown): InitResult {
    return {
        ok: false,
        action: 'init',
        mode: 'local',
        detected: { qtTargets: 0, sdkTargets: 0, toolchain: {} },
        diagnostics: [{
            level: 'error',
            message: `${T('init.configWriteFailed')}: ${e instanceof Error ? e.message : String(e)}`,
            params: { detail: e instanceof Error ? e.message : String(e) },
        }],
    };
}

// ── Text output ──

export function formatInitText(result: InitResult, locale: Locale): string {
    if (!result.ok) {
        const lines = [T('initFailed')];
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                lines.push(`${d.level === 'error' ? T('error') : T('warning')}: ${d.message}`);
                if (d.hint) { lines.push(`  ${T('hint')}: ${d.hint}`); }
            }
        }
        return lines.join('\n');
    }

    if (result.plan) {
        const lines = [T('initPlan')];
        if (result.workspace) { lines.push(`${T('workspace')} ${result.workspace}`); }
        lines.push(T('initWillDetect'));
        lines.push(T('next'));
        if (result.nextAction) {
            const a = result.nextAction; lines.push(`  ${a}`); }
        return lines.join('\n');
    }

    const lines = [T('initSucceeded')];
    if (result.workspace) { lines.push(`${T('workspace')} ${result.workspace}`); }

    const d = result.detected;
    const targetParts: string[] = [];
    if (d.qtTargets > 0) { targetParts.push(`${d.qtTargets} ${d.qtTargets > 1 ? T('qtTargetPlural') : T('qtTargetSingular')}`); }
    if (d.sdkTargets > 0) { targetParts.push(`${d.sdkTargets} ${d.sdkTargets > 1 ? T('sdkTargetPlural') : T('sdkTargetSingular')}`); }
    const tcParts: string[] = [];
    if (d.toolchain.qt) { tcParts.push('Qt'); }
    if (d.toolchain.vs) { tcParts.push('VS'); }
    if (d.toolchain.jom) { tcParts.push('jom'); }
    if (d.toolchain.make) { tcParts.push('make'); }
    lines.push(`${T('detected')} ${targetParts.length > 0 ? targetParts.join(', ') : T('zeroTargets')}, toolchain: ${tcParts.length > 0 ? tcParts.join('/') : T('toolchainNone')}`);

    if (result.saved) {
        const savedParts: string[] = [];
        if (result.saved.mode) { savedParts.push(`mode=${result.saved.mode}`); }
        if (result.saved.arch) { savedParts.push(`arch=${result.saved.arch}`); }
        if (result.activeTarget) { savedParts.push(`activeTarget=${result.activeTarget.project}`); }
        if (savedParts.length > 0) { lines.push(`${T('saved')} ${savedParts.join(' ')}`); }
    }

    if (result.ambiguous) {
        lines.push(T('initNotAutoSelecting'));
    }

    if (result.activeTarget) {
        const t = result.activeTarget;
        lines.push(`${T('activeTarget')} ${t.kind} ${t.project} ${t.mode} ${t.arch} ${t.runAt}`);
    }

    if (result.diagnostics) {
        for (const d of result.diagnostics) {
            if (d.level === 'warning') { lines.push(`${T('warning')}: ${d.message}`); }
        }
    }

    lines.push(T('next'));
    if (result.nextAction) {
            const a = result.nextAction; lines.push(`  ${a}`); }

    return lines.join('\n');
}
