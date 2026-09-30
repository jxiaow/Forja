/**
 * `forja use` — user-facing configuration entry point.
 * Delegates target operations to useTarget/ module.
 */
import { ForjaJsonResult, ActiveTarget, Locale, T, Question } from './types';
import { getActiveTarget } from './activeTarget';
import { resolveWorkroot, loadWorkspaceConfig, saveWorkspaceConfig } from '../../core/workspaceStore';
import { loadGlobalConfig, saveGlobalConfig } from '../../core/settingsIO';
import { promptRccProjectPath } from './init';
import { outputResult } from './output';
import {
    extractFlag, findUnknownFlags, unknownFlagsMessage, hasEmptyFlagValue,
    hasFlag, suggestCorrection, KEYWORD_SUGGESTIONS,
} from './args';
import { isRemoteMode, executeRemoteBridgeAction } from './remoteMode';
import { confirm } from './prompt';
import {
    runUseTarget as runUseTargetNew,
    runUpdateModeArch,
    runUpdateToolchain,
    runUpdateBuildScript,
    runRemoveTarget,
    formatUseTargetText,
} from './useTarget';
import type { UseTargetResult } from './useTarget';

// Re-export for index.ts
export { formatUseTargetText, runRemoveTarget } from './useTarget';
export type { UseTargetResult } from './useTarget';

// ── Config summary ──

export interface ConfigSummary {
    qt?: { configured: boolean; project?: string; mode?: string; arch?: string; qtPath?: string; vsInstall?: string; target?: string; qmakeArgs?: string };
    cpp?: { configured: boolean; project?: string; mode?: string; arch?: string; vsInstall?: string };
    sync?: { configured: boolean; enabled: boolean; selectedServer?: string; remotePath?: string };
}

// ── Text formatting ──

export function formatUseText(result: UseResult, _locale: Locale): string {
    // For target scope, delegate to the new formatter
    if (result.useScope === 'target') {
        return formatUseTargetText(result as UseTargetResult);
    }

    // For show scope (no subcommand), display current config
    if (result.useScope === 'show') {
        const lines: string[] = [];
        if (!result.ok) {
            lines.push(T('error'));
            if (result.diagnostics) {
                for (const d of result.diagnostics) { lines.push(`  ${d.message}`); }
            }
            if (result.nextAction) { lines.push(T('next')); lines.push(`  ${result.nextAction}`); }
            return lines.join('\n');
        }
        lines.push(T('setupTitle'));
        if (result.activeTarget) {
            const t = result.activeTarget;
            lines.push(`  ${T('target')}: ${t.buildScript || t.project}`);
            if (t.toolchain.qtPath) lines.push(`  ${T('setupSummaryQt')}: ${t.toolchain.qtPath}`);
            if (t.toolchain.vsInstall) lines.push(`  ${T('setupSummaryVs')}: ${t.toolchain.vsInstall}`);
            if (t.toolchain.jomPath) lines.push(`  ${T('init.currentJom')}: ${t.toolchain.jomPath}`);
            lines.push(`  ${T('setupSummaryModeArch')}: ${t.mode} | ${t.arch}`);
        }
        if (result.rccProjectPath) { lines.push(`  RCC: ${result.rccProjectPath}`); }
        if (result.qmakeArgs) { lines.push(`  ${T('use.qmakeArgsLabel')}: ${result.qmakeArgs}`); }
        if (result.cmakeConfigureArgs && result.cmakeConfigureArgs.length > 0) {
            lines.push(`  ${T('use.cmakeArgsLabel')}: ${result.cmakeConfigureArgs.join(' ')}`);
        }
        if (result.jobs !== undefined) { lines.push(`  ${T('use.globalJobs')}: ${result.jobs}`); }
        if (result.nextAction) { lines.push(T('next')); lines.push(`  ${result.nextAction}`); }
        return lines.join('\n');
    }

    // Fallback for unexpected useScope
    return result.ok ? `${result.useScope || 'use'} ${T('updated')}` : T('error');
}

// ── Result interface ──

export interface UseResult extends ForjaJsonResult {
    action: 'use';
    status?: 'needs-input';
    questions?: Question[];
    useScope?: string;
    activeTarget?: ActiveTarget;
    config?: ConfigSummary;
    changed?: string[];
    rccProjectPath?: string;
    qmakeArgs?: string;
    cmakeConfigureArgs?: string[];
    jobs?: number;
}

