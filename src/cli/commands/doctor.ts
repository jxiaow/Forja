/**
 * `forja doctor` — deep diagnostics and recovery.
 * Output format follows v2 spec: DoctorResult interface.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getActiveTarget } from './activeTarget';
import { loadRemoteSettings } from '../../core/settingsIO';
import { listProjectConfigs } from '../../core/settingsIO';
import { resolveWorkroot } from '../../core/workspaceStore';
import { listSyncStates } from '../../core/syncState';
import { getServerById } from '../../core/serverStore';
import { Diagnostic, CheckResult, CheckStatus, CommandPlan, diag, Locale, T } from './types';
import { createSshRunner, createScpUploader } from '../../remote/core/shell';
import { resolveRemoteConfig, resolveRemoteActionPath } from '../../remote/core/config';
import { executeRemoteBootstrap, findBootstrapArtifact, findPackageRoot } from '../../remote/core/bootstrap';
import { executeRemoteReleaseLock } from '../../remote/core/lock';
import { detectMake } from '../../cpp/cli/envDetector';
import { setSilent } from '../../core/loggerBase';
import { ServerConfig } from '../../core/serverStore';

function resolveSshPassword(server: ServerConfig): string | null {
    return server.password || process.env.FORJA_SSH_PASSWORD || null;
}

export function formatDoctorText(result: DoctorResult, locale: Locale): string {
    const lines: string[] = [];
    const statusIcon: Record<CheckStatus, string> = {
        ready: '✓',
        blocked: '✗',
        warning: '⚠',
        skipped: '–',
        unknown: '?',
    };

    const checkNameMap: Record<string, string> = {
        'target': T('doctorCheckTarget'),
        'toolchain-qt': T('doctorCheckToolchainQt'),
        'toolchain-vs': T('doctorCheckToolchainVs'),
        'toolchain-jom': T('doctorCheckToolchainJom'),
        'toolchain-make': T('doctorCheckToolchainMake'),
        'sync': T('doctorCheckSync'),
        'remote': T('doctorCheckRemote'),
        'remote-forja': T('doctorCheckRemoteForja'),
        'cleanup': T('doctorCheckCleanup'),
        'unlock': T('doctorCheckUnlock'),
    };

    const actionMap: Record<string, string> = {
        'check': T('doctorActionCheck'),
        'fix': T('doctorActionFix'),
        'unlock': T('doctorActionUnlock'),
    };

    lines.push(`${T('doctor')} ${actionMap[result.doctorAction] || result.doctorAction}`);
    if (result.workspace) { lines.push(`${T('workspace')} ${result.workspace}`); }

    if (result.checks && result.checks.length > 0) {
        lines.push('');
        for (const c of result.checks) {
            const icon = statusIcon[c.status] || '?';
            const name = checkNameMap[c.name] || c.name;
            lines.push(`  ${icon} ${name}: ${c.message || c.status}`);
            if (c.diagnostics) {
                for (const d of c.diagnostics) {
                    if (d.level === 'error' || d.level === 'warning') {
                        lines.push(`      ${T(d.level)}: ${d.message}`);
                    }
                }
            }
        }
    }

    if (result.plan) {
        lines.push('');
        lines.push(T('planDryRun'));
        if (result.plan.willWrite?.length) {
            lines.push(`  ${T('wouldWrite')}`);
            for (const f of result.plan.willWrite) { lines.push(`    ${f}`); }
        }
        if (result.plan.willRun?.length) {
            lines.push(`  ${T('wouldRun')}`);
            for (const c of result.plan.willRun) { lines.push(`    ${c}`); }
        }
        if (result.plan.commands?.length) {
            lines.push(`  ${T('commands')}`);
            for (const c of result.plan.commands) { lines.push(`    ${c}`); }
        }
    }

    if (result.changed && result.changed.length > 0) {
        lines.push('');
        lines.push(`${T('changed')}${result.changed.join(', ')}`);
    }

    if (result.diagnostics && result.diagnostics.length > 0) {
        lines.push('');
        for (const d of result.diagnostics) {
            if (d.level === 'error' || d.level === 'warning') {
                lines.push(`${T(d.level)}: ${d.message}`);
            }
        }
    }

    if (result.nextAction) {
        lines.push('');
        lines.push(T('next'));
        lines.push(`  ${result.nextAction}`);
    }
    return lines.join('\n');
}

export type DoctorAction = 'check' | 'fix' | 'unlock';

export interface DoctorResult {
    ok: boolean;
    action: 'doctor';
    doctorAction: DoctorAction;
    workspace?: string;
    checks?: CheckResult[];
    plan?: CommandPlan;
    changed?: string[];
    diagnostics?: Diagnostic[];
    nextAction?: string;
    [key: string]: unknown;
}

function check(name: string, status: CheckStatus, message?: string, diagnostics?: Diagnostic[], nextAction?: string): CheckResult {
    return { name, status, message, diagnostics, nextAction };
}

export async function runDoctor(workspace: string, options: {
    remote?: boolean;
    server?: string;
    fix?: boolean;
    unlock?: string;
    plan?: boolean;
} = {}): Promise<DoctorResult> {
    const checks: CheckResult[] = [];
    const diagnostics: Diagnostic[] = [];
    const activeTarget = getActiveTarget(workspace);
    const workroot = resolveWorkroot(workspace);
    const isRemote = options.remote || (activeTarget?.runAt === 'remote');

    let doctorAction: DoctorAction = 'check';
    if (options.fix) { doctorAction = 'fix'; }
    else if (options.unlock) { doctorAction = 'unlock'; }

    // ── Target check ──
    if (activeTarget) {
        // Handle absolute paths correctly
        const projectPath = path.isAbsolute(activeTarget.project)
            ? activeTarget.project
            : path.join(workroot || workspace, activeTarget.project);
        if (fs.existsSync(projectPath)) {
            checks.push(check('target', 'ready', `${T('doctorActiveTarget')}: ${activeTarget.project}`));
        } else {
            checks.push(check('target', 'blocked', `${T('doctorProjectMissing')}: ${activeTarget.project}`,
                [diag('error', `${T('doctorProjectMissing')}: ${activeTarget.project}`)],
                'forja list targets'));
        }
    } else {
        checks.push(check('target', 'warning', T('doctorNoTarget'),
            [diag('warning', T('doctorNoTarget'))],
            'forja list targets'));
    }

    // ── Toolchain checks ──
    const checkedToolchain = new Set<string>();
    if (activeTarget?.kind === 'qt' || !activeTarget) {
        // Use activeTarget toolchain fields (from workspaceStore) instead of old settingsIO
        const qtPath = activeTarget?.toolchain.qtPath;
        const vsInstall = activeTarget?.toolchain.vsInstall;
        const jomPath = activeTarget?.toolchain.jomPath;

        if (qtPath && fs.existsSync(qtPath)) {
            checks.push(check('toolchain-qt', 'ready', `Qt: ${qtPath}`));
        } else if (qtPath) {
            checks.push(check('toolchain-qt', 'blocked', `${T('doctorQtInvalid')}: ${qtPath}`,
                [diag('error', T('doctorQtNotFoundAtPath', [qtPath]))],
                'forja list env'));
        } else {
            checks.push(check('toolchain-qt', 'warning', T('doctorQtNotConfigured'),
                [diag('warning', T('doctorQtNotConfigured'))],
                'forja use target --qt <path>'));
        }

        // Platform-specific toolchain checks
        if (process.platform === 'win32') {
            checkedToolchain.add('toolchain-vs');
            // Windows: check VS and jom
            if (vsInstall && fs.existsSync(vsInstall)) {
                checks.push(check('toolchain-vs', 'ready', `VS: ${vsInstall}`));
            } else if (vsInstall) {
                checks.push(check('toolchain-vs', 'blocked', `${T('doctorVsInvalid')}: ${vsInstall}`,
                    [diag('error', T('doctorVsNotFoundAtInstall', [vsInstall]))]));
            } else {
                checks.push(check('toolchain-vs', 'warning', T('doctorVsNotConfigured'),
                    [diag('warning', T('doctorVsNotConfigured'))]));
            }
            if (jomPath) {
                if (fs.existsSync(jomPath)) {
                    checks.push(check('toolchain-jom', 'ready', `jom: ${jomPath}`));
                } else {
                    checks.push(check('toolchain-jom', 'warning', `${T('doctorJomInvalid')}: ${jomPath}`,
                        [diag('warning', T('doctorJomNotFoundAtPath', [jomPath]))]));
                }
            }
        } else {
            checkedToolchain.add('toolchain-make');
            // POSIX: check make
            setSilent(true);
            const makePath = detectMake();
            setSilent(false);
            if (makePath) {
                checks.push(check('toolchain-make', 'ready', `make: ${makePath}`));
            } else {
                checks.push(check('toolchain-make', 'blocked', T('doctorMakeNotFound'),
                    [diag('error', T('doctorMakeNotFound'))]));
            }
        }
    }

    if (activeTarget?.kind === 'cpp' || !activeTarget) {
        // Use activeTarget toolchain fields for C++
        const cppVsInstall = activeTarget?.toolchain.vsInstall;

        // Platform-specific toolchain checks for C++ (skip if already checked for Qt)
        if (process.platform === 'win32') {
            if (!checkedToolchain.has('toolchain-vs')) {
                // Windows: check VS
                if (cppVsInstall && fs.existsSync(cppVsInstall)) {
                    checks.push(check('toolchain-vs', 'ready', `VS: ${cppVsInstall}`));
                } else if (cppVsInstall) {
                    checks.push(check('toolchain-vs', 'blocked', `${T('doctorVsInvalid')}: ${cppVsInstall}`,
                        [diag('error', T('doctorVsNotFoundAtInstall', [cppVsInstall]))]));
                } else {
                    checks.push(check('toolchain-vs', 'warning', T('doctorVsNotConfigured'),
                        [diag('warning', T('doctorVsNotConfigured'))]));
                }
            }
        } else {
            if (!checkedToolchain.has('toolchain-make')) {
                // POSIX: check make
                setSilent(true);
                const makePath = detectMake();
                setSilent(false);
                if (makePath) {
                    checks.push(check('toolchain-make', 'ready', `make: ${makePath}`));
                } else {
                    checks.push(check('toolchain-make', 'blocked', T('doctorMakeNotFound'),
                        [diag('error', T('doctorMakeNotFound'))]));
                }
            }
        }
    }

    // ── Sync check ──
    const remote = loadRemoteSettings(workspace);
    if (remote.selectedServer) {
        const server = getServerById(remote.selectedServer);
        if (server) {
            const remotePath = remote.remotePaths[remote.selectedServer];
            if (remotePath) {
                checks.push(check('sync', 'ready', `${T('readinessSync')}: ${server.name}:${remotePath}`));
            } else {
                checks.push(check('sync', 'blocked', T('doctorSyncRemote'),
                    [diag('error', T('doctorSyncRemote'))],
                    'forja remote set'));
            }
        } else {
            checks.push(check('sync', 'blocked', `${T('doctorSyncDeleted')}: ${remote.selectedServer}`,
                [diag('error', T('doctorSyncServerNotExist', [remote.selectedServer]))],
                'forja server'));
        }
    } else {
        checks.push(check('sync', 'skipped', T('doctorSyncNotConfigured')));
    }

    // ── Remote checks ──
    if (isRemote) {
        // Use resolveRemoteConfig for consistent remote config resolution
        const resolvedRemote = resolveRemoteConfig(workspace, options.server);
        const server = resolvedRemote.config?.server || null;

        if (!server) {
            checks.push(check('remote', 'blocked', T('doctorNoServer'),
                [diag('error', T('doctorNoServer'))],
                'forja server'));
        } else {
            checks.push(check('remote', 'ready', `Server: ${server.name} (${server.host})`));
            if (remote.remoteForjaBin) {
                checks.push(check('remote-forja', 'ready', `Remote Forja: ${remote.remoteForjaBin}`));
            } else if (doctorAction !== 'fix') {
                // Only add blocked check when not in fix mode — fix mode will resolve this
                checks.push(check('remote-forja', 'blocked', T('doctorForjaBinNotConfigured'),
                    [diag('error', T('doctorForjaBinNotConfigured'))],
                    'forja doctor fix --remote'));
            }
        }
    }

    // ── Fix mode ──
    const changed: string[] = [];
    let planResult: CommandPlan | undefined;
    if (doctorAction === 'fix') {
        // Cleanup stale project configs and sync states
        const configs = listProjectConfigs();
        const syncStates = listSyncStates();
        const stale: Array<{ filePath: string; workspace: string; type: string }> = [];

        for (const config of configs) {
            if (!fs.existsSync(config.workspace)) {
                stale.push({ filePath: config.filePath, workspace: config.workspace, type: config.type || 'project' });
            }
        }
        for (const ss of syncStates) {
            if (!fs.existsSync(ss.workspace)) {
                stale.push({ filePath: ss.filePath, workspace: ss.workspace, type: 'sync' });
            }
        }

        if (options.plan) {
            if (stale.length > 0) {
                checks.push(check('cleanup', 'warning', `${T('doctorStaleConfigs')}: ${stale.length}`,
                    [diag('warning', T('doctorStaleConfigWouldRemove', [String(stale.length)]))],
                    'forja doctor fix'));
                planResult = {
                    mode: 'dryRun',
                    willWrite: stale.map(s => s.filePath),
                };
            } else {
                checks.push(check('cleanup', 'ready', T('doctorNoStaleConfigs')));
            }
        } else {
            let removed = 0;
            const errors: string[] = [];
            for (const s of stale) {
                try {
                    fs.unlinkSync(s.filePath);
                    removed++;
                } catch (e) {
                    errors.push(`${s.filePath}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            if (removed > 0) {
                changed.push(`cleanup.staleProjectSettings(${removed})`);
            }
            if (errors.length > 0) {
                checks.push(check('cleanup', 'blocked', T('doctorCleanupPartiallyFailed', [String(errors.length)]),
                    [diag('error', T('doctorCleanupErrors', [errors.join('; ')]))]));
            } else {
                checks.push(check('cleanup', 'ready', removed > 0 ? T('doctorCleanedStaleConfigs', [String(removed)]) : T('doctorNoStaleConfigs')));
            }
        }

        // Remote fix: bootstrap/deploy remote Forja bin
        if (options.remote) {
            const resolved = resolveRemoteConfig(workspace, options.server);
            if (!resolved.config) {
                checks.push(check('remote', 'blocked', T('doctorRemoteNotConfigured'),
                    resolved.diagnostics.map(d => diag('error', d.message))));
            } else {
                const password = resolveSshPassword(resolved.config.server);
                const runner = createSshRunner(resolved.config.server, password);
                const uploader = createScpUploader(resolved.config.server, password);

                if (options.plan) {
                    checks.push(check('remote-forja', 'warning', T('doctorWouldDeployForjaBin'),
                        [diag('warning', T('doctorWouldDeployForjaBinDetail'))]));
                    if (!planResult) {
                        planResult = { mode: 'dryRun' };
                    }
                    planResult.willRun = [T('doctorBootstrapForjaBin')];
                } else {
                    const artifactRoot = findPackageRoot(__dirname) || path.resolve(__dirname, '..', '..', '..');
                    const artifact = findBootstrapArtifact(artifactRoot);
                    if (!artifact.ok) {
                        checks.push(check('remote-forja', 'blocked', T('doctorBootstrapArtifactNotAvailable'),
                            artifact.diagnostics.map(d => diag('error', d.message))));
                    } else {
                        const bootstrapResult = await executeRemoteBootstrap({ artifact, runner, uploader });
                        if (bootstrapResult.ok) {
                            changed.push(`remote.forjaBin(${bootstrapResult.version})`);
                            const deployVer = bootstrapResult.version || 'unknown';
                            checks.push(check('remote-forja', 'ready', T('doctorRemoteForjaDeployed', [deployVer]) || `Remote Forja deployed: ${deployVer}`));
                        } else {
                            checks.push(check('remote-forja', 'blocked', T('doctorRemoteForjaDeployFailed'),
                                bootstrapResult.diagnostics.map(d => diag(d.level, d.message))));
                        }
                    }
                }
            }
        }
    }

    // ── Unlock ──
    if (doctorAction === 'unlock' && options.unlock) {
        const resolved = resolveRemoteConfig(workspace, options.server);
        if (!resolved.config) {
            checks.push(check('unlock', 'blocked', T('doctorRemoteNotConfigured'),
                [diag('error', T('doctorRemoteNotConfigured'))]));
        } else {
            const password = resolveSshPassword(resolved.config.server);
            const runner = createSshRunner(resolved.config.server, password);
            const remotePath = resolveRemoteActionPath(workspace, resolved.config.remotePath);
            const releaseResult = await executeRemoteReleaseLock({
                remotePath, lockId: options.unlock, runner,
            });
            if (releaseResult.ok) {
                changed.push(`lock-${options.unlock}`);
                checks.push(check('unlock', 'ready', `${T('doctorLockReleased')}: ${options.unlock}`));
            } else {
                checks.push(check('unlock', 'blocked', T('doctorLockFailed'),
                    releaseResult.diagnostics.map(d => diag(d.level, d.message))));
            }
        }
    }

    // Build diagnostics from checks
    for (const c of checks) {
        if (c.status === 'blocked' && c.diagnostics) {
            diagnostics.push(...c.diagnostics);
        }
    }

    const hasBlocked = checks.some(c => c.status === 'blocked');
    let nextAction: string | undefined = undefined;
    if (hasBlocked) {
        // Check if any blocked check is fixable
        const fixableChecks = ['cleanup', 'remote-forja'];
        const hasFixable = checks.some(c => c.status === 'blocked' && fixableChecks.includes(c.name));
        if (hasFixable) {
            nextAction = 'forja doctor fix';
        } else {
            // No fixable blocks — suggest the most relevant command based on what's blocked
            const targetBlocked = checks.find(c => c.name === 'target' && c.status === 'blocked');
            const syncBlocked = checks.find(c => c.name === 'sync' && c.status === 'blocked');
            const remoteBlocked = checks.find(c => c.name === 'remote' && c.status === 'blocked');
            if (targetBlocked) {
                nextAction = 'forja list targets';
            } else if (syncBlocked || remoteBlocked) {
                nextAction = 'forja remote set';
            } else {
                nextAction = 'forja use target';
            }
        }
    } else if (!activeTarget) {
        nextAction = 'forja list targets';
    } else {
        nextAction = 'forja status';
    }

    return {
        ok: !hasBlocked,
        action: 'doctor',
        doctorAction,
        workspace,
        checks,
        plan: planResult,
        changed: changed.length > 0 ? changed : undefined,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        nextAction,
    };
}
