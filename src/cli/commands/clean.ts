/**
 * `forja clean` — clean build artifacts for current active target.
 * Output format follows v2 spec: CleanResult interface.
 */
import * as path from 'path';
import * as fs from 'fs';
import { requireActiveTarget } from './activeTarget';
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult } from '../../qt/shared/commandRunner';
import { CliOptions } from '../../qt/cli/types';
import { createSdkPlan } from '../../sdk/shared/plan';
import { executeRemotePlan } from '../../remote/core/plan';
import { ActiveTarget, Diagnostic, diag, T } from './types';
import { loadSdkSettings, resolveVsDevCmdPath } from '../../core/settingsIO';

export interface CleanResult {
    ok: boolean;
    action: 'clean';
    workspace?: string;
    activeTarget?: ActiveTarget;
    state?: 'cleaned' | 'already-clean';
    plan?: { mode: 'dryRun'; commands?: string[]; shellCommand?: string };
    durationMs?: number;
    exitCode?: number;
    changed?: string[];
    diagnostics?: Diagnostic[];
    nextAction?: string;
}

function buildCleanQtCliOptions(workspace: string, target: ActiveTarget, plan: boolean): CliOptions {
    return {
        action: 'clean',
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

export async function runClean(workspace: string, options: { plan?: boolean; json?: boolean } = {}): Promise<CleanResult> {
    const wantsJson = options.json ?? process.argv.includes('--json');
    let targetResult = requireActiveTarget(workspace);

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
            action: 'clean',
            workspace,
            diagnostics: [diag('error', targetResult.error)],
            nextAction: targetResult.nextAction,
        };
    }
    const target = targetResult.target;

    // --plan: return dry-run info without executing (check BEFORE remote branch)
    if (options.plan && target.runAt === 'remote') {
        return {
            ok: true,
            action: 'clean',
            workspace,
            activeTarget: target,
            plan: {
                mode: 'dryRun',
                commands: [`forja remote clean --target ${target.kind} --workspace ${workspace}`],
                shellCommand: `ssh <server> "cd <remotePath> && forja clean"`,
            },
        };
    }

    if (target.runAt === 'remote') {
        const remoteResult = await executeRemotePlan({
            workspace,
            target: target.kind,
            action: 'clean',
            json: wantsJson,
        });

        return {
            ok: remoteResult.ok,
            action: 'clean',
            workspace,
            activeTarget: target,
            state: remoteResult.ok ? 'cleaned' : undefined,
            exitCode: remoteResult.exitCode,
            diagnostics: remoteResult.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: remoteResult.nextAction,
        };
    }

    if (target.kind === 'sdk') {
        const sdkSettings = loadSdkSettings(workspace);
        const vsDevCmdPath = resolveVsDevCmdPath(sdkSettings.vsInstall);
        const plan = createSdkPlan({
            action: 'clean',
            workspace,
            project: path.isAbsolute(target.project) ? target.project : path.join(workspace, target.project),
            mode: target.mode,
            arch: target.arch,
            vsDevCmdPath: vsDevCmdPath || undefined,
        });

        if (options.plan) {
            return {
                ok: true,
                action: 'clean',
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
            action: 'clean',
            workspace,
            activeTarget: target,
            state: ok ? 'cleaned' : undefined,
            exitCode: executed.exitCode ?? undefined,
            durationMs: executed.durationMs > 0 ? executed.durationMs : durationMs,
            diagnostics: ok ? undefined : [diag('error', 'SDK clean failed')],
            nextAction: ok ? 'forja build' : 'forja doctor',
        };
    }

    // Qt local
    const cliOptions = buildCleanQtCliOptions(workspace, target, options.plan ?? false);

    try {
        const planned = await createActionPlan(cliOptions);
        if (!planned.ok) {
            return {
                ok: false,
                action: 'clean',
                workspace,
                activeTarget: target,
                diagnostics: planned.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
                nextAction: planned.nextAction?.replace(/\s+--json/g, ''),
            };
        }

        if (options.plan) {
            return {
                ok: true,
                action: 'clean',
                workspace,
                activeTarget: target,
                plan: { mode: 'dryRun', commands: planned.commands, shellCommand: planned.shellCommand },
            };
        }

        const executed = await runCliResult(planned, { streaming: !wantsJson, detach: false });
        return {
            ok: executed.ok,
            action: 'clean',
            workspace,
            activeTarget: target,
            state: executed.ok ? 'cleaned' : undefined,
            exitCode: executed.exitCode ?? undefined,
            durationMs: executed.durationMs > 0 ? executed.durationMs : undefined,
            diagnostics: executed.ok ? undefined : [diag('error', 'Qt clean failed')],
            nextAction: executed.ok ? 'forja build' : 'forja doctor',
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            action: 'clean',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', message)],
            nextAction: 'forja doctor',
        };
    }
}

export function outputCleanResult(result: CleanResult, wantsJson: boolean): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        const status = result.ok ? T('cleanSucceeded') : T('cleanFailed');
        console.log(`${T('clean')} ${status}`);
        if (result.activeTarget) {
            const t = result.activeTarget;
            console.log(`${T('target')}${t.kind} · ${t.project} · ${t.mode}/${t.arch} · ${t.runAt}`);
        }
        if (result.state) {
            console.log(`${T('state')}${result.state}`);
        }
        if (result.durationMs) {
            console.log(`${T('duration')}${result.durationMs}ms`);
        }
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                console.log(`${T(d.level)}: ${d.message}`);
            }
        }
        if (result.nextAction) {
            console.log(T('next'));
            console.log(`  ${result.nextAction}`);
        }
    }
}