// ── runUseTarget — dispatches to new module ──

export interface UseTargetArgs {
    project?: string;
    answers?: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    executableName?: string;
    buildScript?: string;
    rccProjectPath?: string;
    reset?: boolean;
    interactive?: boolean;
    json?: boolean;
}

export function runSuppressWarnings(workspace: string, codes: string[], add: boolean, rm: boolean): UseResult {
    const workroot = resolveWorkroot(workspace);
    if (!workroot) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('notInitialized') }],
            nextAction: 'forja init',
        };
    }
    const config = loadWorkspaceConfig(workroot);
    const current = config.qtModulePrefs.suppressedWarnings ?? [];

    if (!add && !rm && codes.length === 0) {
        return {
            ok: true, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: current.length > 0
                ? [{ level: 'info', message: T('use.suppressedWarningsList', [current.join(', ')]) }]
                : [{ level: 'info', message: T('use.noSuppressedWarnings') }],
            nextAction: 'forja use target suppress-warnings --add <code>',
        };
    }

    let updated: string[];
    if (add) {
        const set = new Set(current);
        for (const c of codes) set.add(c);
        updated = [...set];
    } else if (rm) {
        const toRemove = new Set(codes);
        updated = current.filter(c => !toRemove.has(c));
    } else {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('use.suppressWarningsRequiresFlag') }],
            nextAction: 'forja use target suppress-warnings --add <code>',
        };
    }

    config.qtModulePrefs.suppressedWarnings = updated;
    try {
        saveWorkspaceConfig(config);
    } catch (e) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja status',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'target', workspace, changed: ['qt.suppressedWarnings'],
        nextAction: 'forja build',
    };
}

export function runQmakeArgs(workspace: string, args: string[], add: boolean, rm: boolean): UseResult {
    const workroot = resolveWorkroot(workspace);
    if (!workroot) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('notInitialized') }],
            nextAction: 'forja init',
        };
    }

    if (add && rm) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('use.qmakeArgsConflictFlags') }],
            nextAction: 'forja use target qmake-args',
        };
    }

    if ((add || rm) && args.length === 0) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('use.qmakeArgsMissingValues') }],
            nextAction: 'forja use target qmake-args --add <args>',
        };
    }

    const config = loadWorkspaceConfig(workroot);
    const current = (config.qtModulePrefs.qmakeArgs || '').trim();
    const currentTokens = current ? current.split(/\s+/) : [];

    if (!add && !rm) {
        return {
            ok: true, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: currentTokens.length > 0
                ? [{ level: 'info', message: T('use.qmakeArgsList', [currentTokens.join(' ')]) }]
                : [{ level: 'info', message: T('use.noQmakeArgs') }],
            nextAction: 'forja use target qmake-args --add <args>',
        };
    }

    let updated: string[];
    if (add) {
        const set = new Set(currentTokens);
        for (const a of args) set.add(a);
        updated = [...set];
    } else {
        const toRemove = new Set(args);
        updated = currentTokens.filter(t => !toRemove.has(t));
    }

    config.qtModulePrefs.qmakeArgs = updated.join(' ');
    try {
        saveWorkspaceConfig(config);
    } catch (e) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja status',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'target', workspace, changed: ['qt.qmakeArgs'],
        nextAction: 'forja build',
    };
}

export function runCMakeArgs(workspace: string, args: string[], add: boolean, rm: boolean): UseResult {
    const workroot = resolveWorkroot(workspace);
    if (!workroot) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('notInitialized') }],
            nextAction: 'forja init',
        };
    }

    if (add && rm) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('use.cmakeArgsConflictFlags') }],
            nextAction: 'forja use target cmake-args',
        };
    }

    if ((add || rm) && args.length === 0) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: T('use.cmakeArgsMissingValues') }],
            nextAction: 'forja use target cmake-args --add <args>',
        };
    }

    const config = loadWorkspaceConfig(workroot);
    const current = [...(config.cppModulePrefs.cmakeConfigureArgs ?? [])];

    if (!add && !rm) {
        return {
            ok: true, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: current.length > 0
                ? [{ level: 'info', message: T('use.cmakeArgsList', [current.join(' ')]) }]
                : [{ level: 'info', message: T('use.noCMakeArgs') }],
            nextAction: 'forja use target cmake-args --add <args>',
        };
    }

    let updated: string[];
    if (add) {
        const set = new Set(current);
        for (const a of args) set.add(a);
        updated = [...set];
    } else {
        const toRemove = new Set(args);
        updated = current.filter(t => !toRemove.has(t));
    }

    config.cppModulePrefs.cmakeConfigureArgs = updated;
    try {
        saveWorkspaceConfig(config);
    } catch (e) {
        return {
            ok: false, action: 'use', useScope: 'target', workspace, changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja status',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'target', workspace, changed: ['cpp.cmakeConfigureArgs'],
        nextAction: 'forja build',
    };
}

