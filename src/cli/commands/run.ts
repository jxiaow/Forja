/**
 * `forja run` — run current active target.
 * Output format follows v2 spec: RunResult interface.
 */
import * as path from 'path';
import * as cp from 'child_process';
import { requireActiveTarget } from './activeTarget';
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult } from '../../qt/shared/commandRunner';
import { textOutput } from '../../qt/cli/index';
import { CliOptions, CliResult } from '../../qt/cli/types';
import { executeRemotePlan } from '../../remote/core/plan';
import { ActiveTarget, Diagnostic, RuntimeState, diag, Locale, T } from './types';
import { loadQtSettings } from '../../core/settingsIO';
import { launchDesigner } from '../../qt/build/designer';

export type RunAction = 'default' | 'detach' | 'debug' | 'custom' | 'designer';

export interface RunResult {
    ok: boolean;
    action: 'run';
    runAction: RunAction;
    workspace?: string;
    activeTarget?: ActiveTarget;
    plan?: { mode: 'dryRun'; commands?: string[]; shellCommand?: string };
    runtime?: RuntimeState;
    exitCode?: number;
    logFile?: string;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}

function buildRunQtCliOptions(workspace: string, target: ActiveTarget, options: { detach?: boolean; plan?: boolean }): CliOptions {
    return {
        action: 'run',
        executionMode: options.plan ? 'dryRun' : 'execute',
        workspace,
        project: target.project,
        mode: target.mode,
        arch: target.arch,
        qtPath: null,
        vsDevShell: null,
        target: null,
        qmakeArgs: null,
        detach: options.detach ?? false,
        saveLocal: false,
        json: false,
    };
}

export async function runRun(workspace: string, options: {
    detach?: boolean;
    debug?: boolean;
    custom?: string;
    designer?: string;
    plan?: boolean;
    json?: boolean;
} = {}): Promise<RunResult> {
    // ── designer 子命令：不需要 activeTarget ──
    if (options.designer) {
        return await handleDesigner(workspace, options.designer);
    }

    const targetResult = requireActiveTarget(workspace);

    if ('error' in targetResult) {
        return {
            ok: false,
            action: 'run',
            runAction: 'default',
            workspace,
            diagnostics: [diag('error', targetResult.error)],
            nextAction: targetResult.nextAction,
        };
    }
    const target = targetResult.target;

    // ── --debug：CLI 层无法启动 VSCode 调试器 ──
    if (options.debug) {
        return {
            ok: false,
            action: 'run',
            runAction: 'debug',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', 'Debug is only available in VSCode. Use the "Forja: Debug" command or status bar debug button.')],
            nextAction: 'forja run',
        };
    }

    // ── --custom：执行已保存自定义命令 ──
    if (options.custom) {
        return handleCustom(workspace, target, options.custom, options.json ?? false);
    }

    let runAction: RunAction = 'default';
    if (options.detach) { runAction = 'detach'; }

    if (target.kind === 'sdk') {
        return {
            ok: false,
            action: 'run',
            runAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', 'SDK target does not support run. Build first.')],
            nextAction: 'forja build',
        };
    }

    // --plan: return dry-run info without executing (check BEFORE remote branch)
    if (options.plan && target.runAt === 'remote') {
        return {
            ok: true,
            action: 'run',
            runAction,
            workspace,
            activeTarget: target,
            plan: {
                mode: 'dryRun',
                commands: [`forja remote run --target qt --workspace ${workspace}${options.detach ? ' --detach' : ''}`],
                shellCommand: `ssh <server> "cd <remotePath> && forja run${options.detach ? ' --detach' : ''}"`,
            },
        };
    }

    if (target.runAt === 'remote') {
        const remoteResult = await executeRemotePlan({
            workspace,
            target: 'qt',
            action: 'run',
            args: options.detach ? ['--detach'] : [],
            json: options.json ?? false,
            stream: !(options.json ?? false) && !options.detach,
        });

        return {
            ok: remoteResult.ok,
            action: 'run',
            runAction,
            workspace,
            activeTarget: target,
            exitCode: remoteResult.exitCode,
            diagnostics: remoteResult.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: remoteResult.nextAction,
        };
    }

    // Qt local
    const wantsJson = options.json ?? false;
    const cliOptions = buildRunQtCliOptions(workspace, target, options);

    try {
        const planned = await createActionPlan(cliOptions);
        if (!planned.ok) {
            return {
                ok: false,
                action: 'run',
                runAction,
                workspace,
                activeTarget: target,
                diagnostics: planned.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
                nextAction: planned.nextAction?.replace(/\s+--json/g, ''),
            };
        }

        if (options.plan) {
            return {
                ok: true,
                action: 'run',
                runAction,
                workspace,
                activeTarget: target,
                plan: { mode: 'dryRun', commands: planned.commands, shellCommand: planned.shellCommand },
            };
        }

        const executed = await runCliResult(planned, { streaming: !wantsJson, detach: options.detach ?? false });
        const runtime: RuntimeState | undefined = executed.pid ? {
            running: true,
            pid: executed.pid,
            executablePath: executed.executablePath,
            logFile: executed.logFile ?? undefined,
            runAt: 'local',
        } : undefined;

        return {
            ok: executed.ok,
            action: 'run',
            runAction,
            workspace,
            activeTarget: target,
            runtime,
            exitCode: executed.runtimeExitCode ?? executed.exitCode ?? undefined,
            logFile: executed.logFile ?? undefined,
            diagnostics: executed.ok ? undefined : [diag('error', 'Qt run failed')],
            nextAction: executed.ok
                ? (executed.runtimeExitCode !== undefined
                    ? undefined
                    : 'forja stop')
                : 'forja doctor',
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            action: 'run',
            runAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', message)],
            nextAction: 'forja doctor',
        };
    }
}

