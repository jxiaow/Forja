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
import { refreshRccManifest } from '../../qt/shared/rccResolver';
import { readRunState } from '../../qt/shared/localState';
import { CliOptions } from '../../qt/cli/types';
import { createCppPlan } from '../../cpp/shared/plan';
import { ForjaJsonResult, ActiveTarget, Locale, diag, mapQtDiagnostic, mapCppPlanDiagnostic, T } from './types';
import { resolveVsDevCmdPath, loadGlobalConfig } from '../../core/settingsIO';
import { resolveWorkroot, loadWorkspaceConfig } from '../../core/workspaceStore';
import { outputResult } from './output';
import { extractFlag, findUnknownFlags, hasEmptyFlagValue, hasFlag, unknownFlagsMessage, suggestCorrection } from './args';
import { isRemoteMode, executeRemoteBridgeAction, downloadArtifacts } from './remoteMode';

export type BuildAction = 'default' | 'fresh' | 'qmake' | 'rcc';

function isPathUnder(candidate: string, dir: string): boolean {
    let resolvedDir = path.resolve(dir);
    let resolvedCandidate = path.resolve(candidate);
    if (process.platform === 'win32') {
        resolvedDir = resolvedDir.toLowerCase();
        resolvedCandidate = resolvedCandidate.toLowerCase();
    }
    const rel = path.relative(resolvedDir, resolvedCandidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface BuildResult extends ForjaJsonResult {
    action: 'build';
    buildAction: BuildAction;
    plan?: { mode: 'dryRun'; commands?: string[]; shellCommand?: string };
    durationMs?: number;
    exitCode?: number;
    errors?: string[];
    warningSummary?: { total: number; summary: string };
    logFile?: string;
}

function buildQtCliOptions(workspace: string, target: ActiveTarget, opts: { action: BuildAction; plan?: boolean; qmakeArgs?: string; rccProjectPath?: string; jobs?: number }): CliOptions {
    let qtAction: CliOptions['action'];
    switch (opts.action) {
        case 'qmake': qtAction = 'qmake'; break;
        case 'rcc': qtAction = 'rcc'; break;
        default: qtAction = 'build'; break;
    }
    const vsDevShell = target.toolchain.vsInstall ? resolveVsDevCmdPath(target.toolchain.vsInstall) : null;
    return {
        action: qtAction,
        executionMode: opts.plan ? 'dryRun' : 'execute',
        workspace,
        project: target.project,
        mode: target.mode,
        arch: target.arch,
        qtPath: target.toolchain.qtPath || null,
        vsDevShell: vsDevShell,
        target: target.toolchain.executableName || null,
        executableName: target.toolchain.executableName || null,
        qmakeArgs: opts.qmakeArgs || null,
        jomPath: target.toolchain.jomPath || null,
        rccProjectPath: opts.rccProjectPath || null,
        jobs: opts.jobs,
        detach: false,
        saveLocal: false,
        json: false,
    };
}

export async function runBuild(workspace: string, buildAction: BuildAction, options: { plan?: boolean; json?: boolean; project?: string; jobs?: number } = {}): Promise<BuildResult> {
    const wantsJson = options.json ?? false;
    let targetResult: ReturnType<typeof requireActiveTarget>;

    // If --project is provided (e.g., from remote bridge), construct target directly
    if (options.project) {
        const projectPath = options.project;
        const ext = path.extname(projectPath).toLowerCase();
        const basename = path.basename(projectPath);
        let kind: 'qt' | 'cpp';
        if (ext === '.pro') { kind = 'qt'; }
        else if (ext === '.sln' || basename.toLowerCase() === 'makefile' || basename.toLowerCase() === 'cmakelists.txt' || ext === '.sh' || ext === '.bat') { kind = 'cpp'; }
        else {
            return {
                ok: false, action: 'build', buildAction, workspace,
                diagnostics: [diag('error', `${T('cmd.cannotDetermineKind')}: ${projectPath}`)],
                nextAction: 'forja list targets',
            };
        }
        // Resolve to absolute for existence check, then store as relative for remote compatibility
        const earlyWorkroot = resolveWorkroot(workspace);
        const absolutePath = path.isAbsolute(projectPath) ? projectPath : path.join(earlyWorkroot || workspace, projectPath);
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
        const wsConfigEarly = earlyWorkroot ? loadWorkspaceConfig(earlyWorkroot) : null;
        const allTargets = wsConfigEarly ? Object.values(wsConfigEarly.targets) : [];
        const fallbackMode = 'debug' as const;
        const fallbackArch = (process.platform === 'win32' ? 'x86' : 'x64') as 'x86' | 'x64';
        const projectBasename = path.basename(projectPath, path.extname(projectPath));
        // Inherit toolchain from a saved target of the same kind to avoid mismatched toolchain
        const sameKindTarget = allTargets.find(t => t.kind === kind);
        const fallbackToolchain = sameKindTarget ? { ...sameKindTarget.toolchain } : {};
        targetResult = {
            target: {
                id: `${kind}-${projectBasename}-${fallbackMode}-${fallbackArch}`,
                name: projectBasename,
                kind,
                project: relativeProject,
                mode: fallbackMode,
                arch: fallbackArch,
                toolchain: fallbackToolchain,
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
    const workroot = resolveWorkroot(workspace);
    const earlyWsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const suppressedWarnings = earlyWsConfig?.qtModulePrefs.suppressedWarnings ?? [];

    // Print build header before execution (text mode only)
    if (!wantsJson && !options.plan) {
        console.log(T('execLocal'));
        console.log(`  ${T('target')}: ${target.buildScript || target.project}`);
        console.log(`  ${T('setupSummaryModeArch')}: ${target.mode} | ${target.arch}`);
        if (target.toolchain.executableName) { console.log(`  ${T('init.executableName')}: ${target.toolchain.executableName}`); }
        console.log();
    }

    // Validate project file exists
    const buildProjectPath = path.isAbsolute(target.project)
        ? target.project
        : path.join(workroot || workspace, target.project);
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

    if ((buildAction === 'qmake' || buildAction === 'rcc') && target.kind === 'cpp') {
        return {
            ok: false,
            action: 'build',
            buildAction,
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', `${T('cmd.cppNoQmakeRcc')} '${buildAction}'`)],
            nextAction: 'forja build',
        };
    }

    if (target.kind === 'cpp') {
        try {
            const cppAction = buildAction === 'fresh' ? 'rebuild' : 'build';
            const vsDevCmdPath = target.toolchain.vsInstall ? resolveVsDevCmdPath(target.toolchain.vsInstall) : null;
            // Use buildScript as the build entry point when set, otherwise use project
            const buildProject = target.buildScript
                ? (path.isAbsolute(target.buildScript) ? target.buildScript : path.join(workroot || workspace, target.buildScript))
                : (path.isAbsolute(target.project) ? target.project : path.join(workroot || workspace, target.project));
            const plan = createCppPlan({
                action: cppAction as 'build' | 'rebuild' | 'clean',
                workspace,
                project: buildProject,
                mode: target.mode,
                arch: target.arch,
                vsDevCmdPath: vsDevCmdPath || undefined,
                jobs: options.jobs,
                cmakeConfigureArgs: earlyWsConfig?.cppModulePrefs.cmakeConfigureArgs,
            });
            const presetWarnings = plan.diagnostics
                .map(mapCppPlanDiagnostic)
                .filter((d): d is NonNullable<ReturnType<typeof mapCppPlanDiagnostic>> => d !== null);

            if (options.plan) {
                return {
                    ok: true,
                    action: 'build',
                    buildAction,
                    workspace,
                    activeTarget: target,
                    plan: { mode: 'dryRun', commands: plan.commands, shellCommand: plan.shellCommand },
                    diagnostics: presetWarnings.length > 0 ? presetWarnings : undefined,
                };
            }

            // Pre-kill: terminate running instance before building (prevents LNK1204/file lock errors)
            // Only kill if the run state executable matches this project (avoid cross-target kill)
            if (buildAction === 'default' || buildAction === 'fresh') {
                const state = readRunState(workspace);
                if (state?.executablePath) {
                    const projectBasename = path.basename(target.project, path.extname(target.project));
                    const exeBasename = path.basename(state.executablePath, path.extname(state.executablePath));
                    if (exeBasename === projectBasename && isPathUnder(state.executablePath, workroot || workspace)) {
                        terminateExecutable(state.executablePath);
                    }
                }
            }

            const started = Date.now();
            const executed = await runCliResult(plan, { streaming: !wantsJson, detach: false, suppressedWarnings });
            const durationMs = Date.now() - started;

            const ok = executed.ok;
            const failureDiags = ok ? [] : [diag('error', executed.errors?.length > 0 ? `${T('cmd.cppBuildFailed')} (${T('cmd.buildErrorCount', [String(executed.errors.length)])})` : T('cmd.cppBuildFailed'))];
            const mergedDiags = [...presetWarnings, ...failureDiags];
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
                diagnostics: mergedDiags.length > 0 ? mergedDiags : undefined,
                nextAction: ok ? undefined : (executed.errors?.length ? undefined : 'forja status'),
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
                nextAction: 'forja status',
            };
        }
    }

    // Qt local
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const qmakeArgs = wsConfig?.qtModulePrefs.qmakeArgs || undefined;
    const rccProjectPath = wsConfig?.qtModulePrefs.rccProjectPath || undefined;
    const cliOptions = buildQtCliOptions(workspace, target, { action: buildAction, plan: options.plan, qmakeArgs, rccProjectPath, jobs: options.jobs });

    try {
        // fresh = clean first, then build
        if (buildAction === 'fresh' && !options.plan) {
            const cleanOpts = buildQtCliOptions(workspace, target, { action: 'default', qmakeArgs, rccProjectPath });
            cleanOpts.action = 'clean';
            const cleanPlan = await createActionPlan(cleanOpts);
            if (cleanPlan.ok && cleanPlan.commands.length > 0) {
                const cleanResult = await runCliResult(cleanPlan, { streaming: false, detach: false, suppressedWarnings });
                if (!cleanResult.ok) {
                    const cleanDetail = cleanResult.errors?.slice(0, 2).join('; ') || `exit code ${cleanResult.exitCode ?? '?'}`;
                    return {
                        ok: false,
                        action: 'build',
                        buildAction,
                        workspace,
                        activeTarget: target,
                        exitCode: cleanResult.exitCode ?? undefined,
                        diagnostics: [diag('error', `${T('cmd.freshCleanFailed')}: ${cleanDetail}`)],
                        nextAction: 'forja status',
                    };
                }
            }
        }

        const planned = await createActionPlan(cliOptions);
        if (!planned.ok) {
            let nextAction = stripJsonFlag(planned.nextAction);
            const isRccMissing = planned.diagnostics.some(d => d.code === 'rccMissing' || d.code === 'rccNoQrc');
            if (isRccMissing) {
                nextAction = workroot ? 'forja use --rcc' : 'forja init';
            }
            if (planned.diagnostics.some(d => d.code === 'qtPathInvalid') && !workroot) {
                nextAction = 'forja init';
            }
            return {
                ok: false,
                action: 'build',
                buildAction,
                workspace,
                activeTarget: target,
                diagnostics: planned.diagnostics.map(mapQtDiagnostic),
                nextAction,
            };
        }

        if (options.plan) {
            if (buildAction === 'fresh') {
                const cleanOpts = buildQtCliOptions(workspace, target, { action: 'default', plan: true, qmakeArgs, rccProjectPath });
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
            const projectDir = path.dirname(path.isAbsolute(target.project) ? target.project : path.join(workroot || workspace, target.project));
            const runtimeInfo = resolveRuntimeTarget(projectDir, target.mode, target.arch);
            if (runtimeInfo?.exePath) {
                terminateExecutable(runtimeInfo.exePath);
            } else {
                // Makefile mismatch or unresolved — fall back to saved run state
                // Only kill if the exe matches this project (avoid cross-target kill)
                const state = readRunState(workspace);
                if (state?.executablePath) {
                    const projectBasename = path.basename(target.project, path.extname(target.project));
                    const exeBasename = path.basename(state.executablePath, path.extname(state.executablePath));
                    if (exeBasename === projectBasename && isPathUnder(state.executablePath, projectDir)) {
                        terminateExecutable(state.executablePath);
                    }
                }
            }
        }

        const executed = await runCliResult(planned, { streaming: !wantsJson, detach: false, suppressedWarnings });
        // rcc 编译成功后重写该 workroot 的重编 manifest（内容哈希记录，供下次判定快路径）
        if (executed.ok && planned.rccCompiled) { refreshRccManifest(workspace, rccProjectPath); }
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
            diagnostics: executed.ok ? undefined : [diag('error', executed.errors?.length > 0 ? `${T('cmd.qtBuildFailed')} (${T('cmd.buildErrorCount', [String(executed.errors.length)])})` : T('cmd.qtBuildFailed'))],
            nextAction: executed.ok ? (buildAction === 'qmake' ? 'forja build' : 'forja run') : (executed.errors?.length ? undefined : 'forja status'),
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
            nextAction: 'forja status',
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
            const exeName = t.toolchain.executableName;
            const qt = exeName ? ` · ${T('init.executableName')}: ${exeName}` : '';
            console.log(`${T('target')}: ${t.buildScript || t.project} · ${t.mode}/${t.arch}${qt}`);
        }
        if (result.durationMs) {
            console.log(`${T('duration')}: ${result.durationMs}ms`);
        }
        if (result.logFile) {
            console.log(`${T('log')}: ${result.logFile}`);
        }
        if (result.errors && result.errors.length > 0) {
            console.log(`${T('errors')}`);
            for (const err of result.errors) {
                console.log(`  ${err}`);
            }
        }
        if (result.warningSummary && result.warningSummary.total > 0) {
            console.log(`${T('warnings')}: ${result.warningSummary.total} (${result.warningSummary.summary})`);
        }
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                console.log(`${T(d.level)}: ${d.message}`);
                if (d.hint) { console.log(`  ${T('hint')}: ${d.hint}`); }
            }
        }
        if (result.nextAction) {
            console.log(T('next'));
            console.log(`  ${result.nextAction}`);
        }
    }
    if (!result.ok) { process.exitCode = 1; }
}

// ── Build ──

export async function handleBuild(argv: string[], workroot: string, wantsJson: boolean, _locale: Locale): Promise<void> {
    const buildUnknown = findUnknownFlags(
        argv,
        new Set(['--plan', '--project', '--jobs', '--download', '--artifact']),
        new Set(['--project', '--jobs', '--artifact']),
    );
    if (buildUnknown.length > 0) {
        outputResult({ ok: false, action: 'build', buildAction: 'default', workroot, diagnostics: [{ level: 'error', message: unknownFlagsMessage(buildUnknown, new Set(['--plan','--project','--jobs','--download','--artifact'])) }], nextAction: 'forja build' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    if (hasEmptyFlagValue(argv, '--project')) {
        outputResult({ ok: false, action: 'build', buildAction: 'default', workroot, diagnostics: [{ level: 'error', message: '--project requires a non-empty value' }], nextAction: 'forja build' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    let buildAction: BuildAction = 'default';
    if (subArg === 'fresh') { buildAction = 'fresh'; }
    else if (subArg === 'qmake') { buildAction = 'qmake'; }
    else if (subArg === 'rcc') { buildAction = 'rcc'; }
    else if (subArg !== '') {
        // Unknown subaction - error with suggestion
        const BUILD_ACTIONS = ['fresh', 'qmake', 'rcc'];
        const buildHint = suggestCorrection(subArg, BUILD_ACTIONS);
        const buildMsg = buildHint
            ? `${T('idx.unknownBuildAction')}: ${subArg}. ${T('idx.didYouMean')}: ${buildHint}?`
            : `${T('idx.unknownBuildAction')}: ${subArg}. ${T('idx.validActions')}`;
        outputResult({
            ok: false,
            action: 'build',
            buildAction: 'default',
            workroot,
            diagnostics: [{ level: 'error', message: buildMsg }],
            nextAction: buildHint ? `forja build ${buildHint}` : 'forja build',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const jobsRaw = extractFlag(argv, '--jobs');
    let jobs: number | undefined;
    if (jobsRaw) {
        jobs = parseInt(jobsRaw, 10);
        if (isNaN(jobs) || jobs < 1) {
            outputResult({ ok: false, action: 'build', buildAction: 'default', workroot, diagnostics: [{ level: 'error', message: '--jobs requires a positive integer' }], nextAction: 'forja build' }, wantsJson);
            process.exitCode = 1;
            return;
        }
    } else {
        jobs = loadGlobalConfig().jobs;
    }

    // Remote mode routing — directly bridge to remote (no prepare pipeline)
    if (isRemoteMode(workroot)) {
        const remoteActionMap: Record<string, 'build' | 'rebuild' | 'qmake'> = { default: 'build', fresh: 'rebuild', qmake: 'qmake' };
        const remoteAction = remoteActionMap[buildAction];
        if (remoteAction) {
            const extraArgs: string[] = [];
            const activeProject = extractFlag(argv, '--project');
            if (activeProject) { extraArgs.push('--project', activeProject); }
            if (jobs !== undefined) { extraArgs.push('--jobs', String(jobs)); }

            const result = await executeRemoteBridgeAction(workroot, remoteAction, extraArgs, wantsJson);
            if (result?.ok && hasFlag(argv, '--download')) {
                await downloadArtifacts(workroot, argv, wantsJson);
            }
            return;
        }
    }

    const result = await runBuild(workroot, buildAction, {
        plan: hasFlag(argv, '--plan'),
        json: wantsJson,
        project: extractFlag(argv, '--project'),
        jobs,
    });
    outputBuildResult(result, wantsJson);
}
