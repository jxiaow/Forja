/**
 * `forja use` — user-facing configuration entry point.
 * Delegates target operations to useTarget/ module.
 */
import * as fs from 'fs';
import { ForjaJsonResult, ActiveTarget, Locale, T, Question } from './types';
import { getActiveTarget, setActiveTarget } from './activeTarget';
import {
    loadQtSettings, saveQtSettings,
    loadSdkSettings, saveSdkSettings,
    loadSyncSettings,
    saveGlobalConfig, loadGlobalConfig,
} from '../../core/settingsIO';
import {
    runUseTarget as runUseTargetNew,
    runSwitchTarget,
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
    sdk?: { configured: boolean; project?: string; mode?: string; arch?: string; vsInstall?: string };
    sync?: { configured: boolean; enabled: boolean; selectedServer?: string; remotePath?: string };
}

// ── Text formatting (for execution/lang) ──

export function formatUseText(result: UseResult, locale: Locale): string {
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
            lines.push(`  ${T('target')}${t.project}`);
            if (t.qtPath) lines.push(`  ${T('setupSummaryQt')}: ${t.qtPath}`);
            if (t.vsInstall) lines.push(`  ${T('setupSummaryVs')}: ${t.vsInstall}`);
            if (t.jomPath) lines.push(`  ${T('init.currentJom')}: ${t.jomPath}`);
            lines.push(`  ${T('setupSummaryModeArch')}: ${t.mode} | ${t.arch}`);
            lines.push(`  ${T('use.execution')}: ${t.runAt}`);
        }
        if (result.nextAction) { lines.push(T('next')); lines.push(`  ${result.nextAction}`); }
        return lines.join('\n');
    }

    const lines: string[] = [];

    if (!result.ok) {
        lines.push(T('error'));
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                lines.push(`  ${d.message}`);
            }
        }
        if (result.nextAction) {
            lines.push(T('next'));
            lines.push(`  ${result.nextAction}`);
        } else if (result.nextActions && (result.nextActions as string[]).length > 0) {
            lines.push(T('next'));
            for (const a of result.nextActions as string[]) { lines.push(`  ${a}`); }
        }
        return lines.join('\n');
    }

    const scope = result.useScope || 'use';
    lines.push(`${scope} ${T('updated')}`);

    if (result.activeTarget) {
        const t = result.activeTarget;
        lines.push(`  ${T('target')} ${t.project} ${t.mode} ${t.arch} ${t.runAt}`);
    }

    if (result.changed && result.changed.length > 0) {
        lines.push(`  ${T('changed')} ${result.changed.join(', ')}`);
    }

    if (result.nextAction) {
        lines.push(T('next'));
        lines.push(`  ${result.nextAction}`);
    } else if (result.nextActions && (result.nextActions as string[]).length > 0) {
        lines.push(T('next'));
        for (const a of result.nextActions as string[]) { lines.push(`  ${a}`); }
    }
    return lines.join('\n');
}

// ── Result interface ──

export interface UseResult extends ForjaJsonResult {
    action: 'use';
    status?: 'needs-input';
    questions?: Question[];
    useScope?: string;
    activeTarget?: ActiveTarget;
    config?: ConfigSummary;
    changed: string[];
    nextActions?: string[];
}

// ── runUseTarget — dispatches to new module ──

export interface UseTargetArgs {
    project?: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    suppressWarnings?: string;
    reset?: boolean;
    interactive?: boolean;
    json?: boolean;
}

