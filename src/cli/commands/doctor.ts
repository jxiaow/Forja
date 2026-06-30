/**
 * `forja doctor` — deep diagnostics and recovery.
 * Output format follows v2 spec: DoctorResult interface.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getActiveTarget } from './activeTarget';
import { loadQtSettings, loadSdkSettings, loadSyncSettings, loadRemoteSettings } from '../../core/settingsIO';
import { listProjectConfigs } from '../../core/settingsIO';
import { listSyncStates } from '../../core/syncState';
import { getServerById } from '../../core/serverStore';
import { Diagnostic, CheckResult, CheckStatus, CommandPlan, diag, Locale, T } from './types';
import { executeRemoteRestore } from '../../remote/core/restore';
import { executeRemoteCleanUntracked } from '../../remote/core/cleanUntracked';
import { createSshRunner, createScpUploader, remoteCommand } from '../../remote/core/shell';
import { resolveRemoteConfig, resolveRemoteActionPath } from '../../remote/core/config';
import { executeRemoteBootstrap, findBootstrapArtifact, findPackageRoot } from '../../remote/core/bootstrap';
import { executeRemoteReleaseLock } from '../../remote/core/lock';
import { buildRemoteRepoDirSetup } from '../../remote/core/repoPath';
import { detectMake } from '../../sdk/cli/envDetector';

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
        'restore': T('doctorCheckRestore'),
        'reset': T('doctorCheckReset'),
        'clean-untracked': T('doctorCheckCleanUntracked'),
    };

    const actionMap: Record<string, string> = {
        'check': T('doctorActionCheck'),
        'fix': T('doctorActionFix'),
        'unlock': T('doctorActionUnlock'),
        'restore': T('doctorActionRestore'),
        'reset': T('doctorActionReset'),
        'clean-untracked': T('doctorActionCleanUntracked'),
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

export type DoctorAction = 'check' | 'fix' | 'unlock' | 'restore' | 'reset' | 'clean-untracked';

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
    force?: boolean;
    plan?: boolean;
    restore?: { repo: string; paths: string[] };
    reset?: { repo: string; paths: string[] };
    cleanUntracked?: { repo: string; paths: string[]; recursive?: boolean };
} = {}): Promise<DoctorResult> {
    const checks: CheckResult[] = [];
    const diagnostics: Diagnostic[] = [];
    const activeTarget = getActiveTarget(workspace);
    const isRemote = options.remote || (activeTarget?.runAt === 'remote');

    let doctorAction: DoctorAction = 'check';
    if (options.fix) { doctorAction = 'fix'; }
    else if (options.unlock) { doctorAction = 'unlock'; }
    else if (options.restore) { doctorAction = 'restore'; }
    else if (options.reset) { doctorAction = 'reset'; }
    else if (options.cleanUntracked) { doctorAction = 'clean-untracked'; }

    // ── Target check ──
    if (activeTarget) {
        // Handle absolute paths correctly
        const projectPath = path.isAbsolute(activeTarget.project)
            ? activeTarget.project
            : path.join(workspace, activeTarget.project);
        if (fs.existsSync(projectPath)) {
            checks.push(check('target', 'ready', `${T('doctorActiveTarget')}: ${activeTarget.kind} ${activeTarget.project}`));
        } else {
            checks.push(check('target', 'blocked', `${T('doctorProjectMissing')}: ${activeTarget.project}`,
                [diag('error', `${T('doctorProjectMissing')}: ${activeTarget.project}`)],
                'forja list targets'));
            diagnostics.push(diag('error', `${T('doctorProjectMissing')}: ${activeTarget.project}`));
        }
    } else {
        checks.push(check('target', 'warning', T('doctorNoTarget'),
            [diag('warning', T('doctorNoTarget'))],
            'forja list targets'));
        diagnostics.push(diag('warning', T('doctorNoTarget')));
    }

    // ── Toolchain checks ──
    if (activeTarget?.kind === 'qt' || !activeTarget) {
        const qt = loadQtSettings(workspace);
        if (qt.qtPath && fs.existsSync(qt.qtPath)) {
            checks.push(check('toolchain-qt', 'ready', `Qt: ${qt.qtPath}`));
        } else if (qt.qtPath) {
            checks.push(check('toolchain-qt', 'blocked', `${T('doctorQtInvalid')}: ${qt.qtPath}`,
                [diag('error', `Qt not found at configured path: ${qt.qtPath}`)],
                'forja list env'));
            diagnostics.push(diag('error', `Qt not found at configured path: ${qt.qtPath}`));
        } else {
            checks.push(check('toolchain-qt', 'warning', T('doctorQtNotConfigured'),
                [diag('warning', T('doctorQtNotConfigured'))],
                'forja use qt --qt-path <path>'));
        }

        // Platform-specific toolchain checks
        if (process.platform === 'win32') {
            // Windows: check VS and jom
            if (qt.vsInstall && fs.existsSync(qt.vsInstall)) {
                checks.push(check('toolchain-vs', 'ready', `VS: ${qt.vsInstall}`));
            } else if (qt.vsInstall) {
                checks.push(check('toolchain-vs', 'blocked', `${T('doctorVsInvalid')}: ${qt.vsInstall}`,
                    [diag('error', `VS dev environment not found: ${qt.vsInstall}`)]));
                diagnostics.push(diag('error', `VS dev environment not found: ${qt.vsInstall}`));
            } else {
                checks.push(check('toolchain-vs', 'warning', T('doctorVsNotConfigured'),
                    [diag('warning', T('doctorVsNotConfigured'))]));
            }
            if (qt.jomPath) {
                if (fs.existsSync(qt.jomPath)) {
                    checks.push(check('toolchain-jom', 'ready', `jom: ${qt.jomPath}`));
                } else {
                    checks.push(check('toolchain-jom', 'warning', `${T('doctorJomInvalid')}: ${qt.jomPath}`,
                        [diag('warning', `jom not found at: ${qt.jomPath}`)]));
                }
            }
        } else {
            // POSIX: check make
            const makePath = detectMake();
            if (makePath) {
                checks.push(check('toolchain-make', 'ready', `make: ${makePath}`));
            } else {
                checks.push(check('toolchain-make', 'blocked', T('doctorMakeNotFound'),
                    [diag('error', T('doctorMakeNotFound'))]));
                diagnostics.push(diag('error', T('doctorMakeNotFound')));
            }
        }
    }

    if (activeTarget?.kind === 'sdk' || !activeTarget) {
        const sdk = loadSdkSettings(workspace);
        // Platform-specific toolchain checks for SDK
        if (process.platform === 'win32') {
            // Windows: check VS
            if (sdk.vsInstall && fs.existsSync(sdk.vsInstall)) {
                checks.push(check('toolchain-vs', 'ready', `VS: ${sdk.vsInstall}`));
            } else if (sdk.vsInstall) {
                checks.push(check('toolchain-vs', 'blocked', `${T('doctorVsInvalid')}: ${sdk.vsInstall}`,
                    [diag('error', `VS dev environment not found: ${sdk.vsInstall}`)]));
            }
        } else {
            // POSIX: check make
            const makePath = detectMake();
            if (makePath) {
                checks.push(check('toolchain-make', 'ready', `make: ${makePath}`));
            } else {
                checks.push(check('toolchain-make', 'blocked', T('doctorMakeNotFound'),
                    [diag('error', T('doctorMakeNotFound'))]));
                diagnostics.push(diag('error', T('doctorMakeNotFound')));
            }
        }
    }

    // ── Sync check ──
    const sync = loadSyncSettings(workspace);
    if (sync.selectedServer) {
        const server = getServerById(sync.selectedServer);
        if (server) {
            const remotePath = sync.remotePaths[sync.selectedServer];
            if (remotePath) {
                checks.push(check('sync', 'ready', `${T('readinessSync')}: ${server.name}:${remotePath}`));
            } else {
                checks.push(check('sync', 'blocked', T('doctorSyncRemote'),
                    [diag('warning', T('doctorSyncRemote'))],
                    'forja use sync --server <name> --remote-path <path>'));
            }
        } else {
            checks.push(check('sync', 'blocked', `${T('doctorSyncDeleted')}: ${sync.selectedServer}`,
                [diag('error', `Sync server "${sync.selectedServer}" does not exist`)],
                'forja list servers'));
        }
    } else {
        checks.push(check('sync', 'skipped', T('doctorSyncNotConfigured')));
    }

    // ── Remote checks ──
    if (isRemote) {
        const remote = loadRemoteSettings(workspace);
        // Use resolveRemoteConfig for consistent remote config resolution
        const resolvedRemote = resolveRemoteConfig(workspace, options.server);
        const server = resolvedRemote.config?.server || null;

        if (!server) {
            checks.push(check('remote', 'blocked', T('doctorNoServer'),
                [diag('error', T('doctorNoServer'))],
                'forja list servers'));
            diagnostics.push(diag('error', T('doctorNoServer')));
        } else {
            checks.push(check('remote', 'ready', `Server: ${server.name} (${server.host})`));
            if (remote.remoteForjaBin) {
                checks.push(check('remote-forja', 'ready', `Remote Forja: ${remote.remoteForjaBin}`));
            } else if (doctorAction !== 'fix') {
                // Only add blocked check when not in fix mode — fix mode will resolve this
                checks.push(check('remote-forja', 'blocked', T('doctorForjaBinNotConfigured'),
                    [diag('error', T('doctorForjaBinNotConfigured'))],
                    'forja doctor fix --remote'));
                diagnostics.push(diag('error', T('doctorForjaBinNotConfigured')));
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
                    [diag('warning', `${stale.length} stale config file(s) would be removed`)],
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
                diagnostics.push(diag('error', `Cleanup errors: ${errors.join('; ')}`));
                checks.push(check('cleanup', 'blocked', `Cleanup partially failed: ${errors.length} error(s)`));
            } else {
                checks.push(check('cleanup', 'ready', removed > 0 ? `Cleaned ${removed} stale config(s)` : T('doctorNoStaleConfigs')));
            }
        }

        // Remote fix: bootstrap/deploy remote Forja bin
        if (options.remote) {
            const resolved = resolveRemoteConfig(workspace, options.server);
            if (!resolved.config) {
                for (const d of resolved.diagnostics) {
                    diagnostics.push(diag('error', d.message));
                }
                checks.push(check('remote', 'blocked', T('doctorRemoteNotConfigured')));
            } else {
                const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
                const runner = createSshRunner(resolved.config.server, password);
                const uploader = createScpUploader(resolved.config.server, password);

                if (options.plan) {
                    checks.push(check('remote-forja', 'warning', 'Would deploy/update remote Forja bin',
                        [diag('warning', 'Remote Forja bin would be deployed')]));
                    if (!planResult) {
                        planResult = { mode: 'dryRun' };
                    }
                    planResult.willRun = ['bootstrap remote Forja bin'];
                } else {
                    const artifactRoot = findPackageRoot(__dirname) || path.resolve(__dirname, '..', '..', '..');
                    const artifact = findBootstrapArtifact(artifactRoot);
                    if (!artifact.ok) {
                        for (const d of artifact.diagnostics) {
                            diagnostics.push(diag('error', d.message));
                        }
                        checks.push(check('remote-forja', 'blocked', 'Bootstrap artifact not available'));
                    } else {
                        const bootstrapResult = await executeRemoteBootstrap({ artifact, runner, uploader });
                        if (bootstrapResult.ok) {
                            changed.push(`remote.forjaBin(${bootstrapResult.version})`);
                            checks.push(check('remote-forja', 'ready', `Remote Forja deployed: ${bootstrapResult.version}`));
                        } else {
                            for (const d of bootstrapResult.diagnostics) {
                                diagnostics.push(diag(d.level, d.message));
                            }
                            checks.push(check('remote-forja', 'blocked', 'Remote Forja deploy failed'));
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
            diagnostics.push(diag('error', T('doctorRemoteNotConfigured')));
            checks.push(check('unlock', 'blocked', T('doctorRemoteNotConfigured')));
        } else {
            const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.config.server, password);
            const remotePath = resolveRemoteActionPath(workspace, resolved.config.remotePath);
            const releaseResult = await executeRemoteReleaseLock({
                remotePath, lockId: options.unlock, runner,
            });
            if (releaseResult.ok) {
                changed.push(`lock-${options.unlock}`);
                checks.push(check('unlock', 'ready', `${T('doctorLockReleased')}: ${options.unlock}`));
            } else {
                for (const d of releaseResult.diagnostics) {
                    diagnostics.push(diag(d.level, d.message));
                }
                checks.push(check('unlock', 'blocked', T('doctorLockFailed')));
            }
        }
    }

    // ── Destructive remote actions ──
    if (doctorAction === 'restore' || doctorAction === 'reset' || doctorAction === 'clean-untracked') {
        const resolved = resolveRemoteConfig(workspace, options.server);
        if (!resolved.config) {
            diagnostics.push(diag('error', T('doctorRemoteNotConfigured')));
            checks.push(check('remote', 'blocked', T('doctorRemoteNotConfigured')));
        } else {
            const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.config.server, password);
            const remotePath = resolveRemoteActionPath(workspace, resolved.config.remotePath);
            if (doctorAction === 'restore' && options.restore) {
                const result = await executeRemoteRestore({
                    remotePath, repo: options.restore.repo, paths: options.restore.paths, runner,
                });
                if (result.ok) {
                    changed.push(`restore.${options.restore.repo}(${result.restored.length} paths)`);
                    checks.push(check('restore', 'ready', `${T('doctorRestored')} ${result.restored.length} ${T('paths')} ${options.restore.repo}`));
                } else {
                    for (const d of result.diagnostics) {
                        diagnostics.push(diag(d.level, d.message));
                    }
                    checks.push(check('restore', 'blocked', T('doctorRestoreFailed')));
                }
            } else if (doctorAction === 'reset' && options.reset) {
                const pathArgs = remoteCommand(options.reset.paths);
                const command = buildRemoteRepoDirSetup(remotePath, options.reset.repo, true) + ' cd "$repo_dir" && git reset --hard HEAD -- ' + pathArgs;
                const executed = await runner.run(command, 30000);
                if (executed.exitCode !== 0) {
                    diagnostics.push(diag('error', executed.stderr.trim() || 'Remote reset failed'));
                    checks.push(check('reset', 'blocked', T('doctorResetFailed')));
                } else {
                    changed.push(`reset.${options.reset.repo}(${options.reset.paths.length} paths)`);
                    checks.push(check('reset', 'ready', `${T('doctorResetDone')} ${options.reset.paths.length} ${T('paths')} ${options.reset.repo}`));
                }
            } else if (doctorAction === 'clean-untracked' && options.cleanUntracked) {
                const result = await executeRemoteCleanUntracked({
                    remotePath, repo: options.cleanUntracked.repo, paths: options.cleanUntracked.paths,
                    recursive: options.cleanUntracked.recursive ?? false, runner,
                });
                if (result.ok) {
                    changed.push(`clean-untracked.${options.cleanUntracked.repo}(${result.cleaned.length} paths)`);
                    checks.push(check('clean-untracked', 'ready', `${T('doctorCleanDone')} ${result.cleaned.length} ${T('paths')} ${options.cleanUntracked.repo}`));
                } else {
                    for (const d of result.diagnostics) {
                        diagnostics.push(diag(d.level, d.message));
                    }
                    checks.push(check('clean-untracked', 'blocked', T('doctorCleanFailed')));
                }
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
    if (hasBlocked) { nextAction = 'forja doctor fix'; }
    else if (!activeTarget) { nextAction = 'forja list targets'; }
    else { nextAction = 'forja status'; }

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