async function handleDesigner(workspace: string, uiFile: string): Promise<RunResult> {
    const resolvedPath = path.isAbsolute(uiFile) ? uiFile : path.join(workspace, uiFile);

    const qtConfig = loadQtSettings(workspace);
    const designerResult = await launchDesigner(resolvedPath, qtConfig.designerPath, qtConfig.qtPath);

    if (!designerResult.ok) {
        const code = designerResult.error?.includes('.ui') ? 'run.designerFileInvalid' : 'run.designerMissing';
        return {
            ok: false,
            action: 'run',
            runAction: 'designer',
            workspace,
            diagnostics: [diag('error', designerResult.error!)],
            nextAction: code === 'run.designerMissing' ? 'forja doctor' : undefined,
        };
    }

    return {
        ok: true,
        action: 'run',
        runAction: 'designer',
        workspace,
        nextAction: 'forja build',
    };
}

function handleCustom(workspace: string, target: ActiveTarget, customName: string, json: boolean): RunResult {
    if (target.kind === 'sdk') {
        return {
            ok: false,
            action: 'run',
            runAction: 'custom',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', 'SDK target does not support custom commands')],
            nextAction: 'forja build',
        };
    }

    const qtConfig = loadQtSettings(workspace);
    const customCmd = qtConfig.customCommands.find(c => c.name === customName);
    if (!customCmd) {
        const available = qtConfig.customCommands.map(c => c.name).join(', ') || '(none)';
        return {
            ok: false,
            action: 'run',
            runAction: 'custom',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', `Custom command not found: ${customName}. Available: ${available}`)],
            nextAction: 'forja list targets',
        };
    }

    try {
        const projectDir = path.isAbsolute(target.project)
            ? path.dirname(target.project)
            : path.join(workspace, path.dirname(target.project));

        const result = cp.spawnSync(customCmd.command, {
            cwd: projectDir,
            shell: true,
            stdio: ['inherit', 'pipe', 'pipe'],
        });

        const stdout = result.stdout?.toString() ?? '';
        const stderr = result.stderr?.toString() ?? '';

        // Only forward command output to terminal when not in JSON mode
        if (!json) {
            if (stdout) { process.stdout.write(stdout); }
            if (stderr) { process.stderr.write(stderr); }
        }

        const exitCode = result.status ?? 1;
        if (exitCode === 0) {
            return {
                ok: true,
                action: 'run',
                runAction: 'custom',
                workspace,
                activeTarget: target,
                exitCode: 0,
            };
        }
        return {
            ok: false,
            action: 'run',
            runAction: 'custom',
            workspace,
            activeTarget: target,
            exitCode,
            diagnostics: [diag('error', `Custom command "${customName}" failed with exit code ${exitCode}`)],
            nextAction: 'forja doctor',
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            action: 'run',
            runAction: 'custom',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', message)],
            nextAction: 'forja doctor',
        };
    }
}

import { stripJson } from './index';

export function outputRunResult(result: RunResult, wantsJson: boolean, locale: Locale, qtResult?: CliResult): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else if (qtResult) {
        console.log(textOutput(qtResult));
    } else {
        const status = result.ok ? T('runCompleted') : T('runFailed');
        console.log(`${T('run')} ${status}`);
        if (result.activeTarget) {
            const t = result.activeTarget;
            console.log(`${T('target')}${t.kind} · ${t.project} · ${t.mode}/${t.arch} · ${t.runAt}`);
        }
        if (result.runtime?.pid) {
            console.log(`${T('pidLabel')}${result.runtime.pid}`);
        }
        if (result.logFile) {
            console.log(`${T('log')}${result.logFile}`);
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
