/**
 * `forja use` — user-facing configuration entry point.
 * Delegates target operations to useTarget/ module.
 */
import { ForjaJsonResult, ActiveTarget, Locale, T, Question } from './types';
import { getActiveTarget } from './activeTarget';
import { resolveWorkroot, loadWorkspaceConfig, saveWorkspaceConfig } from '../../core/workspaceStore';
import {
    runUseTarget as runUseTargetNew,
    runUpdateModeArch,
    runUpdateToolchain,
    formatUseTargetText,
} from './useTarget';
import type { UseTargetResult } from './useTarget';

// Re-export for index.ts
export { formatUseTargetText } from './useTarget';
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
            lines.push(`  ${T('target')}: ${t.project}`);
            if (t.toolchain.qtPath) lines.push(`  ${T('setupSummaryQt')}: ${t.toolchain.qtPath}`);
            if (t.toolchain.vsInstall) lines.push(`  ${T('setupSummaryVs')}: ${t.toolchain.vsInstall}`);
            if (t.toolchain.jomPath) lines.push(`  ${T('init.currentJom')}: ${t.toolchain.jomPath}`);
            lines.push(`  ${T('setupSummaryModeArch')}: ${t.mode} | ${t.arch}`);
        }
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
    qmakeTarget?: string;
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
            qmakeTarget: args.qmakeTarget,
        });
    }
    // If --mode or --arch without --project, update current target
    else if (args.mode || args.arch) {
        result = await runUpdateModeArch(workspace, {
            mode: args.mode,
            arch: args.arch,
        });
    }
    // Toolchain-only update: --qt / --vs / --jom / --qmake-target without --project
    else if (args.qtPath || args.vsInstall || args.jomPath || args.qmakeTarget) {
        result = await runUpdateToolchain(workspace, {
            qtPath: args.qtPath,
            vsInstall: args.vsInstall,
            jomPath: args.jomPath,
            qmakeTarget: args.qmakeTarget,
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

    return result;
}

// ── Show current config (for `forja use` with no subcommand) ──

export function runUseShow(workspace: string): UseResult {
    const target = getActiveTarget(workspace);
    if (!target) {
        return {
            ok: true, action: 'use', useScope: 'show', changed: [],
            diagnostics: [{ level: 'info', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target',
        };
    }

    return {
        ok: true, action: 'use', useScope: 'show', changed: [],
        activeTarget: target,
        nextAction: 'forja status',
    };
}
