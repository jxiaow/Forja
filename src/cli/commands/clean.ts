/**
 * `forja clean` — clean build artifacts for current active target.
 * Output format follows v2 spec: CleanResult interface.
 */
import * as path from 'path';
import * as fs from 'fs';
import { requireActiveTarget, stripJsonFlag } from './activeTarget';
import { createActionPlan } from '../../qt/shared/qtCore';
import { runCliResult, terminateExecutable } from '../../qt/shared/commandRunner';
import { readRunState } from '../../qt/shared/localState';
import { CliOptions } from '../../qt/cli/types';
import { createCppPlan } from '../../cpp/shared/plan';
import { executeRemotePlan, buildRemoteShellCommand } from '../../remote/core/plan';
import { ForjaJsonResult, ActiveTarget, Diagnostic, diag, T } from './types';
import { loadRemoteSettings, resolveVsDevCmdPath } from '../../core/settingsIO';
import { resolveWorkroot, loadWorkspaceConfig } from '../../core/workspaceStore';
import { getServerById } from '../../core/serverStore';

export interface CleanResult extends ForjaJsonResult {
    action: 'clean';
    state?: 'cleaned' | 'already-clean';
    plan?: { mode: 'dryRun'; commands?: string[]; shellCommand?: string };
    durationMs?: number;
    exitCode?: number;
    changed?: string[];
}

// ── Build artifact detection ──

const BUILD_ARTIFACT_EXTENSIONS = new Set([
    '.o', '.obj', '.exe', '.dll', '.lib', '.a', '.so', '.dylib', '.pdb', '.ilk',
]);

function hasBuildArtifacts(dir: string, maxFiles = 2000): boolean {
    if (!fs.existsSync(dir)) { return false; }
    let count = 0;
    function scan(current: string, depth: number): boolean {
        if (depth > 4 || count > maxFiles) { return false; }
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return false; }
        for (const entry of entries) {
            if (count > maxFiles) { return false; }
            if (entry.name.startsWith('.')) { continue; }
            if (entry.isDirectory()) {
                if (scan(path.join(current, entry.name), depth + 1)) { return true; }
            } else if (entry.isFile()) {
                count++;
                if (BUILD_ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                    return true;
                }
            }
        }
        return false;
    }
    return scan(dir, 0);
}

function getBuildOutputDir(projectPath: string, kind: 'qt' | 'cpp'): string {
    const projectDir = path.dirname(projectPath);
    const basename = path.basename(projectPath).toLowerCase();
    if (kind === 'cpp' && basename === 'cmakelists.txt') {
        return path.join(projectDir, 'build');
    }
    return projectDir;
}

// ── CLI options builder ──

function buildCleanQtCliOptions(workspace: string, target: ActiveTarget, plan: boolean, qmakeArgs?: string, rccProjectPath?: string): CliOptions {
    const vsDevShell = target.toolchain.vsInstall ? resolveVsDevCmdPath(target.toolchain.vsInstall) : null;
    return {
        action: 'clean',
        executionMode: plan ? 'dryRun' : 'execute',
        workspace,
        project: target.project,
        mode: target.mode,
        arch: target.arch,
        qtPath: target.toolchain.qtPath || null,
        vsDevShell: vsDevShell,
        target: target.toolchain.qmakeTarget || null,
        qmakeArgs: qmakeArgs || null,
        jomPath: target.toolchain.jomPath || null,
        rccProjectPath: rccProjectPath || null,
        detach: false,
        saveLocal: false,
        json: false,
    };
}

// ── Error extraction ──

function extractCleanError(executed: { errors?: string[]; stderr?: string }): string {
    if (executed.errors?.length) {
        return executed.errors.slice(0, 3).join('; ');
    }
    const stderr = executed.stderr?.trim();
    if (stderr) {
        const lines = stderr.split('\n').filter(l => l.trim());
        return lines.slice(-3).join('; ');
    }
    return '';
}

// ── Main ──

