/**
 * `forja build` — build current active target.
 * Output format follows v2 spec: BuildResult interface.
 */
import * as path from 'path';
import * as fs from 'fs';
import { requireActiveTarget, stripJsonFlag } from './activeTarget';
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult, terminateExecutable } from '../../qt/shared/commandRunner';
import { resolveRuntimeTarget } from '../../qt/shared/runtimeTarget';
import { CliOptions } from '../../qt/cli/types';
import { createSdkPlan } from '../../sdk/shared/plan';
import { executeRemotePlan, buildRemoteShellCommand } from '../../remote/core/plan';
import { ActiveTarget, Diagnostic, diag, T } from './types';
import { loadRemoteSettings, resolveVsDevCmdPath } from '../../core/settingsIO';
import { resolveWorkroot, loadWorkspaceConfig } from '../../core/workspaceStore';
import { getServerById } from '../../core/serverStore';

export type BuildAction = 'default' | 'fresh' | 'qmake' | 'rcc';

export interface BuildResult {
    ok: boolean;
    action: 'build';
    buildAction: BuildAction;
    workspace?: string;
    activeTarget?: ActiveTarget;
    plan?: { mode: 'dryRun'; commands?: string[]; shellCommand?: string };
    durationMs?: number;
    exitCode?: number;
    errors?: string[];
    warningSummary?: { total: number; summary: string };
    logFile?: string;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}

function buildQtCliOptions(workspace: string, target: ActiveTarget, action: BuildAction, plan: boolean, qmakeArgs?: string): CliOptions {
    let qtAction: CliOptions['action'];
    switch (action) {
        case 'qmake': qtAction = 'qmake'; break;
        case 'rcc': qtAction = 'rcc'; break;
        default: qtAction = 'build'; break;
    }
    const vsDevShell = target.vsInstall ? resolveVsDevCmdPath(target.vsInstall) : null;
    return {
        action: qtAction,
        executionMode: plan ? 'dryRun' : 'execute',
        workspace,
        project: target.project,
        mode: target.mode,
        arch: target.arch,
        qtPath: target.qtPath || null,
        vsDevShell: vsDevShell,
        target: target.qmakeTarget || null,
        qmakeArgs: qmakeArgs || null,
        detach: false,
        saveLocal: false,
        json: false,
    };
}

