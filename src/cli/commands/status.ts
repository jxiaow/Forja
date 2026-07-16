/**
 * `forja status` — lightweight read-only status and readiness.
 * No SSH probes, no full toolchain detection, no config writes.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    ForjaJsonResult, Diagnostic, Readiness, ReadinessState, ActiveTarget,
    RuntimeState, Locale, readinessText, readinessSymbol, T,
} from './types';
import { getActiveTarget } from './activeTarget';
import { collectTargetCandidates } from './candidates';
import {
    loadSyncSettings, loadRemoteSettings,
    getCorruptedConfigs, clearCorruptedConfigs,
    SyncSettings, RemoteSettings, CorruptedConfig,
} from '../../core/settingsIO';
import { resolveWorkroot as resolveWorkrootForStatus, loadWorkspaceConfig as loadWsConfig } from '../../core/workspaceStore';
import type { TargetProfile } from '../../core/workspaceStore';
import { readRunState, resolveRunProcessStatus } from '../../qt/shared/localState';
import { getServerById } from '../../core/serverStore';
import { resolveRemoteConfigFrom } from '../../remote/core/config';
import { detectMake } from '../../cpp/cli/envDetector';
import { validateMakefile } from '../../qt/shared/runtimeTarget';

export interface StatusResult extends ForjaJsonResult {
    action: 'status';
    readiness: Readiness;
    remote?: RemoteStatusSummary;
    sync?: SyncStatusSummary;
    runtime?: RuntimeState;
    nextAction?: string;
    choices?: Array<{ label: string; command: string; description: string }>;
}

interface ToolchainSummary {
    qt?: { version?: string };
    vs?: { version?: string };
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
                fix: 'forja use target',
                params: { file: corrupted.map((c: CorruptedConfig) => c.path).join(', '), detail: corrupted.map((c: CorruptedConfig) => c.detail).join('; ') },
            }],
            nextAction: 'forja use target',
        };
    }

    const activeTarget = getActiveTarget(workspace);
    const workroot = resolveWorkrootForStatus(workspace);
    const wsConfig = workroot ? loadWsConfig(workroot) : null;

    // ── Target readiness ──
    if (!activeTarget) {
        readiness.target = 'not-selected';
        if (!workroot) {
            diagnostics.push({
                level: 'warning',
                message: T('notInitialized'),
                fix: 'forja init',
            });
        } else {
            const hasAnyConfig = Object.keys(wsConfig!.targets).length > 0;
            if (hasAnyConfig) {
                const candidates = collectTargetCandidates(workspace);
                const qtCount = candidates.filter(c => c.kind === 'qt').length;
                const cppCount = candidates.filter(c => c.kind === 'cpp').length;
                if (qtCount > 0 || cppCount > 0) {
                    diagnostics.push({
                        level: 'info',
                        message: T('sts.targetsFound', [String(qtCount), String(cppCount)]),
                        fix: 'forja list targets',
                        params: { qtCount: String(qtCount), cppCount: String(cppCount) },
                    });
                } else {
                    diagnostics.push({
                        level: 'warning',
                        message: T('noActiveTarget'),
                        fix: 'forja use target',
                    });
                }
            } else {
                diagnostics.push({
                    level: 'warning',
                    message: T('noActiveTarget'),
                    fix: 'forja use target',
                });
            }
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
                    qtPath: activeTarget.toolchain.qtPath || '',
                    proFile: activeTarget.project,
                    target: activeTarget.toolchain.qmakeTarget || '',
                    qmakeArgs: wsConfig?.qtModulePrefs.qmakeArgs,
                });
                if (mfValidation.exists && !mfValidation.matches && mfValidation.mismatch) {
                    readiness.target = 'blocked';
                    const mismatchFields = mfValidation.mismatch;
                    const isConfigMismatch = mismatchFields.includes('mode') || mismatchFields.includes('arch');
                    const hasOtherMismatch = mismatchFields.some(f => f !== 'mode' && f !== 'arch');

                    let hint: string;
                    let fix: string;
                    if (isConfigMismatch && !hasOtherMismatch) {
                        // Only mode/arch mismatch — user can either change config or re-run qmake
                        hint = T('sts.makefileConfigMismatchHint');
                        fix = 'forja use target --mode <debug|release>';
                    } else {
                        // qtPath/project/target/qmakeArgs mismatch — need qmake
                        hint = T('sts.makefileMismatchHint');
                        fix = 'forja build qmake';
                    }

                    diagnostics.push({
                        level: 'warning',
                        message: `${T('sts.makefileMismatch')} (${mismatchFields.join(', ')})`,
                        hint,
                        fix,
                        params: { diff: mismatchFields.join(', ') },
                    });
                }
            }
        }
    }

    // ── Toolchain readiness ──
    let toolchainSummary: ToolchainSummary | undefined;
    if (!activeTarget) {
        const hasAnyToolchain = wsConfig ? Object.values(wsConfig.targets).some(t =>
            t.toolchain.qtPath || t.toolchain.vsInstall
        ) : false;
        readiness.toolchain = hasAnyToolchain ? 'configured' : 'unknown';
        if (!hasAnyToolchain) {
            diagnostics.push({
                level: 'warning',
                message: T('notInitialized'),
            });
        }
    } else {
        toolchainSummary = buildToolchainSummary(activeTarget);
        readiness.toolchain = assessToolchainReadiness(toolchainSummary, activeTarget, diagnostics);
    }

    // ── Sync readiness ──
    const syncServer = remoteConfig.selectedServer ? getServerById(remoteConfig.selectedServer) : null;
    if (!syncConfig.enabled) {
        readiness.sync = 'not-selected';
        if (activeTarget?.runAt === 'remote' && !remoteConfig.selectedServer) {
            diagnostics.push({
                level: 'warning',
                message: T('noSyncServer'),
                fix: 'forja remote set',
            });
        } else if (activeTarget?.runAt === 'remote' && remoteConfig.selectedServer) {
            diagnostics.push({
                level: 'warning',
                message: T('sts.syncNotEnabled'),
                fix: 'forja remote set',
            });
        }
        // local mode: no sync diagnostic — local execution doesn't need sync
    } else {
        if (!syncServer) {
            readiness.sync = 'blocked';
            diagnostics.push({
                level: 'error',
                message: T('sts.syncServerNotFound', [remoteConfig.selectedServer]),
                hint: T('serverDeleted'),
                fix: 'forja remote set',
                params: { server: remoteConfig.selectedServer },
            });
        } else {
            const remotePath = remoteConfig.remotePaths[remoteConfig.selectedServer];
            if (!remotePath) {
                readiness.sync = 'missing';
                diagnostics.push({
                    level: 'error',
                    message: `${T('remotePathNotConfigured')}: ${remoteConfig.selectedServer}`,
                    fix: 'forja remote set',
                    params: { server: remoteConfig.selectedServer },
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
                fix: 'forja remote set',
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
                const serverId = remoteConfig.selectedServer || '';
                diagnostics.push({
                    level: 'error',
                    message: serverId ? `${T('remotePathNotConfigured')}: ${serverId}` : T('remotePathNotConfigured'),
                    fix: 'forja remote set',
                    params: serverId ? { server: serverId } : undefined,
                });
                readiness.remote = 'missing';
            } else {
                readiness.remote = 'configured';
            }
        }
    }

    // ── Build result ──
    // Merge toolchain versions into activeTarget's toolchain
    let targetForOutput: TargetProfile | undefined;
    if (activeTarget) {
        targetForOutput = { ...activeTarget, toolchain: { ...activeTarget.toolchain } };
        if (toolchainSummary?.qt?.version) { targetForOutput.toolchain.qtVersion = toolchainSummary.qt.version; }
        if (toolchainSummary?.vs?.version) { targetForOutput.toolchain.vsVersion = toolchainSummary.vs.version; }
    }
    const result: StatusResult = {
        ok: assessOk(readiness),
        action: 'status',
        workspace,
        readiness,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        activeTarget: targetForOutput,
    };

    // Remote summary
    if (activeTarget && activeTarget.runAt === 'remote') {
        result.remote = buildRemoteStatusSummary(remoteConfig);
    }

    // Sync summary
    if (syncConfig.enabled) {
        result.sync = {
            enabled: true,
            server: syncServer ? { id: syncServer.id, name: syncServer.name, host: syncServer.host, username: syncServer.username, port: syncServer.port, authMode: syncServer.authMode } : undefined,
            remotePath: remoteConfig.selectedServer ? (remoteConfig.remotePaths[remoteConfig.selectedServer] || undefined) : undefined,
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
    } else if (!activeTarget && readiness.toolchain === 'unknown') {
        // Not initialized — AI should ask user to choose; text mode shows both options
        result.nextAction = undefined;
        result.choices = [
            { label: 'forja use target', command: 'forja use target', description: T('statusSetupLocal') },
            { label: 'forja remote set', command: 'forja remote set', description: T('statusSetupRemote') },
        ];
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

function buildToolchainSummary(target: TargetProfile): ToolchainSummary {
    const summary: ToolchainSummary = {};
    if (target.kind === 'qt') {
        if (target.toolchain.qtPath) {
            summary.qt = { version: target.toolchain.qtVersion || undefined };
        }
        if (target.toolchain.vsInstall) { summary.vs = { version: extractVsVersion(target.toolchain.vsInstall) }; }
        if (target.toolchain.jomPath) { summary.jom = target.toolchain.jomPath; }
        if (process.platform !== 'win32') {
            summary.make = !!detectMake();
        }
    } else {
        if (process.platform === 'win32') {
            if (target.toolchain.vsInstall) { summary.vs = { version: extractVsVersion(target.toolchain.vsInstall) }; }
        } else {
            summary.make = !!detectMake();
        }
    }
    return summary;
}

function assessToolchainReadiness(summary: ToolchainSummary, target: TargetProfile, diagnostics: Diagnostic[]): ReadinessState {
    if (target.kind === 'qt') {
        let qtOk = true;
        if (!target.toolchain.qtPath) {
            qtOk = false;
            diagnostics.push({
                level: 'error',
                message: T('qtNotFound'),
                hint: T('qtReconfigure'),
                fix: 'forja use target --qt <path>',
            });
        }
        // Platform-specific requirements — check all tools even if Qt is missing
        if (process.platform === 'win32') {
            // Windows Qt requires VS
            if (!target.toolchain.vsInstall) {
                diagnostics.push({
                    level: 'error',
                    message: T('vsNotFoundDetail'),
                    hint: T('installVs'),
                    fix: 'forja use target --vs <path>',
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
            if (!qtOk || !target.toolchain.vsInstall) { return 'missing'; }
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
        if (!target.toolchain.vsInstall) {
            diagnostics.push({
                level: 'error',
                message: T('vsNotFound'),
                hint: T('installVsSdk'),
                fix: 'forja use target --vs <path>',
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

function buildRemoteStatusSummary(remoteConfig: RemoteSettings): RemoteStatusSummary {
    const serverId = remoteConfig.selectedServer;
    const server = serverId ? getServerById(serverId) : null;
    const remotePath = serverId ? (remoteConfig.remotePaths[serverId]) : undefined;
    return {
        runAt: 'remote',
        server: server ? { id: server.id, name: server.name, host: server.host } : undefined,
        remotePath: remotePath || undefined,
        remoteForjaBin: remoteConfig.remoteForjaBin || undefined,
        workspaceMode: remoteConfig.workspaceMode,
    };
}

function buildRuntimeState(workspace: string, target: TargetProfile | null, diagnostics: Diagnostic[], readiness: Readiness): RuntimeState {
    // Read local run state from the Qt localState file
    if (!target) {
        return { running: false };
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
            return { running: false };
        }
    }
    return { running: false };
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
    const lines: string[] = [];
    const indent = '  ';

    // ── Title ──
    lines.push(T('sts.forjaStatus'));

    // ── Config section ──
    if (result.workspace) {
        lines.push(`${indent}${T('workspace')}  ${result.workspace}`);
    }
    if (result.activeTarget) {
        const t = result.activeTarget;
        lines.push(`${indent}${T('target')}  ${t.project}`);
        lines.push(`${indent}${T('setupSummaryModeArch')}  ${t.mode} | ${t.arch} | ${t.runAt}`);
        if (t.toolchain.qmakeTarget) { lines.push(`${indent}${T('init.qmakeTarget')}: ${t.toolchain.qmakeTarget}`); }
    }

    // ── Readiness sub-list ──
    const r = result.readiness;
    const readinessEntries: Array<{ label: string; state: ReadinessState }> = [];
    if (r.target) { readinessEntries.push({ label: T('readinessTarget'), state: r.target }); }
    if (r.toolchain) { readinessEntries.push({ label: T('readinessToolchain'), state: r.toolchain }); }
    if (r.sync) { readinessEntries.push({ label: T('readinessSync'), state: r.sync }); }
    if (r.remote) { readinessEntries.push({ label: T('readinessRemote'), state: r.remote }); }
    if (r.runtime) { readinessEntries.push({ label: T('readinessRuntime'), state: r.runtime }); }

    if (readinessEntries.length > 0) {
        lines.push(`${indent}${T('readiness')}`);
        for (const entry of readinessEntries) {
            const sym = readinessSymbol(entry.state);
            const text = readinessText(entry.state, locale);
            lines.push(`${indent}  ${sym} ${entry.label}:  ${text}`);
        }
    }

    // ── Toolchain ──
    if (result.activeTarget) {
        const t = result.activeTarget;
        const tcParts: string[] = [];
        if (t.toolchain.qtPath) {
            const ver = t.toolchain.qtVersion ? `${t.toolchain.qtVersion} ` : '';
            tcParts.push(`Qt ${ver}(${shortPath(t.toolchain.qtPath)})`);
        }
        if (t.toolchain.vsInstall) {
            const ver = t.toolchain.vsVersion ? `${t.toolchain.vsVersion} ` : '';
            tcParts.push(`VS ${ver}(${shortPath(t.toolchain.vsInstall)})`);
        }
        if (t.toolchain.jomPath) { tcParts.push('jom'); }
        if (tcParts.length > 0) { lines.push(`${indent}${T('toolchainLabel')}  ${tcParts.join(', ')}`); }
    }

    // ── Remote ──
    if (result.remote) {
        const rem = result.remote;
        const remParts: string[] = [];
        if (rem.server) { remParts.push(`${rem.server.name} (${rem.server.host})`); }
        if (rem.remoteForjaBin) { remParts.push(`${T('forjaBin')}${rem.remoteForjaBin}`); }
        if (remParts.length > 0) { lines.push(`${indent}${T('remoteLabel')}  ${remParts.join(', ')}`); }
        if (rem.workspaceMode) { lines.push(`${indent}${T('workspaceMode')}  ${rem.workspaceMode}`); }
    }

    // ── Sync ──
    if (result.sync) {
        const s = result.sync;
        if (s.enabled) {
            if (s.server) {
                lines.push(`${indent}${T('syncLabel')}  ${T('enabledStatus')} → ${s.server.username}@${s.server.host}:${s.server.port} → ${s.remotePath || ''} (${s.server.authMode})`);
            } else {
                lines.push(`${indent}${T('syncLabel')}  ${T('enabledStatus')} (${T('sts.syncServerMissing')})`);
            }
        }
    }

    // ── Runtime (only show when running — readiness section covers the not-running case) ──
    if (result.runtime?.running) {
        lines.push(`${indent}${T('runtimeLabel')}  ${T('running')} (${T('pid')}${result.runtime.pid})`);
        if (result.runtime.executablePath) { lines.push(`${indent}  ${T('executable')}  ${result.runtime.executablePath}`); }
        if (result.runtime.logFile) { lines.push(`${indent}  ${T('log')}  ${result.runtime.logFile}`); }
    }

    // ── Diagnostics (warnings/errors) ──
    if (result.diagnostics) {
        lines.push('');
        for (const d of result.diagnostics) {
            const icon = d.level === 'warning' ? '⚠' : d.level === 'error' ? '✗' : 'ℹ';
            lines.push(`${indent}${icon} ${d.message}`);
            if (d.hint) { lines.push(`${indent}  → ${d.hint}`); }
            if (d.fix) { lines.push(`${indent}  → ${d.fix}`); }
        }
    }

    // ── Next action ──
    if (result.nextAction) {
        lines.push('');
        lines.push(T('next'));
        lines.push(`${indent}  ${result.nextAction}`);
    } else if (!result.activeTarget && result.readiness?.toolchain === 'unknown') {
        lines.push('');
        lines.push(T('next'));
        lines.push(`${indent}  forja use target       (${T('statusSetupLocal')})`);
        lines.push(`${indent}  forja remote set       (${T('statusSetupRemote')})`);
    }

    return lines.join('\n');
}

function shortPath(p: string): string {
    return p.replace(/\\/g, '/').split('/').pop() || p;
}