export async function runUseTarget(workspace: string, args: UseTargetArgs): Promise<UseResult> {
    let result: UseResult | undefined;

    // A project selection always uses the resolver so every explicitly supplied
    // toolchain field is saved and a new project cannot inherit the active one.
    if (args.project) {
        result = await runUseTargetNew(workspace, {
            interactive: args.interactive ?? false,
            json: args.json ?? false,
            reset: args.reset ?? false,
            project: args.project,
            answers: args.answers,
            mode: args.mode,
            arch: args.arch,
            qtPath: args.qtPath,
            vsInstall: args.vsInstall,
            jomPath: args.jomPath,
            executableName: args.executableName,
            buildScript: args.buildScript,
        });
    }
    // --build-script without --project: update active target's build script
    else if (args.buildScript !== undefined) {
        result = await runUpdateBuildScript(workspace, {
            buildScript: args.buildScript,
        });
    }
    // --rcc without --project: update RCC path only
    else if (args.rccProjectPath !== undefined) {
        const workroot = resolveWorkroot(workspace);
        if (!workroot) {
            result = {
                ok: false, action: 'use', useScope: 'target', workspace, changed: [],
                diagnostics: [{ level: 'error', message: T('notInitialized') }],
                nextAction: 'forja init',
            };
        } else {
            const config = loadWorkspaceConfig(workroot);
            config.qtModulePrefs.rccProjectPath = args.rccProjectPath || '';
            try {
                saveWorkspaceConfig(config);
                result = {
                    ok: true, action: 'use', useScope: 'target', workspace, changed: ['qt.rccProjectPath'],
                    nextAction: 'forja build',
                };
            } catch (e) {
                result = {
                    ok: false, action: 'use', useScope: 'target', workspace, changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` }],
                    nextAction: 'forja status',
                };
            }
        }
    }
    // If --mode or --arch without --project, update current target
    else if (args.mode || args.arch) {
        result = await runUpdateModeArch(workspace, {
            mode: args.mode,
            arch: args.arch,
        });
    }
    // Toolchain-only update: --qt / --vs / --jom / --executable-name without --project
    else if (args.qtPath || args.vsInstall || args.jomPath || args.executableName !== undefined) {
        result = await runUpdateToolchain(workspace, {
            qtPath: args.qtPath,
            vsInstall: args.vsInstall,
            jomPath: args.jomPath,
            executableName: args.executableName,
        });
    }
    // No flags: interactive picker if saved targets exist, otherwise full flow
    else {
        const workroot = resolveWorkroot(workspace);
        if (workroot && args.interactive === true && !args.json) {
            const wsConfig = loadWorkspaceConfig(workroot);
            const savedTargets = Object.values(wsConfig.targets);
            if (savedTargets.length > 0) {
                const { choose } = await import('./prompt');
                const { T: tr } = await import('./types');
                const ADD_NEW = '__add_new__';
                interface PickerItem { value: string; label: string }
                const items: PickerItem[] = savedTargets.map(t => ({
                    value: t.id,
                    label: `${t.id === wsConfig.activeTarget ? '* ' : '  '}${t.id}  ${t.name}  [${t.kind}] ${t.mode}|${t.arch}`,
                }));
                items.push({ value: ADD_NEW, label: tr('use.addNewTarget') });

                const chosen = await choose(tr('use.selectTarget'), items, item => item.label);
                if (chosen && chosen.value !== ADD_NEW) {
                    result = await runUseTargetNew(workspace, {
                        project: chosen.value,
                        interactive: true,
                        json: false,
                        reset: false,
                    });
                    // A saved target was selected; skip the full target flow.
                }
                // User chose "add new" or cancelled — fall through to full flow
            }
        }

        // If result not set by interactive picker, run full flow
        if (!result) {
            result = await runUseTargetNew(workspace, {
                interactive: args.interactive ?? false,
                json: args.json ?? false,
                reset: args.reset ?? false,
            });
        }
    }

    // RCC project path update (flag or interactive prompt)
    // Only runs after --project flow (standalone --rcc is handled by its own branch above)
    // Interactive prompt only when no specific flag was given (avoid prompting after --mode/--build-script etc.)
    const hasSpecificFlag = args.mode || args.arch || args.qtPath || args.vsInstall || args.jomPath || args.executableName !== undefined || args.buildScript !== undefined;
    if (result?.ok && args.project) {
        const workroot = resolveWorkroot(workspace);
        if (workroot) {
            let rccPath: string | undefined | null = null; // null = no change

            if (args.rccProjectPath !== undefined) {
                // Explicit flag
                rccPath = args.rccProjectPath || '';
            } else if (args.interactive && !args.json && !hasSpecificFlag) {
                const activeTarget = getActiveTarget(workspace);
                if (activeTarget?.kind === 'qt') {
                    const config = loadWorkspaceConfig(workroot);
                    const current = config.qtModulePrefs.rccProjectPath || '';
                    rccPath = await promptRccProjectPath(workroot, true, undefined, current) ?? null;
                }
            }

            if (rccPath !== null) {
                const config = loadWorkspaceConfig(workroot);
                config.qtModulePrefs.rccProjectPath = rccPath;
                try {
                    saveWorkspaceConfig(config);
                    result.changed = [...(result.changed || []), 'qt.rccProjectPath'];
                } catch (e) {
                    result.diagnostics = result.diagnostics || [];
                    result.diagnostics.push({ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` });
                }
            }
        }
    }

    return result;
}