export async function runBuild(workspace: string, buildAction: BuildAction, options: { plan?: boolean; json?: boolean; project?: string } = {}): Promise<BuildResult> {
    const wantsJson = options.json ?? false;
    let targetResult: ReturnType<typeof requireActiveTarget>;

    // If --project is provided (e.g., from remote bridge), construct target directly
    if (options.project) {
        const projectPath = options.project;
        const ext = path.extname(projectPath).toLowerCase();
        const basename = path.basename(projectPath);
        let kind: 'qt' | 'sdk';
        if (ext === '.pro') { kind = 'qt'; }
        else if (ext === '.sln' || basename.toLowerCase() === 'makefile' || basename.toLowerCase() === 'cmakelists.txt') { kind = 'sdk'; }
        else {
            return {
                ok: false, action: 'build', buildAction, workspace,
                diagnostics: [diag('error', `${T('cmd.cannotDetermineKind')}: ${projectPath}`)],
                nextAction: 'forja list targets',
            };
        }
        // Resolve to absolute for existence check, then store as relative for remote compatibility
        const absolutePath = path.isAbsolute(projectPath) ? projectPath : path.join(workspace, projectPath);
        if (!fs.existsSync(absolutePath)) {
            return {
                ok: false, action: 'build', buildAction, workspace,
                diagnostics: [diag('error', `${T('cmd.projectNotFound')}: ${projectPath}`)],
                nextAction: 'forja list targets',
            };
        }
        const relativeProject = path.isAbsolute(projectPath)
            ? path.relative(workspace, absolutePath).replace(/\\/g, '/')
            : projectPath;
        const earlyWorkroot = resolveWorkroot(workspace);
        const wsConfigEarly = earlyWorkroot ? loadWorkspaceConfig(earlyWorkroot) : null;
        const savedProfile = wsConfigEarly ? Object.values(wsConfigEarly.targets).find(t => t.kind === kind) : null;
        targetResult = {
            target: {
                kind,
                project: relativeProject,
                mode: savedProfile?.mode || 'debug',
                arch: savedProfile?.arch || (process.platform === 'win32' ? 'x86' : 'x64'),
                runAt: savedProfile?.runAt || 'local',
                qtPath: savedProfile?.toolchain.qtPath,
                vsInstall: savedProfile?.toolchain.vsInstall,
                jomPath: savedProfile?.toolchain.jomPath,
                qmakeTarget: savedProfile?.toolchain.qmakeTarget,
            },
        };
    } else {
        targetResult = requireActiveTarget(workspace);
    }

    if ('error' in targetResult) {
        return {
            ok: false,
            action: 'build',
            buildAction,
            workspace,
            diagnostics: [diag('error', targetResult.error)],
            nextAction: targetResult.nextAction,
        };
    }
    const target = targetResult.target;
    const earlyWsConfig = resolveWorkroot(workspace) ? loadWorkspaceConfig(resolveWorkroot(workspace)!) : null;
    const suppressedWarnings = earlyWsConfig?.qtModulePrefs.suppressedWarnings ?? [];

    // Print build header before execution (text mode only)
    if (!wantsJson && !options.plan) {
        if (target.runAt === 'remote') {
            const remote = loadRemoteSettings(workspace);
            const server = remote.selectedServer ? getServerById(remote.selectedServer) : null;
            console.log(`→ remote:${server?.name || remote.selectedServer}`);
        } else {
            console.log('→ local');
        }
        console.log(`  ${T('target')}${target.project}`);
        console.log(`  ${T('setupSummaryModeArch')}: ${target.mode} | ${target.arch}`);
        if (target.qmakeTarget) { console.log(`  ${T('init.qmakeTarget')}: ${target.qmakeTarget}`); }
        console.log();
    }

    // Validate project file exists
    const buildProjectPath = path.isAbsolute(target.project)
        ? target.project
        : path.join(workspace, target.project);
    if (!fs.existsSync(buildProjectPath)) {
        return {
            ok: false,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', `${T('cmd.targetProjectMissing')}: ${target.project}`)],
            nextAction: 'forja list targets',
        };
    }

    if ((buildAction === 'qmake' || buildAction === 'rcc') && target.kind === 'sdk') {
        return {
            ok: false,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', `${T('cmd.sdkNoQmakeRcc')} '${buildAction}'`)],
            nextAction: 'forja build',
        };
    }

    // rcc is not supported on remote targets
    if (buildAction === 'rcc' && target.runAt === 'remote') {
        return {
            ok: false,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', T('cmd.rccNotRemote'))],
            nextAction: 'forja build rcc',
        };
    }

    // --plan: return dry-run info without executing (check BEFORE remote branch)
    if (options.plan && target.runAt === 'remote') {
        const remoteAction = buildAction === 'fresh' ? 'rebuild' : buildAction === 'qmake' ? 'qmake' : 'build';
        const sshCmd = buildRemoteShellCommand(workspace, remoteAction);
        return {
            ok: true,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            plan: {
                mode: 'dryRun',
                commands: [sshCmd],
                shellCommand: sshCmd,
            },
        };
    }

    if (target.runAt === 'remote') {
        const remoteAction = buildAction === 'fresh' ? 'rebuild' : buildAction === 'qmake' ? 'qmake' : 'build';
        const remoteResult = await executeRemotePlan({
            workspace,
            target: target.kind,
            action: remoteAction as 'build' | 'rebuild' | 'clean',
            json: wantsJson,
            activeProject: target.project,
        });

        return {
            ok: remoteResult.ok,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            exitCode: remoteResult.exitCode,
            diagnostics: remoteResult.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: remoteResult.nextAction,
        };
    }

    if (target.kind === 'sdk') {
        try {
            const sdkAction = buildAction === 'fresh' ? 'rebuild' : 'build';
            const vsDevCmdPath = target.vsInstall ? resolveVsDevCmdPath(target.vsInstall) : null;
            const plan = createSdkPlan({
                action: sdkAction as 'build' | 'rebuild' | 'clean',
                workspace,
                project: path.isAbsolute(target.project) ? target.project : path.join(workspace, target.project),
                mode: target.mode,
                arch: target.arch,
                vsDevCmdPath: vsDevCmdPath || undefined,
            });

            if (options.plan) {
                return {
                    ok: true,
                    action: 'build',
                    buildAction,
                    workspace,
                    activeTarget: target,
                    plan: { mode: 'dryRun', commands: plan.commands, shellCommand: plan.shellCommand },
                };
            }

            const started = Date.now();
            const executed = await runCliResult(plan, { streaming: !wantsJson, detach: false, suppressedWarnings });
            const durationMs = Date.now() - started;

            const ok = executed.exitCode === 0;
            return {
                ok,
                action: 'build',
                buildAction,
                workspace,
                activeTarget: target,
                exitCode: executed.exitCode ?? undefined,
                durationMs: executed.durationMs > 0 ? executed.durationMs : durationMs,
                errors: executed.errors?.length > 0 ? executed.errors : undefined,
                warningSummary: executed.warningSummary,
                logFile: executed.logFile ?? undefined,
                diagnostics: ok ? undefined : [diag('error', executed.errors?.length > 0 ? `${T('cmd.sdkBuildFailed')} (${executed.errors.length} error${executed.errors.length > 1 ? 's' : ''})` : T('cmd.sdkBuildFailed'))],
                nextAction: ok ? undefined : (executed.errors?.length ? undefined : 'forja doctor'),
            };
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return {
                ok: false,
                action: 'build',
                buildAction,
                workspace,
                activeTarget: target,
                diagnostics: [diag('error', message)],
                nextAction: 'forja doctor',
            };
        }
    }

    // Qt local
    const workroot = resolveWorkroot(workspace);
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const qmakeArgs = wsConfig?.qtModulePrefs.qmakeArgs || undefined;
    const cliOptions = buildQtCliOptions(workspace, target, buildAction, options.plan ?? false, qmakeArgs);

    try {
        // fresh = clean first, then build
        if (buildAction === 'fresh' && !options.plan) {
            const cleanOpts = buildQtCliOptions(workspace, target, 'default', false, qmakeArgs);
            cleanOpts.action = 'clean';
            const cleanPlan = await createActionPlan(cleanOpts);
            if (cleanPlan.ok && cleanPlan.commands.length > 0) {
                const cleanResult = await runCliResult(cleanPlan, { streaming: false, detach: false, suppressedWarnings });
                if (!cleanResult.ok) {
                    return {
                        ok: false,
                        action: 'build',
                        buildAction,
                        workspace,
                        activeTarget: target,
                        exitCode: cleanResult.exitCode ?? undefined,
                        diagnostics: [diag('error', T('cmd.freshCleanFailed'))],
                        nextAction: 'forja doctor',
                    };
                }
            }
        }

        const planned = await createActionPlan(cliOptions);
        if (!planned.ok) {
            return {
                ok: false,
                action: 'build',
                buildAction,
                workspace,
                activeTarget: target,
                diagnostics: planned.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
                nextAction: stripJsonFlag(planned.nextAction),
            };
        }

        if (options.plan) {
            if (buildAction === 'fresh') {
                const cleanOpts = buildQtCliOptions(workspace, target, 'default', true, qmakeArgs);
                cleanOpts.action = 'clean';
                const cleanPlan = await createActionPlan(cleanOpts);
                const combinedCommands = [...(cleanPlan.ok ? cleanPlan.commands : []), ...planned.commands];
                return {
                    ok: true,
                    action: 'build',
                    buildAction,
                    workspace,
                    activeTarget: target,
                    plan: { mode: 'dryRun', commands: combinedCommands, shellCommand: combinedCommands.join(' && ') },
                };
            }
            return {
                ok: true,
                action: 'build',
                buildAction,
                workspace,
                activeTarget: target,
                plan: { mode: 'dryRun', commands: planned.commands, shellCommand: planned.shellCommand },
            };
        }

        // Pre-kill: terminate running instance before building (prevents LNK1104)
        if (target.kind === 'qt' && (buildAction === 'default' || buildAction === 'fresh')) {
            const projectDir = path.dirname(path.isAbsolute(target.project) ? target.project : path.join(workspace, target.project));
            const runtimeInfo = resolveRuntimeTarget(projectDir, target.mode, target.arch);
            if (runtimeInfo?.exePath) {
                terminateExecutable(runtimeInfo.exePath);
            }
        }

        const executed = await runCliResult(planned, { streaming: !wantsJson, detach: false, suppressedWarnings });
        return {
            ok: executed.ok,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            exitCode: executed.exitCode ?? undefined,
            durationMs: executed.durationMs > 0 ? executed.durationMs : undefined,
            errors: executed.errors?.length > 0 ? executed.errors : undefined,
            warningSummary: executed.warningSummary,
            logFile: executed.logFile ?? undefined,
            diagnostics: executed.ok ? undefined : [diag('error', executed.errors?.length > 0 ? `${T('cmd.qtBuildFailed')} (${executed.errors.length} error${executed.errors.length > 1 ? 's' : ''})` : T('cmd.qtBuildFailed'))],
            nextAction: executed.ok ? 'forja run' : (executed.errors?.length ? undefined : 'forja doctor'),
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', message)],
            nextAction: 'forja doctor',
        };
    }
}

