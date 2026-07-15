/**
 * useTarget/index — entry point for `forja use target`.
 * Orchestrates: detect → resolve → save → report.
 */
import * as fs from 'fs';
import * as path from 'path';
import { T, Diagnostic } from '../types';
import type { ActiveTarget } from '../types';
import { detectContext } from './detect';
import { resolveAll } from './resolve';
import { saveAll, buildActiveTarget } from './save';
import { buildSuccessResult, formatUseTargetText } from './report';
import type { ResolveOptions, UseTargetResult, ResolvedConfig } from './types';
import { detectProjectType } from '../../../core/projectTypeDetector';
import { detectEnv } from '../../../qt/env/envDetector';
import { setSilent } from '../../../core/loggerBase';
import { choose } from '../prompt';
import { extractVsYearFromQtPath } from './resolve';

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
            nextAction: 'forja use target --json --answers <answers.json>',
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

    // Phase 3: Save
    const saveResult = saveAll(workspace, resolved.config);
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${saveResult.error}` }],
            nextAction: 'forja doctor',
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
    return buildSuccessResult(config, toolchain, saveResult.changed, workspace);
}

// ── Switch target (with --project) — simplified path for existing use.ts compatibility ──

export async function runSwitchTarget(workspace: string, args: {
    project: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
    interactive?: boolean;
    json?: boolean;
}): Promise<UseTargetResult> {
    if (!fs.existsSync(workspace)) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.workspaceNotFound')}: ${workspace}` }],
        };
    }

    const ctx = await detectContext(workspace);

    // First: try to match against saved targets by ID or name (quick switch)
    const workroot = (await import('../../../core/workspaceStore')).resolveWorkroot(workspace);
    if (workroot) {
        const wsConfig = (await import('../../../core/workspaceStore')).loadWorkspaceConfig(workroot);
        const savedTargets = Object.values(wsConfig.targets);
        const inputLower = args.project.toLowerCase();

        // Exact ID match
        const exactId = savedTargets.find(t => t.id === args.project);
        if (exactId) {
            // Quick switch: just update activeTarget pointer
            wsConfig.activeTarget = exactId.id;
            (await import('../../../core/workspaceStore')).saveWorkspaceConfig(wsConfig);
            const { targetProfileToActiveTarget } = await import('../activeTarget');
            const activeTarget = targetProfileToActiveTarget(exactId, workroot);
            return {
                ok: true, action: 'use', useScope: 'target',
                workspace, activeTarget, changed: ['activeTarget'],
                nextAction: 'forja status',
            };
        }

        // ID prefix match or name match
        const prefixMatches = savedTargets.filter(t =>
            t.id.toLowerCase().startsWith(inputLower) ||
            t.name.toLowerCase().includes(inputLower)
        );
        if (prefixMatches.length === 1) {
            wsConfig.activeTarget = prefixMatches[0].id;
            (await import('../../../core/workspaceStore')).saveWorkspaceConfig(wsConfig);
            const { targetProfileToActiveTarget } = await import('../activeTarget');
            const activeTarget = targetProfileToActiveTarget(prefixMatches[0], workroot);
            return {
                ok: true, action: 'use', useScope: 'target',
                workspace, activeTarget, changed: ['activeTarget'],
                nextAction: 'forja status',
            };
        }
        if (prefixMatches.length > 1) {
            if (args.interactive) {
                const chosen = await choose(
                    T('use.multipleTargetsFound'),
                    prefixMatches,
                    t => `${t.id}  ${t.name}  [${t.kind}]`,
                );
                if (chosen) {
                    wsConfig.activeTarget = chosen.id;
                    (await import('../../../core/workspaceStore')).saveWorkspaceConfig(wsConfig);
                    const { targetProfileToActiveTarget } = await import('../activeTarget');
                    const activeTarget = targetProfileToActiveTarget(chosen, workroot);
                    return {
                        ok: true, action: 'use', useScope: 'target',
                        workspace, activeTarget, changed: ['activeTarget'],
                        nextAction: 'forja status',
                    };
                }
            } else {
                const ids = prefixMatches.map(t => t.id).join('\n    ');
                return {
                    ok: false, action: 'use', useScope: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.multipleTargetsFound')}: ${args.project}\n    ${ids}` }],
                    nextAction: 'forja list targets',
                };
            }
        }
    }

    // Resolve project path
    const projectPath = path.isAbsolute(args.project) ? args.project : path.join(workspace, args.project);
    let canonicalProject = args.project;
    let kind: 'qt' | 'sdk' | null = null;

    if (fs.existsSync(projectPath) && !fs.statSync(projectPath).isDirectory()) {
        canonicalProject = path.relative(workspace, projectPath).replace(/\\/g, '/');
        const typeInfo = detectProjectType(projectPath);
        kind = typeInfo.usesQt ? 'qt' : 'sdk';
    } else {
        // Try label match
        const inputLower = path.basename(args.project).toLowerCase();
        const matches = ctx.candidates.filter(c => c.label.toLowerCase() === inputLower);
        if (matches.length === 1) {
            canonicalProject = matches[0].project;
            kind = matches[0].kind;
        } else if (matches.length > 1) {
            if (args.interactive) {
                const chosen = await choose(
                    T('use.multipleTargetsFound'),
                    matches,
                    c => `${c.label} — ${c.project}`,
                );
                if (chosen) {
                    canonicalProject = chosen.project;
                    kind = chosen.kind;
                    if (!args.json) { console.log(`  ✓ ${chosen.label} — ${chosen.project}`); }
                } else {
                    return {
                        ok: false, action: 'use', useScope: 'target', changed: [],
                        diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${args.project}` }],
                        nextAction: 'forja list targets',
                    };
                }
            } else {
                const paths = matches.map(m => m.project).join('\n    ');
                return {
                    ok: false, action: 'use', useScope: 'target', changed: [],
                    diagnostics: [{ level: 'error', message: `${T('use.multipleTargetsFound')}: ${args.project}\n    ${paths}` }],
                    nextAction: 'forja use target --project <path>',
                };
            }
        } else {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: `${T('use.projectNotFound')}: ${args.project}` }],
                nextAction: 'forja list targets',
            };
        }
    }

    if (!kind) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.cannotDetermineKind')}: ${args.project}` }],
            nextAction: 'forja list targets',
        };
    }

    // Resolve toolchain for the new target
    const currentTarget = ctx.existingTarget;
    const mode = args.mode ?? currentTarget?.mode ?? 'debug';
    const arch = args.arch ?? currentTarget?.arch ?? (process.platform === 'win32' ? 'x86' : 'x64');
    const runAt = currentTarget?.runAt ?? 'local';

    let qtPath: string | undefined;
    let vsInstall: string | undefined;
    let jomPath: string | undefined;
    let qmakeTarget: string | undefined;
    const changed: string[] = [];

    // Try to get toolchain from existing target profile (workspaceStore)
    if (currentTarget?.qtPath || currentTarget?.vsInstall) {
        if (kind === 'qt') {
            qtPath = currentTarget.qtPath;
            jomPath = currentTarget.jomPath;
            qmakeTarget = currentTarget.qmakeTarget;
        }
        vsInstall = currentTarget.vsInstall;
    } else if (args.interactive) {
        setSilent(true);
        const env = await detectEnv();
        setSilent(false);

        if (kind === 'qt') {
            if (env.qtCandidates.length > 1) {
                const chosen = await choose(T('init.selectQt'), env.qtCandidates, q => `${q.version} — ${q.path}`);
                if (chosen) qtPath = chosen.path;
            } else if (env.qt) {
                qtPath = env.qt.path;
            }
        }

        // Filter VS candidates by Qt compiler tag for Qt targets
        let vsCandidates = env.vsCandidates;
        let vsMismatch = false;
        if (kind === 'qt' && qtPath) {
            const vsYear = extractVsYearFromQtPath(qtPath);
            if (vsYear) {
                const filtered = env.vsCandidates.filter(v => v.version === vsYear);
                if (filtered.length > 0) {
                    vsCandidates = filtered;
                } else {
                    if (!args.json) { console.log(`  ⚠ ${T('use.vsVersionMismatch', [vsYear])}`); }
                    vsCandidates = [];
                    vsMismatch = true;
                }
            }
        }

        if (vsCandidates.length > 1) {
            const chosen = await choose(T('init.selectVs'), vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) vsInstall = chosen.installPath;
        } else if (vsCandidates.length === 1) {
            vsInstall = vsCandidates[0].installPath;
        } else if (vsMismatch && env.vsCandidates.length >= 1) {
            const chosen = await choose(T('init.selectVs'), env.vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) vsInstall = chosen.installPath;
        } else if (env.vs) {
            vsInstall = env.vs.installPath;
        }
    } else if (args.json) {
        const questions: Array<{ id: string; label: string }> = [];
        if (kind === 'qt') { questions.push({ id: 'qtPath', label: T('setupQuestionQtPath') }); }
        questions.push({ id: 'vsInstall', label: T('setupQuestionVsInstall') });
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            status: 'needs-input',
            questions,
            diagnostics: [{ level: 'info', message: T('use.toolchainNotConfigured') }],
            nextAction: `forja use target --project ${args.project}`,
        };
    } else {
        setSilent(true);
        const env = await detectEnv();
        setSilent(false);
        if (kind === 'qt') { qtPath = env.qt?.path; }
        // Filter VS by Qt compiler tag for Qt targets
        if (kind === 'qt' && qtPath) {
            const vsYear = extractVsYearFromQtPath(qtPath);
            if (vsYear) {
                const match = env.vsCandidates.find(v => v.version === vsYear);
                if (match) { vsInstall = match.installPath; }
                else { vsInstall = env.vs?.installPath; }
            } else {
                vsInstall = env.vs?.installPath;
            }
        } else {
            vsInstall = env.vs?.installPath;
        }
    }

    const qtVersion = qtPath ? ctx.toolchain.qtCandidates.find(q => q.path === qtPath)?.version : undefined;

    const config: ResolvedConfig = {
        kind, project: canonicalProject,
        mode: mode as 'debug' | 'release',
        arch: arch as 'x86' | 'x64',
        runAt, qtPath, qtVersion, vsInstall, jomPath, qmakeTarget,
    };

    // Save
    const saveResult = saveAll(workspace, config);
    if (!saveResult.ok) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: `${T('use.failedToSaveActiveTarget')}: ${saveResult.error}` }],
            nextAction: 'forja doctor',
        };
    }

    if (qtPath || vsInstall) changed.push('toolchain');
    changed.push(kind === 'qt' ? 'qt.pinnedProject' : 'sdk.pinnedProject');
    changed.push('activeTarget');

    const target = buildActiveTarget(config);

    // Match VS version for report
    let vsVersion = ctx.toolchain.vsVersion;
    if (vsInstall) {
        const match = ctx.toolchain.vsCandidates.find(v => v.installPath === vsInstall);
        if (match) vsVersion = match.version;
    }

    return {
        ok: true, action: 'use', useScope: 'target',
        workspace, activeTarget: target,
        config: kind === 'qt'
            ? { qt: { configured: true, project: canonicalProject, mode, arch, qtPath, vsInstall, qtVersion: config.qtVersion, vsVersion } }
            : { sdk: { configured: true, project: canonicalProject, mode, arch, vsInstall } },
        changed,
        nextAction: 'forja status',
    };
}

