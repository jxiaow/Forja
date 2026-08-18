/**
 * useTarget/index — entry point for `forja use target`.
 * Orchestrates: detect → resolve → save → report.
 */
import * as fs from 'fs';
import * as path from 'path';
import { T, Diagnostic } from '../types';
import {
    loadWorkspaceConfig,
    normalizePath,
    resolveWorkroot,
    saveWorkspaceConfig,
    type TargetProfile,
} from '../../../core/workspaceStore';
import { detectContext } from './detect';
import { resolveAll } from './resolve';
import { saveAll } from './save';
import { buildSuccessResult } from './report';
import type { ResolveOptions, UseTargetResult } from './types';
import { detectEnv } from '../../../qt/env/envDetector';
import { setSilent } from '../../../core/loggerBase';

function quoteCliArg(value: string): string {
    return /\s/.test(value) ? `"${value.replace(/(["\\$`])/g, '\\$1')}"` : value;
}

function validateBuildScript(workspace: string, kind: TargetProfile['kind'], buildScript: string): string | undefined {
    if (kind !== 'cpp') return T('use.buildScriptCppOnly');
    const extension = path.extname(buildScript).toLowerCase();
    if (extension !== '.sh' && extension !== '.bat') return T('use.buildScriptUnsupportedExtension');
    const workroot = resolveWorkroot(workspace);
    const absolutePath = path.isAbsolute(buildScript)
        ? buildScript
        : path.join(workroot || workspace, buildScript);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        return `${T('init.projectNotFound')}: ${buildScript}`;
    }
    return undefined;
}

// ── Main entry ──

/** Entry options — answers is a file path string, resolved to Record internally */
export interface UseTargetEntryOptions {
    interactive: boolean;
    json: boolean;
    reset: boolean;
    project?: string;
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    qmakeTarget?: string;
    executableName?: string;
    buildScript?: string;
    mode?: string;
    arch?: string;
    answers?: string;  // file path
}