// ── Show current config (for `forja use` with no subcommand) ──

export function runUseShow(workspace: string): UseResult {
    const target = getActiveTarget(workspace);
    const globalJobs = loadGlobalConfig().jobs;
    if (!target) {
        return {
            ok: true, action: 'use', useScope: 'show', changed: [],
            diagnostics: [{ level: 'info', message: T('use.noActiveTargetSelected') }],
            jobs: globalJobs,
            nextAction: 'forja use target',
        };
    }

    const result: UseResult = {
        ok: true, action: 'use', useScope: 'show', changed: [],
        activeTarget: target,
        jobs: globalJobs,
        nextAction: 'forja status',
    };

    if (target.kind === 'qt') {
        const workroot = resolveWorkroot(workspace);
        if (workroot) {
            const wsConfig = loadWorkspaceConfig(workroot);
            if (wsConfig.qtModulePrefs.rccProjectPath) {
                result.rccProjectPath = wsConfig.qtModulePrefs.rccProjectPath;
            }
            if (wsConfig.qtModulePrefs.qmakeArgs) {
                result.qmakeArgs = wsConfig.qtModulePrefs.qmakeArgs;
            }
        }
    }

    if (target.kind === 'cpp') {
        const workroot = resolveWorkroot(workspace);
        if (workroot) {
            const wsConfig = loadWorkspaceConfig(workroot);
            if (wsConfig.cppModulePrefs.cmakeConfigureArgs.length > 0) {
                result.cmakeConfigureArgs = [...wsConfig.cppModulePrefs.cmakeConfigureArgs];
            }
        }
    }

    return result;
}

// ── Use ──

