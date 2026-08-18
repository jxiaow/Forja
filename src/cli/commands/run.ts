/**
 * `forja run` — run current active target.
 * Output format follows v2 spec: RunResult interface.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { requireActiveTarget, stripJsonFlag } from './activeTarget';
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult, terminateExecutable } from '../../qt/shared/commandRunner';
import { createPlatformRunExecutor } from '../../qt/platform/runExecutor';
import { resolveRuntimeTarget } from '../../qt/shared/runtimeTarget';
import { CliOptions } from '../../qt/cli/types';
import { ForjaJsonResult, ActiveTarget, Diagnostic, RuntimeState, diag, T } from './types';
import { getActiveTarget } from './activeTarget';
import { resolveVsDevCmdPath } from '../../core/settingsIO';
import { resolveWorkroot, loadWorkspaceConfig } from '../../core/workspaceStore';
import { launchDesigner } from '../../qt/build/designer';

export type RunAction = 'default' | 'detach' | 'debug' | 'custom' | 'designer';

export interface RunResult extends ForjaJsonResult {
    action: 'run';
    runAction: RunAction;
    plan?: { mode: 'dryRun'; commands?: string[]; shellCommand?: string };
    runtime?: RuntimeState;
    exitCode?: number;
    logFile?: string;
    customStdout?: string;
    customStderr?: string;
}

function buildRunQtCliOptions(workspace: string, target: ActiveTarget, options: { detach?: boolean; plan?: boolean }, qmakeArgs?: string, rccProjectPath?: string): CliOptions {
    const vsDevShell = target.toolchain.vsInstall ? resolveVsDevCmdPath(target.toolchain.vsInstall) : null;
    return {
        action: 'run',
        executionMode: options.plan ? 'dryRun' : 'execute',
        workspace,
        project: target.project,
        mode: target.mode,
        arch: target.arch,
        qtPath: target.toolchain.qtPath || null,
        vsDevShell: vsDevShell,
        target: target.toolchain.qmakeTarget || null,
        executableName: target.toolchain.executableName || null,
        qmakeArgs: qmakeArgs || null,
        jomPath: target.toolchain.jomPath || null,
        rccProjectPath: rccProjectPath || null,
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
    const workroot = resolveWorkroot(workspace);

    // Print run header before execution (text mode only)
    if (!options.json && !options.plan) {
        console.log(T('execLocal'));
        console.log(`  ${T('target')}: ${target.project}`);
        console.log(`  ${T('setupSummaryModeArch')}: ${target.mode} | ${target.arch}`);
        if (target.toolchain.qmakeTarget) { console.log(`  ${T('init.qmakeTarget')}: ${target.toolchain.qmakeTarget}`); }
        if (target.toolchain.executableName) { console.log(`  ${T('init.executableName')}: ${target.toolchain.executableName}`); }
        console.log();
    }

    // Validate project file exists
    const runProjectPath = path.isAbsolute(target.project)
        ? target.project
        : path.join(workroot || workspace, target.project);
    if (!fs.existsSync(runProjectPath)) {
        return {
            ok: false,
            action: 'run',
            runAction: 'default',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', `${T('cmd.targetProjectMissing')}: ${target.project}`)],
            nextAction: 'forja list targets',
        };
    }

    // ── --debug：CLI 层无法启动 VSCode 调试器（仅 VSCode 扩展内部调用时使用） ──
    if (options.debug) {
        return {
            ok: false,
            action: 'run',
            runAction: 'debug',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', T('cmd.debugVscodeOnly'))],
            nextAction: T('debugNextAction'),
        };
    }

    // ── --custom：执行已保存自定义命令 ──
    if (options.custom) {
        return handleCustom(workspace, target, options.custom, options.json ?? false);
    }

    let runAction: RunAction = 'default';
    if (options.detach) { runAction = 'detach'; }

    if (target.kind === 'cpp') {
        return {
            ok: false,
            action: 'run',
            runAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', T('cmd.cppRunUnsupported'))],
            nextAction: 'forja build',
        };
    }

    // Qt local
    const wantsJson = options.json ?? false;
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const qmakeArgs = wsConfig?.qtModulePrefs.qmakeArgs || undefined;
    const rccProjectPath = wsConfig?.qtModulePrefs.rccProjectPath || undefined;
    const cliOptions = buildRunQtCliOptions(workspace, target, options, qmakeArgs, rccProjectPath);

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
                nextAction: stripJsonFlag(planned.nextAction),
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

        // Pre-kill: terminate existing instance before launching (avoid port/file-lock conflicts)
        if (!options.detach) {
            const projectDir = path.dirname(path.isAbsolute(target.project) ? target.project : path.join(workroot || workspace, target.project));
            const runtimeInfo = resolveRuntimeTarget(projectDir, target.mode, target.arch);
            if (runtimeInfo?.exePath) {
                terminateExecutable(runtimeInfo.exePath);
            }
        }

        const executed = await runCliResult(planned, {
            streaming: !wantsJson,
            detach: options.detach ?? false,
            runExecutor: createPlatformRunExecutor()
        });
        const runtime: RuntimeState | undefined = executed.pid ? {
            running: true,
            pid: executed.pid,
            executablePath: executed.executablePath,
            logFile: executed.logFile ?? undefined,
        } : undefined;

        // Foreground run: app exited with non-zero code → reflect failure
        const appExitedNonZero = !options.detach
            && executed.runtimeExitCode !== undefined
            && executed.runtimeExitCode !== 0;

        return {
            ok: executed.ok && !appExitedNonZero,
            action: 'run',
            runAction,
            workspace,
            activeTarget: target,
            runtime,
            exitCode: executed.runtimeExitCode ?? executed.exitCode ?? undefined,
            logFile: executed.logFile ?? undefined,
            diagnostics: appExitedNonZero
                ? [diag('error', `${T('cmd.appExitedWithError')}: ${executed.runtimeExitCode}`)]
                : (executed.ok ? undefined : [diag('error', T('cmd.qtRunFailed'))]),
            nextAction: appExitedNonZero
                ? 'forja build'
                : (executed.ok
                    ? (executed.runtimeExitCode !== undefined ? undefined : 'forja stop')
                    : 'forja status'),
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
            nextAction: 'forja status',
        };
    }
}

async function handleDesigner(workspace: string, uiFile: string): Promise<RunResult> {
    const resolvedPath = path.isAbsolute(uiFile) ? uiFile : path.join(workspace, uiFile);

    if (!fs.existsSync(resolvedPath)) {
        return {
            ok: false,
            action: 'run',
            runAction: 'designer',
            workspace,
            diagnostics: [diag('error', `File not found: ${resolvedPath}`)],
            nextAction: 'forja run designer <file.ui>',
        };
    }

    const workroot = resolveWorkroot(workspace);
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const designerPath = wsConfig?.qtModulePrefs.designerPath || '';
    const target = getActiveTarget(workspace);
    const qtPath = target?.toolchain.qtPath || '';
    const designerResult = await launchDesigner(resolvedPath, designerPath, qtPath);

    if (!designerResult.ok) {
        const isUiFileError = designerResult.error?.endsWith('.ui') || designerResult.error?.includes('.ui ');
        return {
            ok: false,
            action: 'run',
            runAction: 'designer',
            workspace,
            diagnostics: [diag('error', designerResult.error!)],
            nextAction: isUiFileError ? undefined : 'forja status',
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
    if (target.kind === 'cpp') {
        return {
            ok: false,
            action: 'run',
            runAction: 'custom',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', T('cmd.cppCustomUnsupported'))],
            nextAction: 'forja build',
        };
    }

    const workroot = resolveWorkroot(workspace);
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const customCommands = wsConfig?.qtModulePrefs.customCommands ?? [];
    const customCmd = customCommands.find(c => c.name === customName);
    if (!customCmd) {
        const available = customCommands.map(c => c.name).join(', ') || T('none');
        return {
            ok: false,
            action: 'run',
            runAction: 'custom',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', `${T('cmd.customNotFound')}: ${customName}. ${T('cmd.customAvailable')}: ${available}`)],
        };
    }

    try {
        const projectDir = path.isAbsolute(target.project)
            ? path.dirname(target.project)
            : path.join(workroot || workspace, path.dirname(target.project));

        // Inject Qt bin into PATH so custom commands can find Qt tools
        const env = { ...process.env };
        if (target.toolchain.qtPath) {
            env.PATH = `${target.toolchain.qtPath}${path.sep}bin${path.delimiter}${env.PATH || ''}`;
        }

        const result = cp.spawnSync(customCmd.command, {
            cwd: projectDir,
            shell: true,
            stdio: ['inherit', 'pipe', 'pipe'],
            timeout: 5 * 60 * 1000,
            env,
        });

        const stdout = result.stdout?.toString() ?? '';
        const stderr = result.stderr?.toString() ?? '';

        // Only forward command output to terminal when not in JSON mode
        if (!json) {
            if (stdout) { process.stdout.write(stdout); }
            if (stderr) { process.stderr.write(stderr); }
        }

        if (result.error) {
            return {
                ok: false,
                action: 'run',
                runAction: 'custom',
                workspace,
                activeTarget: target,
                diagnostics: [diag('error', `${T('cmd.customFailed')}: "${customName}" — ${result.error.message}`)],
                nextAction: 'forja status',
            };
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
                ...(json && stdout ? { customStdout: stdout } : {}),
            };
        }
        return {
            ok: false,
            action: 'run',
            runAction: 'custom',
            workspace,
            activeTarget: target,
            exitCode,
            diagnostics: [diag('error', `${T('cmd.customFailed')}: "${customName}" exit code ${exitCode}`)],
            ...(json ? { customStdout: stdout || undefined, customStderr: stderr || undefined } : {}),
            nextAction: 'forja status',
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
            nextAction: 'forja status',
        };
    }
}

export function outputRunResult(result: RunResult, wantsJson: boolean): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        const status = result.ok ? T('runCompleted') : T('runFailed');
        console.log(`${T('run')} ${status}`);
        if (result.activeTarget) {
            const t = result.activeTarget;
            const exeName = t.toolchain.executableName || t.toolchain.qmakeTarget;
            const qt = exeName ? ` · ${T('init.executableName')}: ${exeName}` : '';
            console.log(`${T('target')}: ${t.project} · ${t.mode}/${t.arch}${qt}`);
        }
        if (result.runtime?.pid) {
            console.log(`${T('pidLabel')}: ${result.runtime.pid}`);
        }
        if (result.logFile) {
            console.log(`${T('log')}: ${result.logFile}`);
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
    if (!result.ok) { process.exitCode = 1; }
}