export async function runUseTarget(workspace: string, options: UseTargetEntryOptions): Promise<UseTargetResult> {
    // Validate workspace
    if (!fs.existsSync(workspace)) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.workspaceNotFound')}: ${workspace}` }],
        };
    }

    // Validate flags
    if (options.mode && options.mode !== 'debug' && options.mode !== 'release') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidMode')}: ${options.mode}` }],
            nextAction: 'forja use target --mode debug',
        };
    }
    if (options.arch && options.arch !== 'x86' && options.arch !== 'x64') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidArch')}: ${options.arch}` }],
            nextAction: 'forja use target --arch x64',
        };
    }

    if (options.project && !options.answers && !options.mode && !options.arch
        && !options.qtPath && !options.vsInstall && !options.jomPath && !options.qmakeTarget
        && options.executableName === undefined && options.buildScript === undefined) {
        const workroot = resolveWorkroot(workspace);
        if (workroot) {
            const workspaceConfig = loadWorkspaceConfig(workroot);
            const savedTargets = Object.values(workspaceConfig.targets);
            const expectedProjectPath = normalizePath(path.resolve(workroot, options.project));
            const exactProjectMatches = savedTargets.filter(target =>
                normalizePath(path.resolve(workroot, target.project)) === expectedProjectPath
            );
            const matchingTargets = exactProjectMatches.length > 0
                ? exactProjectMatches
                : savedTargets.filter(target => target.id === options.project);
            if (matchingTargets.length === 1) {
                const target = matchingTargets[0];
                workspaceConfig.activeTarget = target.id;
                try {
                    saveWorkspaceConfig(workspaceConfig);
                } catch (e) {
                    return {
                        ok: false, action: 'use', useScope: 'target', changed: [],
                        diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` }],
                        nextAction: 'forja status',
                    };
                }
                return {
                    ok: true, action: 'use', useScope: 'target', workspace,
                    activeTarget: target, changed: ['activeTarget'],
                    nextAction: 'forja status',
                };
            }
        }
    }

    // Load answers if provided
    let parsedAnswers: Record<string, string> | undefined;
    if (options.answers) {
        try {
            const raw = fs.readFileSync(options.answers, 'utf8');
            parsedAnswers = JSON.parse(raw);
        } catch {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('setupAnswersLoadFailed')}: ${options.answers}` }],
            };
        }
    }
    const resolveOpts: ResolveOptions = {
        interactive: options.interactive,
        json: options.json,
        reset: options.reset,
        project: options.project,
        qtPath: options.qtPath,
        vsInstall: options.vsInstall,
        jomPath: options.jomPath,
        qmakeTarget: options.qmakeTarget,
        executableName: options.executableName,
        buildScript: options.buildScript,
        mode: options.mode,
        arch: options.arch,
        answers: parsedAnswers,
    };

    // Phase 1: Detect
    const ctx = await detectContext(workspace);

    // Phase 2: Resolve
    const resolved = await resolveAll(ctx, resolveOpts);

    if (resolved.questions) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            status: 'needs-input',
            questions: resolved.questions,
            diagnostics: resolved.diagnostics as Diagnostic[],
            nextAction: options.project
                ? `forja use target --project ${quoteCliArg(options.project)} --answers <answers.json>`
                : 'forja use target --answers <answers.json>',
        };
    }

    if (!resolved.config) {
        // No target resolved (ambiguous or no candidates)
        const diags = (resolved.diagnostics || []) as Diagnostic[];
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: diags.length > 0 ? diags : [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja list targets',
        };
    }

    if (resolved.config.buildScript) {
        const validationError = validateBuildScript(workspace, resolved.config.kind, resolved.config.buildScript);
        if (validationError) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: validationError }],
                nextAction: 'forja use target --build-script <path>',
            };
        }
    }

    // Phase 3: Save
    const saveResult = saveAll(workspace, resolved.config);
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${saveResult.error}` }],
            nextAction: 'forja status',
        };
    }

    // Phase 4: Report — use resolved versions
    const config = resolved.config;
    const toolchain = { ...ctx.toolchain };
    if (config.qtVersion) toolchain.qtVersion = config.qtVersion;
    if (config.vsInstall) {
        const match = toolchain.vsCandidates.find(v => v.installPath === config.vsInstall);
        if (match) { toolchain.vsVersion = match.version; }
    }
    return buildSuccessResult(config, toolchain, saveResult.changed, workspace, saveResult.targetId);
}

// ── Update mode/arch only ──

export async function runUpdateModeArch(workspace: string, args: {
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
}): Promise<UseTargetResult> {
    const { setActiveTarget, getActiveTarget } = await import('../activeTarget');
    const currentTarget = getActiveTarget(workspace);
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    // Validate mode/arch values before applying
    if (args.mode && args.mode !== 'debug' && args.mode !== 'release') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidMode')}: ${args.mode}` }],
            nextAction: 'forja use target --mode debug',
        };
    }
    if (args.arch && args.arch !== 'x86' && args.arch !== 'x64') {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.invalidArch')}: ${args.arch}` }],
            nextAction: 'forja use target --arch x64',
        };
    }

    const changed: string[] = [];
    const updated: TargetProfile = { ...currentTarget, toolchain: { ...currentTarget.toolchain } };

    if (args.mode && args.mode !== currentTarget.mode) {
        updated.mode = args.mode;
        changed.push('activeTarget.mode');
    }
    if (args.arch && args.arch !== currentTarget.arch) {
        updated.arch = args.arch;
        changed.push('activeTarget.arch');
    }

    if (changed.length > 0) {
        const saved = setActiveTarget(workspace, updated);
        if (!saved) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: T('use.failedToSaveTarget') }],
                nextAction: 'forja init',
            };
        }
    } else {
        // Nothing changed — inform the user
        return {
            ok: true, action: 'use', useScope: 'target',
            workspace, activeTarget: updated, changed: [],
            diagnostics: [{ level: 'info', message: T('use.noChanges') }],
            nextAction: 'forja status',
        };
    }

    return {
        ok: true, action: 'use', useScope: 'target',
        workspace, activeTarget: updated, changed,
        nextAction: 'forja status',
    };
}