// ── Update mode/arch only ──

export async function runUpdateModeArch(workspace: string, args: {
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
}): Promise<UseTargetResult> {
    const { setActiveTarget } = await import('../activeTarget');
    const currentTarget = (await import('../activeTarget')).getActiveTarget(workspace);
    if (!currentTarget) {
        return {
            ok: false, action: 'use', useScope: 'target', changed: [],
            diagnostics: [{ level: 'error', message: T('use.noActiveTargetSelected') }],
            nextAction: 'forja use target --project <path>',
        };
    }

    const changed: string[] = [];
    const updated = { ...currentTarget };

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
                diagnostics: [{ level: 'error', message: T('use.failedToSaveActiveTarget') }],
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

export { formatUseTargetText } from './report';
export type { UseTargetResult } from './types';

// ── Update toolchain only (--qt / --vs / --jom) ──

export async function runUpdateToolchain(workspace: string, args: {
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
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
    const updated = { ...currentTarget };

    if (args.qtPath && args.qtPath !== currentTarget.qtPath) {
        updated.qtPath = args.qtPath;
        changed.push('qtPath');
        setSilent(true);
        const env = await detectEnv();
        setSilent(false);
        const match = env.qtCandidates.find(q => q.path === args.qtPath);
        if (match) {
            updated.qtVersion = match.version;
            changed.push('qtVersion');
        }
    }
    if (args.vsInstall && args.vsInstall !== currentTarget.vsInstall) {
        updated.vsInstall = args.vsInstall;
        changed.push('vsInstall');
    }
    if (args.jomPath && args.jomPath !== currentTarget.jomPath) {
        updated.jomPath = args.jomPath;
        changed.push('jomPath');
    }

    if (changed.length > 0) {
        const saved = setActiveTarget(workspace, updated);
        if (!saved) {
            return {
                ok: false, action: 'use', useScope: 'target', changed: [],
                diagnostics: [{ level: 'error', message: T('use.failedToSaveActiveTarget') }],
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
