/**
 * `forja use` — user-facing configuration entry point.
 * Selects targets, build config, and execution endpoint.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ForjaJsonResult, ActiveTarget, Locale, T } from './types';
import { getActiveTarget, setActiveTarget } from './activeTarget';
import {
    loadQtSettings, saveQtSettings,
    loadSdkSettings, saveSdkSettings,
    loadSyncSettings,
    saveGlobalConfig,
} from '../../core/settingsIO';
import { collectTargetCandidates } from './candidates';
import { detectProjectType } from '../../core/projectTypeDetector';

// Helper to safely save settings and return error result on failure
function safeSave(fn: () => void, configName: string): { ok: true } | { ok: false; error: string } {
    try {
        fn();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: `${T('cmd.failedToSave')} ${configName}: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// ── Config summary ──

export interface ConfigSummary {
    qt?: { configured: boolean; project?: string; mode?: string; arch?: string; qtPath?: string; vsInstall?: string; target?: string; qmakeArgs?: string };
    sdk?: { configured: boolean; project?: string; mode?: string; arch?: string; vsInstall?: string };
    sync?: { configured: boolean; enabled: boolean; selectedServer?: string; remotePath?: string };
}

function buildConfigSummary(workspace: string, scope: string, target?: ActiveTarget): ConfigSummary | undefined {
    switch (scope) {
        case 'target':
        case 'qt': {
            if (target?.kind === 'qt') {
                const qt = loadQtSettings(workspace);
                return { qt: { configured: true, project: qt.pinnedProject?.relative, mode: qt.mode, arch: qt.arch, qtPath: qt.qtPath, vsInstall: qt.vsInstall, target: qt.target, qmakeArgs: qt.qmakeArgs } };
            }
            if (target?.kind === 'sdk') {
                const sdk = loadSdkSettings(workspace);
                return { sdk: { configured: true, project: sdk.pinnedProject ?? undefined, mode: sdk.mode, arch: sdk.arch, vsInstall: sdk.vsInstall } };
            }
            return undefined;
        }
        case 'sync': {
            const sync = loadSyncSettings(workspace);
            const hasConfig = !!(sync.selectedServer || sync.enabled);
            return { sync: { configured: hasConfig, enabled: sync.enabled, selectedServer: sync.selectedServer, remotePath: sync.selectedServer ? sync.remotePaths[sync.selectedServer] : undefined } };
        }
        default:
            return undefined;
    }
}

// ── Text formatting ──

export function formatUseText(result: UseResult, locale: Locale): string {
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
    useScope?: string;  // 'target' | 'execution' | 'lang'
    activeTarget?: ActiveTarget;
    config?: ConfigSummary;
    changed: string[];
}

// ── Helpers for runUseTarget ──

function resolveProjectPath(workspace: string, projectInput: string): { resolvedPath: string; matchedCandidate?: { label: string; project: string } } | { error: UseResult } {
    const projectPath = path.isAbsolute(projectInput) ? projectInput : path.join(workspace, projectInput);

    if (fs.existsSync(projectPath) && !fs.statSync(projectPath).isDirectory()) {
        return { resolvedPath: projectInput };
    }

    const candidates = collectTargetCandidates(workspace);
    const inputLower = path.basename(projectInput).toLowerCase();
    const matches = candidates.filter(c => c.label.toLowerCase() === inputLower);

    if (matches.length === 1) {
        return { resolvedPath: matches[0].project, matchedCandidate: matches[0] };
    }
    if (matches.length > 1) {
        return {
            error: {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${projectInput}. ${T('idx.didYouMean')}: ${matches.map(m => m.project).join(', ')}?` }],
                nextActions: matches.map(m => `forja use target --project ${m.project}`),
            },
        };
    }

    return {
        error: {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${projectInput}` }],
            nextAction: 'forja list targets',
        },
    };
}

function inferKind(filePath: string): 'qt' | 'sdk' | null {
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    
    // Quick check for supported file types
    if (ext !== '.pro' && ext !== '.sln' && base !== 'makefile' && base !== 'cmakelists.txt') {
        return null;
    }
    
    // Use auto-detection to determine if it's a Qt project
    const typeInfo = detectProjectType(filePath);
    return typeInfo.usesQt ? 'qt' : 'sdk';
}

function saveDomainConfig(workspace: string, kind: 'qt' | 'sdk', finalPath: string, mode: 'debug' | 'release', arch: 'x86' | 'x64'): { ok: true } | { ok: false; error: string } {
    const relativeProject = path.relative(workspace, finalPath).replace(/\\/g, '/');
    if (kind === 'qt') {
        const qt = loadQtSettings(workspace);
        qt.pinnedProject = { root: workspace, relative: relativeProject };
        qt.mode = mode;
        qt.arch = arch;
        return safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
    }
    const sdk = loadSdkSettings(workspace);
    sdk.pinnedProject = relativeProject;
    sdk.mode = mode;
    sdk.arch = arch;
    return safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
}

function updateDomainModeArch(workspace: string, kind: 'qt' | 'sdk', mode?: 'debug' | 'release', arch?: 'x86' | 'x64'): { ok: true } | { ok: false; error: string } {
    if (kind === 'qt') {
        const qt = loadQtSettings(workspace);
        if (mode) { qt.mode = mode; }
        if (arch) { qt.arch = arch; }
        return safeSave(() => saveQtSettings(workspace, qt), 'Qt settings');
    }
    const sdk = loadSdkSettings(workspace);
    if (mode) { sdk.mode = mode; }
    if (arch) { sdk.arch = arch; }
    return safeSave(() => saveSdkSettings(workspace, sdk), 'SDK settings');
}

// ── runUseTarget ──

export interface UseTargetArgs {
    project?: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
}

export function runUseTarget(workspace: string, args: UseTargetArgs): UseResult {
    const changed: string[] = [];

    if (!fs.existsSync(workspace)) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.workspaceNotFound')}: ${workspace}` }],
        };
    }

    if (args.mode && args.mode !== 'debug' && args.mode !== 'release') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidMode')}: ${args.mode}. ${T('use.invalidModeDetail')}` }],
            nextAction: 'forja use target --mode debug',
        };
    }

    if (args.arch && args.arch !== 'x86' && args.arch !== 'x64') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidArch')}: ${args.arch}. ${T('use.invalidArchDetail')}` }],
            nextAction: 'forja use target --arch x64',
        };
    }

    const currentTarget = getActiveTarget(workspace);

    // --project: select or switch target
    if (args.project) {
        const resolveResult = resolveProjectPath(workspace, args.project);
        if ('error' in resolveResult) { return resolveResult.error; }

        const { resolvedPath, matchedCandidate } = resolveResult;
        const finalPath = path.isAbsolute(resolvedPath) ? resolvedPath : path.join(workspace, resolvedPath);

        if (!fs.existsSync(finalPath)) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${args.project}` }],
                nextAction: 'forja list targets',
            };
        }

        // Reject relative paths that escape the workspace boundary
        if (!path.isAbsolute(resolvedPath)) {
            const resolved = path.join(workspace, resolvedPath);
            const relCheck = path.relative(workspace, resolved);
            if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
                return {
                    ok: false, action: 'use', useScope: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.projectOutsideWorkspace')}: ${args.project}` }],
                    nextAction: 'forja list targets',
                };
            }
        }

        // Infer kind from the resolved file path (not the original user input)
        const kind = inferKind(finalPath);
        if (!kind) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.cannotDetermineKind')}: ${finalPath}. ${T('use.expectedExtensions')}` }],
                nextAction: 'forja list targets',
            };
        }

        const mode = args.mode ?? currentTarget?.mode ?? 'debug';
        const arch = args.arch ?? currentTarget?.arch ?? (process.platform === 'win32' ? 'x86' : 'x64');
        const runAt = currentTarget?.runAt ?? 'local';

        const newTarget: ActiveTarget = { kind, project: resolvedPath, mode, arch, runAt };

        const domainSave = saveDomainConfig(workspace, kind, finalPath, mode, arch);
        if (!domainSave.ok) {
            return { ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: domainSave.error }],
                nextAction: 'forja doctor' };
        }
        changed.push(kind === 'qt' ? 'qt.pinnedProject' : 'sdk.pinnedProject');

        try {
            setActiveTarget(workspace, newTarget);
        } catch (e) {
            return { ok: false, action: 'use', useScope: 'target', changed,
                diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${e instanceof Error ? e.message : e}` }],
                nextAction: 'forja doctor' };
        }
        changed.push('activeTarget');

        return {
            ok: true, action: 'use', useScope: 'target',
            workspace, activeTarget: newTarget,
            config: buildConfigSummary(workspace, 'target', newTarget),
            changed,
            nextAction: 'forja status',
        };
    }

    // --mode / --arch without --project: update current target
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const updated = { ...currentTarget };
    if (args.mode && args.mode !== currentTarget.mode) { updated.mode = args.mode; changed.push('activeTarget.mode'); }
    if (args.arch && args.arch !== currentTarget.arch) { updated.arch = args.arch; changed.push('activeTarget.arch'); }

    if (changed.length > 0) {
        const domainSave = updateDomainModeArch(workspace, updated.kind,
            args.mode && args.mode !== currentTarget.mode ? args.mode : undefined,
            args.arch && args.arch !== currentTarget.arch ? args.arch : undefined);
        if (!domainSave.ok) {
            return { ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: domainSave.error }],
                nextAction: 'forja doctor' };
        }
        try {
            setActiveTarget(workspace, updated);
        } catch (e) {
            return { ok: false, action: 'use', useScope: 'target', changed,
                diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${e instanceof Error ? e.message : e}` }],
                nextAction: 'forja doctor' };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'target',
        workspace, activeTarget: updated,
        config: buildConfigSummary(workspace, 'target', updated),
        changed,
        nextAction: 'forja status',
    };
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
    const saveResult = safeSave(() => setActiveTarget(workspace, updated), 'Active target');
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useScope: 'execution', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveExecMode')}: ${saveResult.error}` }],
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
    const saveResult = safeSave(() => saveGlobalConfig({ lang: value }), 'Global config');
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useScope: 'lang', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveLanguage')}: ${saveResult.error}` }],
            nextAction: 'forja use lang zh',
        };
    }
    return {
        ok: true, action: 'use', useScope: 'lang', changed: ['lang'],
    };
}
