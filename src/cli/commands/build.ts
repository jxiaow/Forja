/**
 * `forja build` — build current active target.
 * Output format follows v2 spec: BuildResult interface.
 */
import * as path from 'path';
import * as fs from 'fs';
import { requireActiveTarget } from './activeTarget';
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult } from '../../qt/shared/commandRunner';
import { textOutput } from '../../qt/cli/index';
import { CliOptions, CliResult } from '../../qt/cli/types';
import { createSdkPlan, executeSdkAsync, extractSdkErrors } from '../../sdk/shared/plan';
import { executeRemotePlan } from '../../remote/core/plan';
import { ensureLocalStateDir } from '../../qt/shared/localState';
import { ActiveTarget, Diagnostic, diag, Locale, T } from './types';
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
        return {
            ok: true,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            plan: {
                mode: 'dryRun',
                commands: [`forja remote ${remoteAction} --target ${target.kind} --workspace ${workspace}`],
                shellCommand: `ssh <server> "cd <remotePath> && forja ${remoteAction}"`,
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
        const executed = await executeSdkAsync(plan.shellCommand, workspace);
        const durationMs = Date.now() - started;
        const errors = executed.exitCode !== 0 ? extractSdkErrors(executed.stdout + '\n' + executed.stderr) : [];

        const logFile = path.join(workspace, '.forja', 'logs', `sdk-${sdkAction}-${Date.now()}.log`);
        try {
            ensureLocalStateDir(workspace);
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
            fs.writeFileSync(logFile, `$ ${plan.shellCommand}\n\n${executed.stdout}\n${executed.stderr}`, 'utf8');
        } catch { /* log write failure must not fail the build result */ }

        const ok = executed.exitCode === 0;
        return {
            ok,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            exitCode: executed.exitCode,
            durationMs,
            errors: errors.length > 0 ? errors : undefined,
            logFile,
            diagnostics: ok ? undefined : [diag('error', 'SDK build failed')],
            nextAction: ok ? undefined : 'forja doctor',
        };
    }

    // Qt local
    const cliOptions = buildQtCliOptions(workspace, target, buildAction, options.plan ?? false);

    try {
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
            errors: executed.errors.length > 0 ? executed.errors : undefined,
            logFile: executed.logFile ?? undefined,
            diagnostics: executed.ok ? undefined : [diag('error', 'Qt build failed')],
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

export function outputBuildResult(result: BuildResult, wantsJson: boolean, locale: Locale, qtResult?: CliResult): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else if (qtResult) {
        console.log(textOutput(qtResult));
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
