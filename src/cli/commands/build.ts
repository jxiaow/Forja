/**
 * `forja build` — build current active target.
 * Output format follows v2 spec: BuildResult interface.
 */
import * as path from 'path';
import * as fs from 'fs';
import { requireActiveTarget } from './activeTarget';
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult } from '../../qt/shared/commandRunner';
import { CliOptions } from '../../qt/cli/types';
import { createSdkPlan } from '../../sdk/shared/plan';
import { executeRemotePlan, buildRemoteShellCommand } from '../../remote/core/plan';
import { ActiveTarget, Diagnostic, diag, T } from './types';
import { loadQtSettings, loadSdkSettings, resolveVsDevCmdPath } from '../../core/settingsIO';

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

function buildQtCliOptions(workspace: string, target: ActiveTarget, action: BuildAction, plan: boolean): CliOptions {
    let qtAction: CliOptions['action'];
    switch (action) {
        case 'qmake': qtAction = 'qmake'; break;
        case 'rcc': qtAction = 'rcc'; break;
        default: qtAction = 'build'; break;
    }
    return {
        action: qtAction,
        executionMode: plan ? 'dryRun' : 'execute',
        workspace,
        project: target.project,
        mode: target.mode,
        arch: target.arch,
        qtPath: null,
        vsDevShell: null,
        target: null,
        qmakeArgs: null,
        detach: false,
        saveLocal: false,
        json: false,
    };
}

export async function runBuild(workspace: string, buildAction: BuildAction, options: { plan?: boolean; json?: boolean; project?: string } = {}): Promise<BuildResult> {
    const wantsJson = options.json ?? process.argv.includes('--json');
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
                diagnostics: [diag('error', `Cannot determine project kind from: ${projectPath}`)],
                nextAction: 'forja list targets',
            };
        }
        if (!fs.existsSync(projectPath)) {
            return {
                ok: false, action: 'build', buildAction, workspace,
                diagnostics: [diag('error', `Project file not found: ${projectPath}`)],
                nextAction: 'forja list targets',
            };
        }
        const qtSettings = loadQtSettings(workspace);
        const sdkSettings = loadSdkSettings(workspace);
        targetResult = {
            target: {
                kind,
                project: projectPath,
                mode: kind === 'qt' ? (qtSettings.mode || 'debug') : (sdkSettings.mode || 'debug'),
                arch: kind === 'qt' ? (qtSettings.arch || 'x86') : (sdkSettings.arch || (process.platform === 'win32' ? 'x86' : 'x64')),
                runAt: 'local',
            },
        };
    } else {
        targetResult = requireActiveTarget(workspace);
    }

    // Fallback: if no activeTarget but SDK has pinnedProject, synthesize target from SDK config
    if ('error' in targetResult) {
        const sdkSettings = loadSdkSettings(workspace);
        if (sdkSettings.pinnedProject) {
            const projectPath = path.isAbsolute(sdkSettings.pinnedProject)
                ? sdkSettings.pinnedProject
                : path.join(workspace, sdkSettings.pinnedProject);
            if (fs.existsSync(projectPath)) {
                targetResult = {
                    target: {
                        kind: 'sdk',
                        project: sdkSettings.pinnedProject,
                        mode: sdkSettings.mode || 'debug',
                        arch: sdkSettings.arch || (process.platform === 'win32' ? 'x86' : 'x64'),
                        runAt: 'local',
                    },
                };
            }
        }
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
            diagnostics: [diag('error', `Target project missing: ${target.project}`)],
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
            diagnostics: [diag('error', `SDK target does not support '${buildAction}'`)],
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
            diagnostics: [diag('error', 'RCC is not supported on remote targets')],
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
            const sdkSettings = loadSdkSettings(workspace);
            const vsDevCmdPath = resolveVsDevCmdPath(sdkSettings.vsInstall);
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
            const executed = await runCliResult(plan, { streaming: !wantsJson, detach: false });
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
                diagnostics: ok ? undefined : [diag('error', executed.errors?.length > 0 ? `SDK build failed (${executed.errors.length} error${executed.errors.length > 1 ? 's' : ''})` : 'SDK build failed')],
                nextAction: ok ? undefined : 'forja doctor',
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
    const cliOptions = buildQtCliOptions(workspace, target, buildAction, options.plan ?? false);

    try {
        // fresh = clean first, then build
        if (buildAction === 'fresh' && !options.plan) {
            const cleanOpts = buildQtCliOptions(workspace, target, 'default', false);
            cleanOpts.action = 'clean';
            const cleanPlan = await createActionPlan(cleanOpts);
            if (cleanPlan.ok && cleanPlan.commands.length > 0) {
                await runCliResult(cleanPlan, { streaming: false, detach: false });
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
                nextAction: planned.nextAction?.replace(/\s+--json/g, ''),
            };
        }

        if (options.plan) {
            if (buildAction === 'fresh') {
                const cleanOpts = buildQtCliOptions(workspace, target, 'default', true);
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

        const executed = await runCliResult(planned, { streaming: !wantsJson, detach: false });
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
            diagnostics: executed.ok ? undefined : [diag('error', executed.errors?.length > 0 ? `Qt build failed (${executed.errors.length} error${executed.errors.length > 1 ? 's' : ''})` : 'Qt build failed')],
            nextAction: executed.ok ? 'forja run' : 'forja doctor',
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
            console.log(`${T('target')}${t.kind} · ${t.project} · ${t.mode}/${t.arch} · ${t.runAt}`);
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
