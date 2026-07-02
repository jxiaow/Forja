/**
 * `forja status` — lightweight read-only status and readiness.
 * No SSH probes, no full toolchain detection, no config writes.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    ForjaJsonResult, Diagnostic, Readiness, ReadinessState, ActiveTarget,
    RuntimeState, Locale, readinessText, T,
} from './types';
import { getActiveTarget } from './activeTarget';
import { aggregateCandidates } from './candidates';
import {
    loadQtSettings, loadSdkSettings, loadSyncSettings, loadRemoteSettings,
    getCorruptedConfigs, clearCorruptedConfigs,
    QtSettings, SdkSettings, SyncSettings, RemoteSettings, CorruptedConfig,
} from '../../core/settingsIO';
import { readRunState, resolveRunProcessStatus } from '../../qt/shared/localState';
import { getServerById } from '../../core/serverStore';
import { resolveRemoteConfigFrom } from '../../remote/core/config';
import { detectMake } from '../../sdk/cli/envDetector';
import { validateMakefile } from '../../qt/shared/runtimeTarget';

export interface StatusResult extends ForjaJsonResult {
    action: 'status';
    readiness: Readiness;
    toolchain?: ToolchainSummary;
    remote?: RemoteStatusSummary;
    sync?: SyncStatusSummary;
    runtime?: RuntimeState;
    nextAction?: string;
}

export interface ToolchainSummary {
    qt?: { path: string; version?: string };
    vs?: { path: string; version?: string };
    jom?: string;
    make?: boolean;
}

export interface RemoteStatusSummary {
    runAt: 'local' | 'remote';
    server?: { id: string; name: string; host: string };
    remotePath?: string;
    remoteForjaBin?: string;
    workspaceMode?: 'legacy' | 'staged';
}

export interface SyncStatusSummary {
    enabled: boolean;
    server?: { id: string; name: string; host: string; username: string; port: number; authMode: string };
    remotePath?: string;
}

export function runStatus(workspace: string): StatusResult {
    const diagnostics: Diagnostic[] = [];
    const readiness: Readiness = {};

    // Check workspace exists
    if (!fs.existsSync(workspace)) {
        return {
            ok: false,
            action: 'status',
            readiness: { target: 'unknown', toolchain: 'unknown', sync: 'unknown', remote: 'unknown' },
            diagnostics: [{
                level: 'error',
                message: `${T('sts.workspaceNotFound')}: ${workspace}`,
                params: { path: workspace },
            }],
            nextAction: 'forja status --workspace <path>',
        };
    }

    // Load all configs once — also populates corruption tracking as a side-effect
    const qtConfig = loadQtSettings(workspace);
    const sdkConfig = loadSdkSettings(workspace);
    const syncConfig = loadSyncSettings(workspace);
    const remoteConfig = loadRemoteSettings(workspace);
    const corrupted = getCorruptedConfigs();
    clearCorruptedConfigs();
    if (corrupted.length > 0) {
        const detail = corrupted.map((c: CorruptedConfig) => `${path.basename(c.path)} — ${c.detail}`).join(', ');
        return {
            ok: false,
            action: 'status',
            readiness: { target: 'unknown', toolchain: 'unknown', sync: 'unknown', remote: 'unknown' },
            diagnostics: [{
                level: 'error',
                message: `${T('sts.configCorrupted')}: ${detail}`,
                hint: T('sts.configCorruptedHint'),
                fix: 'forja setup',
                params: { file: corrupted.map((c: CorruptedConfig) => c.path).join(', '), detail: corrupted.map((c: CorruptedConfig) => c.detail).join('; ') },
            }],
            nextAction: 'forja setup',
        };
    }

    const activeTarget = getActiveTarget(workspace);

    // ── Target readiness ──
    if (!activeTarget) {
        readiness.target = 'not-selected';
        const candidates = aggregateCandidates(workspace, activeTarget, qtConfig, sdkConfig);
        const qtCount = candidates.filter(c => c.kind === 'qt').length;
        const sdkCount = candidates.filter(c => c.kind === 'sdk').length;
        if (qtCount > 0 || sdkCount > 0) {
            diagnostics.push({
                level: 'info',
                message: T('sts.targetsFound').replace('{0}', String(qtCount)).replace('{1}', String(sdkCount)),
                fix: 'forja list targets',
                params: { qtCount: String(qtCount), sdkCount: String(sdkCount) },
            });
        } else {
            diagnostics.push({
                level: 'warning',
                message: T('noActiveTarget'),
                fix: 'forja setup',
            });
        }
    } else {
        const projectPath = path.isAbsolute(activeTarget.project)
            ? activeTarget.project
            : path.join(workspace, activeTarget.project);
        if (!fs.existsSync(projectPath)) {
            readiness.target = 'missing';
            diagnostics.push({
                level: 'error',
                message: `${T('sts.projectFileMissing')}: ${activeTarget.project}`,
                hint: T('fileMayDeleted'),
                fix: 'forja list targets',
                params: { project: activeTarget.project },
            });
        } else {
            readiness.target = 'ready';
            // Check Makefile mismatch for Qt targets
            if (activeTarget.kind === 'qt') {
                const projectDir = path.dirname(projectPath);
                const mfValidation = validateMakefile(projectDir, {
                    mode: activeTarget.mode,
                    arch: activeTarget.arch,
                    qtPath: qtConfig.qtPath,
                    proFile: activeTarget.project,
                    target: qtConfig.target,
                    qmakeArgs: qtConfig.qmakeArgs,
                });
                if (mfValidation.exists && !mfValidation.matches && mfValidation.mismatch) {
                    readiness.target = 'blocked';
                    diagnostics.push({
                        level: 'warning',
                        message: `${T('sts.makefileMismatch')} (${mfValidation.mismatch.join(', ')})`,
                        hint: T('sts.makefileMismatchHint'),
                        fix: 'forja build qmake',
                        params: { diff: mfValidation.mismatch.join(', ') },
                    });
                }
            }
        }
    }

    // ── Toolchain readiness ──
    let toolchainSummary: ToolchainSummary | undefined;
    if (!activeTarget) {
        const hasAnyConfig = qtConfig.qtPath || qtConfig.vsInstall || sdkConfig.vsInstall || sdkConfig.pinnedProject;
        readiness.toolchain = hasAnyConfig ? 'configured' : 'unknown';
        if (!hasAnyConfig) {
            diagnostics.push({
                level: 'warning',
                message: T('notInitialized'),
                fix: 'forja setup',
            });
        }
    } else {
        toolchainSummary = buildToolchainSummary(activeTarget, qtConfig, sdkConfig);
        readiness.toolchain = assessToolchainReadiness(toolchainSummary, activeTarget, diagnostics, qtConfig.qtPath);
    }

    // ── Sync readiness ──
    const syncServer = syncConfig.selectedServer ? getServerById(syncConfig.selectedServer) : null;
    if (!syncConfig.enabled) {
        readiness.sync = 'not-selected';
        if (activeTarget?.runAt === 'remote' && !syncConfig.selectedServer) {
            diagnostics.push({
                level: 'warning',
                message: T('noSyncServer'),
                hint: T('noSyncServerHint'),
                fix: 'forja list servers',
            });
        } else if (activeTarget?.runAt === 'remote' && syncConfig.selectedServer) {
            diagnostics.push({
                level: 'warning',
                message: T('sts.syncNotEnabled'),
                hint: T('noSyncServerHint'),
                fix: 'forja use sync',
            });
        } else if (activeTarget?.runAt === 'local' && !syncConfig.selectedServer) {
            diagnostics.push({
                level: 'info',
                message: T('sts.syncNotEnabled'),
                fix: 'forja use sync',
            });
        }
    } else {
        if (!syncServer) {
            readiness.sync = 'blocked';
            diagnostics.push({
                level: 'error',
                message: T('sts.syncServerNotFound').replace('{0}', syncConfig.selectedServer),
                hint: T('serverDeleted'),
                fix: 'forja list servers',
                params: { server: syncConfig.selectedServer },
            });
        } else {
            const remotePath = syncConfig.remotePaths[syncConfig.selectedServer];
            if (!remotePath) {
                readiness.sync = 'missing';
                diagnostics.push({
                    level: 'error',
                    message: `${T('remotePathNotConfigured')}: ${syncConfig.selectedServer}`,
                    fix: 'forja use sync',
                    params: { server: syncConfig.selectedServer },
                });
            } else {
                readiness.sync = 'configured';
            }
        }
    }

    // ── Remote readiness ──
    if (!activeTarget || activeTarget.runAt === 'local') {
        readiness.remote = 'not-selected';
    } else {
        const resolvedRemote = resolveRemoteConfigFrom(workspace, remoteConfig, syncConfig);

        if (!resolvedRemote.config) {
            readiness.remote = 'missing';
            diagnostics.push({
                level: 'error',
                message: T('remoteNoServer'),
                fix: 'forja list servers',
            });
        } else {
            // Check remote Forja bin - not an error since it defaults to $HOME/.forja/bin/forja
            if (!remoteConfig.remoteForjaBin) {
                diagnostics.push({
                    level: 'info',
                    message: T('remoteForjaBinDefault'),
                    hint: T('deployRemote'),
                });
            }
            // Check remote path
            if (!resolvedRemote.config.remotePath) {
                const serverId = remoteConfig.selectedServer || syncConfig.selectedServer || '';
                diagnostics.push({
                    level: 'error',
                    message: serverId ? `${T('remotePathNotConfigured')}: ${serverId}` : T('remotePathNotConfigured'),
                    fix: 'forja list servers',
                    params: serverId ? { server: serverId } : undefined,
                });
                readiness.remote = 'missing';
            } else {
                readiness.remote = 'configured';
            }
        }
    }

    // ── Build result ──
    const result: StatusResult = {
        ok: assessOk(readiness),
        action: 'status',
        workspace,
        readiness,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        activeTarget: activeTarget ?? undefined,
        ...(toolchainSummary ? { toolchain: toolchainSummary } : {}),
    };

    // Remote summary
    if (activeTarget && activeTarget.runAt === 'remote') {
        result.remote = buildRemoteStatusSummary(remoteConfig, syncConfig);
    }

    // Sync summary
    if (syncConfig.enabled) {
        result.sync = {
            enabled: true,
            server: syncServer ? { id: syncServer.id, name: syncServer.name, host: syncServer.host, username: syncServer.username, port: syncServer.port, authMode: syncServer.authMode } : undefined,
            remotePath: syncConfig.selectedServer ? (syncConfig.remotePaths[syncConfig.selectedServer] || undefined) : undefined,
        };
    }

    // Runtime
    result.runtime = buildRuntimeState(workspace, activeTarget, diagnostics, readiness);
    if (!readiness.runtime) {
        // buildRuntimeState only sets readiness.runtime on error ('unknown');
        // normal path: derive from process state
        readiness.runtime = result.runtime.running ? 'ready' : 'not-selected';
    }

    // Next action — running process takes priority, then first diagnostic fix, then default to build
    if (result.runtime?.running) {
        result.nextAction = 'forja stop';
    } else {
        const firstFix = diagnostics.find(d => d.fix)?.fix;
        const hasErrors = diagnostics.some(d => d.level === 'error');
        result.nextAction = firstFix || (hasErrors ? undefined : 'forja build');
    }

    return result;
}

function extractVsVersion(vsPath: string): string | undefined {
    const m = vsPath.match(/(2022|2019|2017)/);
    if (m) { return m[1]; }
    const n = vsPath.match(/\\(\d{2})\\/);
    if (n) {
        const v = parseInt(n[1], 10);
        if (v >= 18) { return '2026'; }
        if (v >= 17) { return '2022'; }
        if (v === 16) { return '2019'; }
        if (v === 15) { return '2017'; }
    }
    return undefined;
}

function buildToolchainSummary(target: ActiveTarget, qtConfig: QtSettings, sdkConfig: SdkSettings): ToolchainSummary {
    const summary: ToolchainSummary = {};
    if (target.kind === 'qt') {
        if (qtConfig.qtPath) {
            const m = qtConfig.qtPath.match(/(\d+\.\d+\.\d+)/);
            summary.qt = { path: qtConfig.qtPath, version: m ? m[1] : undefined };
        }
        if (qtConfig.vsInstall) { summary.vs = { path: qtConfig.vsInstall, version: extractVsVersion(qtConfig.vsInstall) }; }
        if (qtConfig.jomPath) { summary.jom = qtConfig.jomPath; }
        if (process.platform !== 'win32') {
            summary.make = !!detectMake();
        }
    } else {
        if (process.platform === 'win32') {
            if (sdkConfig.vsInstall) { summary.vs = { path: sdkConfig.vsInstall, version: extractVsVersion(sdkConfig.vsInstall) }; }
        } else {
            // On POSIX, SDK uses make, not VS
            summary.make = !!detectMake();
        }
    }
    return summary;
}

function assessToolchainReadiness(summary: ToolchainSummary, target: ActiveTarget, diagnostics: Diagnostic[], qtPath?: string): ReadinessState {
    if (target.kind === 'qt') {
        let qtOk = true;
        if (!summary.qt?.path) {
            qtOk = false;
            const pathSuffix = qtPath ? `: ${qtPath}` : '';
            diagnostics.push({
                level: 'error',
                message: `${T('qtNotFound')}${pathSuffix}`,
                hint: T('qtReconfigure'),
                fix: 'forja list env qt',
                params: qtPath ? { path: qtPath } : undefined,
            });
        }
        // Platform-specific requirements — check all tools even if Qt is missing
        if (process.platform === 'win32') {
            // Windows Qt requires VS
            if (!summary.vs?.path) {
                diagnostics.push({
                    level: 'error',
                    message: T('vsNotFoundDetail'),
                    hint: T('installVs'),
                    fix: 'forja list env vs',
                });
            }
            // jom is optional but recommended on Windows
            if (!summary.jom) {
                diagnostics.push({
                    level: 'warning',
                    message: T('jomNotFound'),
                    fix: 'forja list env qt',
                });
            }
            if (!qtOk || !summary.vs?.path) { return 'missing'; }
        } else {
            // POSIX Qt requires make
            if (!summary.make) {
                diagnostics.push({
                    level: 'error',
                    message: T('makeNotFound'),
                    hint: T('installBuildEssential'),
                    fix: 'forja doctor',
                });
                return 'missing';
            }
        }
        return 'ready';
    }
    // SDK
    if (process.platform === 'win32') {
        // On Windows, SDK requires VS
        if (!summary.vs?.path) {
            diagnostics.push({
                level: 'error',
                message: T('vsNotFound'),
                hint: T('installVsSdk'),
                fix: 'forja list env vs',
            });
            return 'missing';
        }
    } else {
        // On POSIX, SDK requires make
        if (!summary.make) {
            diagnostics.push({
                level: 'error',
                message: T('makeNotFound'),
                hint: T('installBuildEssential'),
                fix: 'forja doctor',
            });
            return 'missing';
        }
    }
    return 'ready';
}

function buildRemoteStatusSummary(remoteConfig: RemoteSettings, syncConfig: SyncSettings): RemoteStatusSummary {
    // Prefer remote.selectedServer, fallback to sync.selectedServer
    const serverId = remoteConfig.selectedServer || syncConfig.selectedServer;
    const server = serverId ? getServerById(serverId) : null;
    const remotePath = serverId ? (remoteConfig.remotePaths[serverId] || syncConfig.remotePaths[serverId]) : undefined;
    return {
        runAt: 'remote',
        server: server ? { id: server.id, name: server.name, host: server.host } : undefined,
        remotePath: remotePath || undefined,
        remoteForjaBin: remoteConfig.remoteForjaBin || undefined,
        workspaceMode: remoteConfig.workspaceMode,
    };
}

function buildRuntimeState(workspace: string, target: ActiveTarget | null, diagnostics: Diagnostic[], readiness: Readiness): RuntimeState {
    // Read local run state from the Qt localState file
    if (!target) {
        return { running: false, runAt: 'local' };
    }
    try {
        const state = readRunState(workspace);
        const status = resolveRunProcessStatus(state);
        if (status.running && state) {
            return {
                running: true,
                pid: state.pid,
                executablePath: state.executablePath,
                logFile: state.logFile,
                runAt: target.runAt,
            };
        }
    } catch (e) {
        // Only ignore expected errors (file not found); surface unexpected failures
        if (e instanceof Error && !('code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT')) {
            diagnostics.push({
                level: 'warning',
                message: `${T('sts.failedToReadRunState')}: ${e instanceof Error ? e.message : String(e)}`,
            });
            readiness.runtime = 'unknown';
            return { running: false, runAt: target.runAt };
        }
    }
    return { running: false, runAt: target.runAt };
}

function assessOk(readiness: Readiness): boolean {
    // sync/remote=not-selected are OK; sync issues don't block local builds,
    // runtime is also excluded: process state doesn't affect build readiness.
    if (readiness.target === 'blocked' || readiness.target === 'missing' || readiness.target === 'not-selected') { return false; }
    if (readiness.toolchain === 'blocked' || readiness.toolchain === 'missing' || readiness.toolchain === 'unknown') { return false; }
    if (readiness.remote === 'blocked' || readiness.remote === 'missing') { return false; }
    return true;
}

// ── Text output ──

export function formatStatusText(result: StatusResult, locale: Locale): string {
    const lines: string[] = [T('sts.forjaStatus')];
    if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }
    if (result.activeTarget) {
        const t = result.activeTarget;
        lines.push(`${T('target')}${t.kind} ${t.project} ${t.mode} ${t.arch} ${t.runAt}`);
    }
    const r = result.readiness;
    const parts: string[] = [];
    if (r.target) { parts.push(`${T('readinessTarget')}=${readinessText(r.target, locale)}`); }
    if (r.toolchain) { parts.push(`${T('readinessToolchain')}=${readinessText(r.toolchain, locale)}`); }
    if (r.sync) { parts.push(`${T('readinessSync')}=${readinessText(r.sync, locale)}`); }
    if (r.remote) { parts.push(`${T('readinessRemote')}=${readinessText(r.remote, locale)}`); }
    if (r.runtime) { parts.push(`${T('readinessRuntime')}=${readinessText(r.runtime, locale)}`); }
    if (parts.length > 0) { lines.push(`${T('readiness')}${parts.join('  ')}`); }

    if (result.toolchain) {
        const tc = result.toolchain;
        const tcParts: string[] = [];
        if (tc.qt) { tcParts.push(`Qt ${tc.qt.version || shortPath(tc.qt.path)}`); }
        if (tc.vs) { tcParts.push(`VS ${tc.vs.version || shortPath(tc.vs.path)}`); }
        if (tc.jom) { tcParts.push('jom'); }
        if (tc.make) { tcParts.push('make'); }
        if (tcParts.length > 0) { lines.push(`${T('toolchainLabel')}${tcParts.join(', ')}`); }
    }

    if (result.remote) {
        const rem = result.remote;
        const remParts: string[] = [];
        if (rem.server) { remParts.push(`${rem.server.name} (${rem.server.host})`); }
        if (rem.remoteForjaBin) { remParts.push(`${T('forjaBin')}${rem.remoteForjaBin}`); }
        if (remParts.length > 0) { lines.push(`${T('remoteLabel')}${remParts.join(', ')}`); }
        if (rem.workspaceMode) { lines.push(`${T('workspaceMode')}${rem.workspaceMode}`); }
    }

    if (result.sync) {
        const s = result.sync;
        if (s.enabled) {
            if (s.server) {
                lines.push(`${T('syncLabel')}${T('enabledStatus')} → ${s.server.username}@${s.server.host}:${s.server.port} → ${s.remotePath || ''} (${s.server.authMode})`);
            } else {
                lines.push(`${T('syncLabel')}${T('enabledStatus')} (${T('sts.syncServerMissing')})`);
            }
        }
    }

    if (result.runtime) {
        if (result.runtime.running) {
            lines.push(`${T('runtimeLabel')}${T('running')} (${T('pid')}${result.runtime.pid})`);
            if (result.runtime.executablePath) { lines.push(`  ${T('executable')}${result.runtime.executablePath}`); }
            if (result.runtime.logFile) { lines.push(`  ${T('log')}${result.runtime.logFile}`); }
        } else {
            lines.push(`${T('runtimeLabel')}${T('notRunning')}`);
        }
    }

    if (result.diagnostics) {
        for (const d of result.diagnostics) {
            const prefix = T(d.level);
            lines.push(`${prefix}: ${d.message}`);
            if (d.hint) { lines.push(`  ${T('hint')}${d.hint}`); }
        }
    }

    if (result.nextAction) {
        lines.push(T('next'));
        lines.push(`  ${result.nextAction}`);
    }

    return lines.join('\n');
}

function shortPath(p: string): string {
    return p.replace(/\\/g, '/').split('/').pop() || p;
}