export function outputBuildResult(result: BuildResult, wantsJson: boolean): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        const status = result.ok ? T('buildSucceeded') : T('buildFailed');
        console.log(`${T('build')} ${status}`);
        if (result.activeTarget) {
            const t = result.activeTarget;
            const qt = t.qmakeTarget ? ` · ${T('init.qmakeTarget')}: ${t.qmakeTarget}` : '';
            console.log(`${T('target')}${t.project} · ${t.mode}/${t.arch} · ${t.runAt}${qt}`);
        }
        if (result.durationMs) {
            console.log(`${T('duration')}${result.durationMs}ms`);
        }
        if (result.logFile) {
            console.log(`${T('log')}${result.logFile}`);
        }
        if (result.errors && result.errors.length > 0) {
            console.log(`${T('errors')}`);
            for (const err of result.errors) {
                console.log(`  ${err}`);
            }
        }
        if (result.warningSummary && result.warningSummary.total > 0) {
            console.log(`${T('warnings')} ${result.warningSummary.total} (${result.warningSummary.summary})`);
        }
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                console.log(`${T(d.level)}: ${d.message}`);
                if (d.hint) { console.log(`  ${T('hint')}${d.hint}`); }
            }
        }
        if (result.nextAction) {
            console.log(T('next'));
            console.log(`  ${result.nextAction}`);
        }
    }
}