export async function handleUse(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    // Remote mode — bridge use to remote
    if (isRemoteMode(workroot) && subCmd) {
        const extraArgs = argv.slice(1);
        await executeRemoteBridgeAction(workroot, 'use', extraArgs, wantsJson);
        return;
    }

    // Per-subcommand flag validation
    switch (subCmd) {
        case 'target': {
            if (argv[2] === 'suppress-warnings') {
                const swKnown = new Set(['--add', '--rm']);
                const swUnknown = findUnknownFlags(argv.slice(2), swKnown, new Set<string>());
                if (swUnknown.length > 0) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(swUnknown, swKnown) }], nextAction: 'forja use target suppress-warnings' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const add = hasFlag(argv, '--add');
                const rm = hasFlag(argv, '--rm');
                const codes = argv.slice(3).filter(a => !a.startsWith('--'));
                const result = runSuppressWarnings(workroot, codes, add, rm);
                outputResult(result, wantsJson, (r) => formatUseText(r, locale));
                return;
            }
            if (argv[2] === 'qmake-args') {
                const qaKnown = new Set(['--add', '--rm']);
                const qaUnknown = findUnknownFlags(argv.slice(2), qaKnown, new Set<string>());
                if (qaUnknown.length > 0) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(qaUnknown, qaKnown) }], nextAction: 'forja use target qmake-args' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const add = hasFlag(argv, '--add');
                const rm = hasFlag(argv, '--rm');
                const qaArgs = argv.slice(3).filter(a => !a.startsWith('--'));
                const result = runQmakeArgs(workroot, qaArgs, add, rm);
                outputResult(result, wantsJson, (r) => formatUseText(r, locale));
                return;
            }
            if (argv[2] === 'cmake-args') {
                const caKnown = new Set(['--add', '--rm']);
                const caUnknown = findUnknownFlags(argv.slice(2), caKnown, new Set<string>());
                if (caUnknown.length > 0) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(caUnknown, caKnown) }], nextAction: 'forja use target cmake-args' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const add = hasFlag(argv, '--add');
                const rm = hasFlag(argv, '--rm');
                const caArgs = argv.slice(3).filter(a => !a.startsWith('--'));
                const result = runCMakeArgs(workroot, caArgs, add, rm);
                outputResult(result, wantsJson, (r) => formatUseText(r, locale));
                return;
            }
            if (argv[2] === 'remove') {
                const rmKnown = new Set(['--force']);
                const rmUnknown = findUnknownFlags(argv.slice(2), rmKnown, new Set<string>());
                if (rmUnknown.length > 0) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(rmUnknown, rmKnown) }], nextAction: 'forja use target remove' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const wsConfig = loadWorkspaceConfig(workroot);
                const savedTargets = Object.values(wsConfig.targets);
                if (savedTargets.length === 0) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: T('use.noTargetsToRemove') }], nextAction: 'forja init' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                let targetId = argv[3] && !argv[3].startsWith('--') ? argv[3] : '';
                if (!targetId) {
                    if (!wantsJson) {
                        const { chooseRequired } = await import('./prompt');
                        const chosen = await chooseRequired(
                            T('use.selectTarget'),
                            savedTargets,
                            t => `${t.id}  ${t.name}  [${t.kind}] ${t.mode}|${t.arch}`,
                        );
                        if (!chosen) {
                            outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'info', message: T('cancelled') }] }, wantsJson);
                            return;
                        }
                        targetId = chosen.id;
                    } else {
                        outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: `${T('use.targetNotFound')}: forja use target remove <id>` }], nextAction: 'forja list targets --json' }, wantsJson);
                        process.exitCode = 1;
                        return;
                    }
                }
                if (!wsConfig.targets[targetId]) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: T('use.targetNotFound', [targetId]) }], nextAction: 'forja list targets' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const forceFlag = hasFlag(argv, '--force');
                if (!wantsJson && !forceFlag) {
                    const yes = await confirm(T('confirmRemoveTarget', [targetId]), false);
                    if (!yes) {
                        outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'info', message: T('cancelled') }] }, wantsJson);
                        return;
                    }
                } else if (wantsJson && !forceFlag) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: T('destructiveRequiresForce') }], nextAction: `forja use target remove ${targetId} --force` }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const removeResult = runRemoveTarget(workroot, targetId);
                outputResult(removeResult, wantsJson, (r) => formatUseText(r, locale));
                return;
            }
            const targetKnown = new Set(['--project', '--answers', '--mode', '--arch', '--qt', '--vs', '--jom', '--executable-name', '--reset', '--build-script', '--rcc']);
            const targetWithVal = new Set(['--project', '--answers', '--mode', '--arch', '--qt', '--vs', '--jom', '--executable-name', '--build-script', '--rcc']);
            const targetUnknown = findUnknownFlags(argv, targetKnown, targetWithVal, {
                allowEmptyValues: new Set(['--build-script', '--executable-name']),
            });
            if (targetUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(targetUnknown, targetKnown) }], nextAction: 'forja use target' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // Check for empty flag values (--build-script allows empty to clear)
            const emptyFlags = ['--project', '--answers', '--mode', '--arch', '--qt', '--vs', '--jom'];
            for (const f of emptyFlags) {
                if (hasEmptyFlagValue(argv, f)) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: `${f} requires a non-empty value` }], nextAction: 'forja use target' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
            }
            const result = await runUseTarget(workroot, {
                project: extractFlag(argv, '--project') || (argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined),
                answers: extractFlag(argv, '--answers'),
                mode: extractFlag(argv, '--mode') as 'debug' | 'release' | undefined,
                arch: extractFlag(argv, '--arch') as 'x86' | 'x64' | undefined,
                qtPath: extractFlag(argv, '--qt'),
                vsInstall: extractFlag(argv, '--vs'),
                jomPath: extractFlag(argv, '--jom'),
                executableName: extractFlag(argv, '--executable-name', { allowEmpty: true }),
                buildScript: extractFlag(argv, '--build-script', { allowEmpty: true }),
                rccProjectPath: extractFlag(argv, '--rcc'),
                reset: hasFlag(argv, '--reset'),
                interactive: !wantsJson,
                json: wantsJson,
            });
            outputResult(result, wantsJson, (r) => formatUseText(r, locale));
            return;
        }
        default: {
            if (subCmd !== '') {
                const USE_SUBCOMMANDS = ['target'];
                const keywordEntry = KEYWORD_SUGGESTIONS['use']?.[subCmd];
                const keywordHint = keywordEntry ? `${keywordEntry.hint} ${keywordEntry.params.map(p => `[${p}]`).join(' ')}` : undefined;
                const substringHint = suggestCorrection(subCmd, USE_SUBCOMMANDS);
                const fallbackHint = substringHint ? `forja use ${substringHint}` : undefined;
                const hint = keywordHint || fallbackHint;
                const msg = hint
                    ? `${T('idx.unknownUseSubcommand')}: ${subCmd}. ${T('idx.didYouMean')}: ${hint}?`
                    : `${T('idx.unknownUseSubcommand')}: ${subCmd}`;
                const nextAction = keywordEntry ? keywordEntry.next : (hint || 'forja use target');
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: msg }], nextAction }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // No subcommand — handle global flags or show current config
            const globalKnown = new Set(['--jobs', '--rcc']);
            const globalWithVal = new Set(['--jobs', '--rcc']);
            const showUnknown = findUnknownFlags(argv, globalKnown, globalWithVal, {
                allowEmptyValues: new Set(['--jobs']),
            });
            if (showUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(showUnknown, globalKnown) }], nextAction: 'forja use' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // --jobs: persist global parallel build setting
            const jobsRaw = extractFlag(argv, '--jobs', { allowEmpty: true });
            if (jobsRaw !== undefined) {
                if (jobsRaw === '') {
                    saveGlobalConfig({ jobs: undefined });
                    outputResult({ ok: true, action: 'use', useScope: 'global', changed: ['jobs'], nextAction: 'forja build' }, wantsJson, (r) => T('use.jobsCleared'));
                    return;
                }
                const jobsNum = parseInt(jobsRaw, 10);
                if (isNaN(jobsNum) || jobsNum < 1) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: T('use.jobsRequiresPositive') }], nextAction: 'forja use --jobs <N>' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                saveGlobalConfig({ jobs: jobsNum });
                outputResult({ ok: true, action: 'use', useScope: 'global', changed: ['jobs'], jobs: jobsNum, nextAction: 'forja build' }, wantsJson, (r) => T('use.jobsSet', [String(jobsNum)]));
                return;
            }
            // --rcc: update RCC project path
            const rccRaw = extractFlag(argv, '--rcc');
            if (rccRaw !== undefined) {
                const useResult = await runUseTarget(workroot, {
                    rccProjectPath: rccRaw,
                    interactive: !wantsJson,
                    json: wantsJson,
                });
                outputResult(useResult, wantsJson, (r) => formatUseText(r, locale));
                return;
            }
            const result = runUseShow(workroot);
            outputResult(result, wantsJson, (r) => formatUseText(r, locale));
        }
    }
}