export async function runUseTarget(workspace: string, args: UseTargetArgs): Promise<UseResult> {
    // Handle --suppress-warnings (can combine with other flags or standalone)
    if (args.suppressWarnings) {
        const codes = args.suppressWarnings.split(',').map(s => s.trim()).filter(Boolean);
        const qt = loadQtSettings(workspace);
        qt.suppressedWarnings = codes;
        saveQtSettings(workspace, qt);
        // If no other flags, return immediately
        if (!args.project && !args.mode && !args.arch && !args.qtPath && !args.vsInstall && !args.jomPath) {
            return {
                ok: true, action: 'use', useScope: 'target', workspace, changed: ['qt.suppressedWarnings'],
                nextAction: 'forja build',
            };
        }
    }

    // If --project is specified, use the switch path
    if (args.project) {
        return runSwitchTarget(workspace, {
            project: args.project,
            mode: args.mode,
            arch: args.arch,
            interactive: args.interactive,
            json: args.json,
        });
    }

    // If --mode or --arch without --project, update current target
    if (args.mode || args.arch) {
        return runUpdateModeArch(workspace, {
            mode: args.mode,
            arch: args.arch,
        });
    }

    // Toolchain-only update: --qt / --vs / --jom without --project
    if (args.qtPath || args.vsInstall || args.jomPath) {
        return runUpdateToolchain(workspace, {
            qtPath: args.qtPath,
            vsInstall: args.vsInstall,
            jomPath: args.jomPath,
        });
    }

    // No flags: full interactive flow (absorbs setup functionality)
    return runUseTargetNew(workspace, {
        interactive: args.interactive ?? false,
        json: args.json ?? false,
        reset: args.reset ?? false,
    });
}

// ── runUseExecution ──

export function runUseExecution(workspace: string, local: boolean, remote: boolean): UseResult {
    if (local && remote) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.cannotSpecifyBothLocalRemote') }],
            nextAction: 'forja use execution --local',
        };
    }
    if (!local && !remote) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.mustSpecifyLocalOrRemote') }],
            nextAction: 'forja use execution --local',
        };
    }

    const currentTarget = getActiveTarget(workspace);
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const runAt: 'local' | 'remote' = remote ? 'remote' : 'local';
    if (currentTarget.runAt === runAt) {
        return {
            ok: true, action: 'use', useScope: 'execution',
            workspace, activeTarget: currentTarget, changed: [],
            nextAction: 'forja status',
        };
    }

    const updated = { ...currentTarget, runAt };
    try {
        setActiveTarget(workspace, updated);
    } catch (e) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveExecMode')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja use execution --local',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'execution',
        workspace, activeTarget: updated, changed: ['activeTarget.runAt'],
        nextAction: 'forja status',
    };
}

// ── runUseLang ──

export function runUseLang(value: string, locale: Locale): UseResult {
    if (value !== 'zh' && value !== 'en') {
        return {
            ok: false, action: 'use', useScope: 'lang', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidLanguage')}: ${value}. ${T('use.useZhOrEn')}` }],
            nextAction: 'forja use lang zh',
        };
    }
    try {
        saveGlobalConfig({ lang: value });
    } catch (e) {
        return {
            ok: false, action: 'use', useScope: 'lang', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveLanguage')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja use lang zh',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'lang', changed: ['lang'],
    };
}

// ── Show current config (for `forja use` with no subcommand) ──

export function runUseShow(workspace: string): UseResult {
    const target = getActiveTarget(workspace);
    if (!target) {
        return {
            ok: false, action: 'use', useScope: 'show', changed: [],
            diagnostics: [{ level: 'info', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target',
        };
    }

    const qt = loadQtSettings(workspace);
    const sdk = loadSdkSettings(workspace);
    const globalConfig = loadGlobalConfig();

    const lines: string[] = [];
    lines.push(T('setupTitle'));
    lines.push(`  ${T('target')}${target.project}`);
    if (target.qtPath) {
        lines.push(`  ${T('setupSummaryQt')}: ${target.qtPath}`);
    }
    if (target.vsInstall) {
        lines.push(`  ${T('setupSummaryVs')}: ${target.vsInstall}`);
    }
    if (target.jomPath) {
        lines.push(`  ${T('init.currentJom')}: ${target.jomPath}`);
    }
    lines.push(`  ${T('setupSummaryModeArch')}: ${target.mode} | ${target.arch}`);
    lines.push(`  ${T('use.execution')}: ${target.runAt}`);
    lines.push(`  ${T('use.language')}: ${globalConfig.lang || 'en'}`);

    return {
        ok: true, action: 'use', useScope: 'show', changed: [],
        activeTarget: target,
        nextAction: 'forja status',
    };
}