export { formatUseTargetText } from './report';
export type { UseTargetResult } from './types';

// ── Update toolchain only (--qt / --vs / --jom) ──

export async function runUpdateToolchain(workspace: string, args: {
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    qmakeTarget?: string;
    executableName?: string;
}): Promise<UseTargetResult> {
    const { getActiveTarget, setActiveTarget } = await import('../activeTarget');
    const currentTarget = getActiveTarget(workspace);
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const changed: string[] = [];
    const updated: TargetProfile = { ...currentTarget, toolchain: { ...currentTarget.toolchain } };

    if (args.qtPath && args.qtPath !== currentTarget.toolchain.qtPath) {
        updated.toolchain.qtPath = args.qtPath;
        changed.push('qtPath');
        setSilent(true);
        let env;
        try { env = await detectEnv(); } finally { setSilent(false); }
        const match = env.qtCandidates.find(q => q.path === args.qtPath);
        if (match) {
            updated.toolchain.qtVersion = match.version;
            changed.push('qtVersion');
        } else {
            // Fallback: extract the LAST X.Y.Z match from path (handles /opt/1.2.3/Qt/6.5.3/)
            const matches = [...args.qtPath.matchAll(/(\d+\.\d+\.\d+)/g)];
            if (matches.length > 0) {
                updated.toolchain.qtVersion = matches[matches.length - 1][1];
                changed.push('qtVersion');
            }
        }
    }
    if (args.vsInstall && args.vsInstall !== currentTarget.toolchain.vsInstall) {
        updated.toolchain.vsInstall = args.vsInstall;
        changed.push('vsInstall');
    }
    if (args.jomPath && args.jomPath !== currentTarget.toolchain.jomPath) {
        updated.toolchain.jomPath = args.jomPath;
        changed.push('jomPath');
    }
    if (args.qmakeTarget && args.qmakeTarget !== currentTarget.toolchain.qmakeTarget) {
        updated.toolchain.qmakeTarget = args.qmakeTarget;
        changed.push('qmakeTarget');
    }
    if (args.executableName !== undefined && args.executableName !== currentTarget.toolchain.executableName) {
        updated.toolchain.executableName = args.executableName || undefined;
        changed.push('executableName');
        // executableName 取代 qmakeTarget，清除旧字段
        if (updated.toolchain.qmakeTarget) {
            updated.toolchain.qmakeTarget = undefined;
            changed.push('qmakeTarget');
        }
    }

    if (changed.length > 0) {
        const saved = setActiveTarget(workspace, updated);
        if (!saved) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: T('use.failedToSaveTarget') }],
                nextAction: 'forja init',
            };
        }
    }

    return {
        ok: true, action: 'use', useScope: 'target',
        workspace, activeTarget: updated, changed,
        nextAction: 'forja status',
    };
}

export async function runUpdateBuildScript(workspace: string, args: {
    buildScript: string;
}): Promise<UseTargetResult> {
    const { getActiveTarget, setActiveTarget } = await import('../activeTarget');
    const currentTarget = getActiveTarget(workspace);
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const updated: TargetProfile = { ...currentTarget };
    if (args.buildScript === '') {
        delete updated.buildScript;
    } else {
        const validationError = validateBuildScript(workspace, currentTarget.kind, args.buildScript);
        if (validationError) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: validationError }],
                nextAction: 'forja use target --build-script <path>',
            };
        }
        updated.buildScript = args.buildScript;
    }

    const saved = setActiveTarget(workspace, updated);
    if (!saved) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.failedToSaveTarget') }],
            nextAction: 'forja init',
        };
    }

    return {
        ok: true, action: 'use', useScope: 'target',
        workspace, activeTarget: updated,
        changed: ['buildScript'],
        nextAction: 'forja build',
    };
}