export async function runClean(workspace: string, options: { plan?: boolean; json?: boolean } = {}): Promise<CleanResult> {
    const wantsJson = options.json ?? false;
    const targetResult = requireActiveTarget(workspace);

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
    const workroot = resolveWorkroot(workspace);
    const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
    const suppressedWarnings = wsConfig?.qtModulePrefs.suppressedWarnings ?? [];

    // Validate project file exists
    const projectPath = path.isAbsolute(target.project)
        ? target.project
        : path.join(workroot || workspace, target.project);
    if (!fs.existsSync(projectPath)) {
        return {
            ok: false,
            action: 'clean',
            workspace,
            activeTarget: target,
            diagnostics: [diag('error', `${T('cmd.targetProjectMissing')}: ${target.project}`)],
            nextAction: 'forja list targets',
        };
    }

    // --plan + remote: return dry-run info without executing
    if (options.plan && target.runAt === 'remote') {
        const sshCmd = buildRemoteShellCommand(workspace, 'clean');
        return {
            ok: true,
            action: 'clean',
            workspace,
            activeTarget: target,
            plan: {
                mode: 'dryRun',
                commands: [sshCmd],
                shellCommand: sshCmd,
            },
        };
    }

    // Remote execution
    if (target.runAt === 'remote') {
        const remoteResult = await executeRemotePlan({
            workspace,
            target: target.kind,
            action: 'clean',
            json: wantsJson,
            activeProject: target.project,
        });

        return {
            ok: remoteResult.ok,
            action: 'clean',
            workspace,
            activeTarget: target,
            state: remoteResult.ok ? 'cleaned' : undefined,
            exitCode: remoteResult.exitCode,
            diagnostics: remoteResult.ok
                ? undefined
                : remoteResult.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: remoteResult.nextAction,
        };
    }

    // C++ local
    if (target.kind === 'cpp') {
        const vsDevCmdPath = target.toolchain.vsInstall ? resolveVsDevCmdPath(target.toolchain.vsInstall) : null;
        const plan = createCppPlan({
            action: 'clean',
            workspace,
            project: projectPath,
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

        const buildDir = getBuildOutputDir(projectPath, 'cpp');
        if (!hasBuildArtifacts(buildDir)) {
            return {
                ok: true,
                action: 'clean',
                workspace,
                activeTarget: target,
                state: 'already-clean',
            };
        }

        // Pre-kill: terminate running exe before deleting artifacts (Windows file lock)
        const state = readRunState(workspace);
        if (state?.executablePath) {
            const projectBasename = path.basename(target.project, path.extname(target.project));
            const exeBasename = path.basename(state.executablePath, path.extname(state.executablePath));
            if (exeBasename === projectBasename) {
                terminateExecutable(state.executablePath);
            }
        }

        const started = Date.now();
        const executed = await runCliResult(plan, { streaming: !wantsJson, detach: false, suppressedWarnings });
        const durationMs = Date.now() - started;

        const ok = executed.exitCode === 0;
        const changed = ok ? [path.relative(workspace, buildDir) || '.'] : undefined;
        return {
            ok,
            action: 'clean',
            workspace,
            activeTarget: target,
            state: ok ? 'cleaned' : undefined,
            exitCode: executed.exitCode ?? undefined,
            durationMs: executed.durationMs > 0 ? executed.durationMs : durationMs,
            changed,
            diagnostics: ok ? undefined : [diag('error', `${T('cmd.cppCleanFailed')}: ${extractCleanError(executed) || T('unknownError')}`)],
            nextAction: ok ? 'forja build' : 'forja doctor',
        };
    }

    // Qt local
    const qmakeArgs = wsConfig?.qtModulePrefs.qmakeArgs || undefined;
    const rccProjectPath = wsConfig?.qtModulePrefs.rccProjectPath || undefined;

    // Check for artifacts BEFORE building the plan (avoid unnecessary plan construction)
    const buildDir = getBuildOutputDir(projectPath, 'qt');
    if (!options.plan && !hasBuildArtifacts(buildDir)) {
        return {
            ok: true,
            action: 'clean',
            workspace,
            activeTarget: target,
            state: 'already-clean',
        };
    }

    const cliOptions = buildCleanQtCliOptions(workspace, target, options.plan ?? false, qmakeArgs, rccProjectPath);

    try {
        const planned = await createActionPlan(cliOptions);
        if (!planned.ok) {
            const isTargetMissing = planned.diagnostics.some(d => /not found|does not exist|missing/i.test(d.message));
            return {
                ok: false,
                action: 'clean',
                workspace,
                activeTarget: target,
                diagnostics: planned.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
                nextAction: isTargetMissing
                    ? 'forja list targets'
                    : stripJsonFlag(planned.nextAction),
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

        const executed = await runCliResult(planned, { streaming: !wantsJson, detach: false, suppressedWarnings });
        const ok = executed.ok;
        const changed = ok ? [path.relative(workspace, buildDir) || '.'] : undefined;
        return {
            ok,
            action: 'clean',
            workspace,
            activeTarget: target,
            state: ok ? 'cleaned' : undefined,
            exitCode: executed.exitCode ?? undefined,
            durationMs: executed.durationMs > 0 ? executed.durationMs : undefined,
            changed,
            diagnostics: ok ? undefined : [diag('error', `${T('cmd.qtCleanFailed')}: ${extractCleanError(executed) || T('unknownError')}`)],
            nextAction: ok ? 'forja build' : 'forja doctor',
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
        if (result.activeTarget) {
            const t = result.activeTarget;
            if (t.runAt === 'remote' && result.workspace) {
                const remote = loadRemoteSettings(result.workspace);
                const server = remote.selectedServer ? getServerById(remote.selectedServer) : null;
                console.log(T('execRemote', [server?.name || remote.selectedServer || '']));
            } else {
                console.log(T('execLocal'));
            }
            console.log(`  ${T('target')}: ${t.project}`);
            console.log(`  ${T('setupSummaryModeArch')}: ${t.mode} | ${t.arch}`);
        }
        const status = result.ok ? T('cleanSucceeded') : T('cleanFailed');
        console.log(`${T('clean')} ${status}`);
        if (result.state) {
            console.log(`${T('state')}: ${result.state}`);
        }
        if (result.changed?.length) {
            for (const c of result.changed) {
                console.log(`${T('cleaned')}: ${c}`);
            }
        }
        if (result.durationMs) {
            console.log(`${T('duration')}: ${result.durationMs}ms`);
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
