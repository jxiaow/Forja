/**
 * useTarget/resolve — Phase 2: per-field resolve functions.
 * Each function independently resolves one config field with clear priority:
 *   flag → existing config → single candidate → interactive prompt → undefined (for JSON questions)
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { T, Question } from '../types';
import { chooseRequired, prompt, confirm } from '../prompt';
import { parseProFile } from '../../../qt/shared/projectScanner';
import type { DetectContext, ResolveOptions, ResolvedConfig } from './types';

export async function resolveAll(ctx: DetectContext, options: ResolveOptions): Promise<{
    config?: ResolvedConfig;
    questions?: Question[];
    ambiguous?: boolean;
    diagnostics?: Array<{ level: 'info' | 'warning' | 'error'; message: string }>;
}> {
    const diagnostics: Array<{ level: 'info' | 'warning' | 'error'; message: string }> = [];
    const hasExisting = !!ctx.existingTarget || !!ctx.existingQt.pinnedProject || !!ctx.existingCpp.pinnedProject;
    const needTarget = !hasExisting || !!options.project || options.reset;

    // ── Resolve target ──
    const resolvedTarget = await resolveTarget(ctx, options, needTarget);
    if (resolvedTarget.questions) return { questions: resolvedTarget.questions, diagnostics };
    if (!resolvedTarget.value) {
        if (resolvedTarget.notFound && options.project) {
            diagnostics.push({ level: 'error', message: `${T('use.projectNotFound')}: ${options.project}` });
            return { diagnostics };
        }
        if (ctx.candidates.length > 1 && needTarget) {
            return { ambiguous: true, diagnostics: ambiguousDiag(ctx) };
        }
        if (ctx.candidates.length === 0 && needTarget) {
            diagnostics.push({ level: 'info', message: T('init.noTargetsToolchainOnly') });
        }
        return { diagnostics };
    }

    const candidate = resolvedTarget.value;
    const kind = candidate.kind;
    const reuseActiveTarget = !options.reset && ctx.existingTarget?.project === candidate.project;
    const buildScript = options.buildScript !== undefined
        ? options.buildScript || undefined
        : (reuseActiveTarget ? ctx.existingTarget?.buildScript : undefined);

    // ── Resolve qmake TARGET (only for .pro files) ──
    let qmakeTarget: string | undefined;
    if (kind === 'qt' && candidate.project.endsWith('.pro')) {
        qmakeTarget = await resolveQmakeTarget(ctx, candidate.project, options, reuseActiveTarget);
    }

    // ── Resolve executable name (post-build rename) ──
    let executableName: string | undefined;
    if (kind === 'qt') {
        executableName = await resolveExecutableName(ctx, options, reuseActiveTarget);
    }

    // ── Resolve build variant ──
    const mode = await resolveMode(ctx, options, reuseActiveTarget);
    const arch = await resolveArch(ctx, options, reuseActiveTarget);

    // ── Resolve toolchain ──
    const stored = ctx.storedToolchains[candidate.project];
    let qtPath: ResolveResult<string> = {};
    let jomPath: ResolveResult<string> = {};
    if (kind === 'qt') {
        qtPath = await resolveQtPath(ctx, options, stored, reuseActiveTarget);
        jomPath = await resolveJomPath(ctx, options, stored, reuseActiveTarget);
    }
    // For Qt targets, filter VS candidates by compiler tag in Qt path
    // Only when Qt is newly selected — skip for existing config to avoid spurious warnings
    let vsCandidatesOverride: typeof ctx.toolchain.vsCandidates | undefined;
    let vsForceInteractive = false;
    const isQtFromExisting = !!(qtPath.value && ctx.existingQt.qtPath && qtPath.value === ctx.existingQt.qtPath);
    if (kind === 'qt' && qtPath.value && !isQtFromExisting) {
        const vsYear = extractVsYearFromQtPath(qtPath.value);
        if (vsYear) {
            const filtered = ctx.toolchain.vsCandidates.filter(v => v.version === vsYear);
            if (filtered.length > 0) {
                vsCandidatesOverride = filtered;
            } else if (options.interactive) {
                console.log(`  ⚠ ${T('use.vsVersionMismatch', [vsYear])}`);
                vsForceInteractive = true;
            }
        }
    }
    const vsInstall = await resolveVsPath(ctx, options, stored, vsCandidatesOverride, vsForceInteractive, reuseActiveTarget);

    const questions = [
        ...(mode.questions || []),
        ...(arch.questions || []),
        ...(qtPath.questions || []),
        ...(vsInstall.questions || []),
    ];
    if (questions.length > 0) return { questions, diagnostics };

    // ── Build resolved config ──
    const qtVersion = qtPath.value ? ctx.toolchain.qtCandidates.find(q => q.path === qtPath.value)?.version : undefined;

    return {
        config: {
            kind,
            project: candidate.project,
            mode: mode.value as 'debug' | 'release' | undefined,
            arch: arch.value as 'x86' | 'x64' | undefined,
            qtPath: qtPath.value,
            qtVersion,
            vsInstall: vsInstall.value,
            jomPath: jomPath.value,
            qmakeTarget,
            executableName,
            buildScript,
        },
        diagnostics,
    };
}

// ── Per-field resolve functions ──

interface ResolveResult<T> {
    value?: T;
    questions?: Question[];
}

async function resolveTarget(ctx: DetectContext, options: ResolveOptions, needTarget: boolean): Promise<ResolveResult<typeof ctx.candidates[0]> & { notFound?: boolean }> {
    // Flag
    if (options.project) {
        const match = ctx.candidates.find(c => c.project === options.project) || ctx.candidates.find(c => c.label === options.project);
        if (match) return { value: match };
        return { value: undefined, notFound: true };
    }

    // Answers
    if (options.answers?.target) {
        const match = ctx.candidates.find(c => c.project === options.answers!.target) || ctx.candidates.find(c => c.label === options.answers!.target);
        if (match) return { value: match };
    }

    // Existing config (not reset)
    if (!needTarget) {
        const existingProject = ctx.existingTarget?.project || ctx.existingQt.pinnedProject?.relative || ctx.existingCpp.pinnedProject;
        if (existingProject) {
            const match = ctx.candidates.find(c => c.project === existingProject);
            if (match) {
                if (options.interactive) {
                    console.log(`  ${T('target')}: ${match.label} — ${match.project}`);
                    const change = await confirm(T('use.confirmChangeTarget'), false);
                    if (!change) return { value: match };
                } else {
                    return { value: match };
                }
            }
        }
    }

    // Single candidate
    if (ctx.candidates.length === 1) return { value: ctx.candidates[0] };

    // Interactive
    if (options.interactive && ctx.candidates.length > 1) {
        const chosen = await chooseRequired(
            T('init.selectTarget'),
            ctx.candidates,
            c => `${c.label} — ${c.project}`,
        );
        console.log(`  ✓ ${chosen.label} — ${chosen.project}`);
        return { value: chosen };
    }

    // JSON mode — return questions
    if (options.json) {
        return {
            questions: [{
                id: 'target',
                label: T('setupQuestionTarget'),
                choices: ctx.candidates.map(c => c.project),
            }],
        };
    }

    return { value: undefined };
}

async function resolveQmakeTarget(ctx: DetectContext, proProject: string, options: ResolveOptions, reuseActiveTarget: boolean): Promise<string | undefined> {
    if (options.qmakeTarget) return options.qmakeTarget;
    if (reuseActiveTarget && ctx.existingQt.target) return ctx.existingQt.target;

    if (options.interactive) {
        const proPath = path.join(ctx.workspace, proProject);
        const proInfo = fs.existsSync(proPath) ? parseProFile(proPath) : null;
        const defaultTarget = proInfo?.target || '';
        const answer = await prompt(`${T('init.qmakeTarget')} (${T('init.qmakeTargetHint')}: ${defaultTarget})`);
        if (answer) {
            console.log(`  ✓ ${answer}`);
            return answer;
        }
        console.log(`  – ${T('init.skipSelection')}`);
        return undefined;
    }

    if (options.answers?.qmakeTarget) return options.answers.qmakeTarget;
    return undefined;
}

async function resolveExecutableName(ctx: DetectContext, options: ResolveOptions, reuseActiveTarget: boolean): Promise<string | undefined> {
    if (options.executableName) return options.executableName;
    if (reuseActiveTarget && ctx.existingTarget?.toolchain?.executableName) return ctx.existingTarget.toolchain.executableName;
    if (options.interactive) {
        const answer = await prompt(`${T('init.executableName')} (${T('init.executableNameHint')})`);
        if (answer) {
            console.log(`  ✓ ${answer}`);
            return answer;
        }
        console.log(`  – ${T('init.skipSelection')}`);
        return undefined;
    }

    if (options.answers?.executableName) return options.answers.executableName;
    return undefined;
}

async function resolveQtPath(ctx: DetectContext, options: ResolveOptions, stored?: { qtPath?: string }, reuseActiveTarget = false): Promise<ResolveResult<string>> {
    // Flag
    if (options.qtPath) return { value: options.qtPath };
    // Answers
    if (options.answers?.qtPath) return { value: options.answers.qtPath };
    // Existing (not reset)
    if (reuseActiveTarget && ctx.existingQt.qtPath) return { value: ctx.existingQt.qtPath };
    // Stored toolchain
    if (stored?.qtPath) return { value: stored.qtPath };
    // Single candidate
    if (ctx.toolchain.qtCandidates.length === 1) return { value: ctx.toolchain.qtCandidates[0].path };
    // Interactive
    if (options.interactive && ctx.toolchain.qtCandidates.length > 1) {
        const chosen = await chooseRequired(T('init.selectQt'), ctx.toolchain.qtCandidates, q => `${q.version} — ${q.path}`);
        console.log(`  ✓ ${chosen.version} — ${chosen.path}`);
        return { value: chosen.path };
    }
    // JSON
    if (options.json && ctx.toolchain.qtCandidates.length > 1) {
        return { questions: [{ id: 'qtPath', label: T('setupQuestionQtPath'), choices: ctx.toolchain.qtCandidates.map(q => q.path) }] };
    }
    // Fallback: env default
    if (ctx.toolchain.qtPath) return { value: ctx.toolchain.qtPath };
    return { value: undefined };
}

async function resolveVsPath(ctx: DetectContext, options: ResolveOptions, stored?: { vsInstall?: string }, candidatesOverride?: typeof ctx.toolchain.vsCandidates, forceInteractive = false, reuseActiveTarget = false): Promise<ResolveResult<string>> {
    const candidates = candidatesOverride ?? ctx.toolchain.vsCandidates;
    if (options.vsInstall) return { value: options.vsInstall };
    if (options.answers?.vsInstall) return { value: options.answers.vsInstall };
    if (reuseActiveTarget && (ctx.existingQt.vsInstall || ctx.existingCpp.vsInstall)) return { value: ctx.existingQt.vsInstall || ctx.existingCpp.vsInstall };
    if (stored?.vsInstall) return { value: stored.vsInstall };
    if (candidates.length === 1 && !forceInteractive) return { value: candidates[0].installPath };
    if (options.interactive && candidates.length >= 1) {
        const chosen = await chooseRequired(T('init.selectVs'), candidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
        console.log(`  ✓ ${chosen.version} ${chosen.edition} — ${chosen.installPath}`);
        return { value: chosen.installPath };
    }
    if (options.json && candidates.length > 1) {
        return { questions: [{ id: 'vsInstall', label: T('setupQuestionVsInstall'), choices: candidates.map(v => v.installPath) }] };
    }
    if (ctx.toolchain.vsInstall) return { value: ctx.toolchain.vsInstall };
    return { value: undefined };
}

async function resolveJomPath(ctx: DetectContext, options: ResolveOptions, stored?: { jomPath?: string }, reuseActiveTarget = false): Promise<ResolveResult<string>> {
    if (options.jomPath) return { value: options.jomPath };
    if (options.answers?.jomPath) return { value: options.answers.jomPath };
    if (reuseActiveTarget && ctx.existingQt.jomPath) return { value: ctx.existingQt.jomPath };
    if (stored?.jomPath) return { value: stored.jomPath };
    if (ctx.toolchain.jomPath) return { value: ctx.toolchain.jomPath };
    return { value: undefined };
}

async function resolveMode(ctx: DetectContext, options: ResolveOptions, reuseActiveTarget = false): Promise<ResolveResult<string>> {
    if (options.mode) return { value: options.mode };
    if (options.answers?.mode) return { value: options.answers.mode };
    if (reuseActiveTarget && (ctx.existingTarget?.mode || ctx.existingQt.mode)) return { value: ctx.existingTarget?.mode || ctx.existingQt.mode };
    if (options.interactive) {
        const modes = [{ value: 'debug' }, { value: 'release' }];
        const chosen = await chooseRequired(T('init.selectMode'), modes, m => m.value);
        console.log(`  ✓ ${chosen.value}`);
        return { value: chosen.value };
    }
    if (options.json) {
        return { questions: [{ id: 'mode', label: T('setupQuestionMode'), choices: ['debug', 'release'] }] };
    }
    return { value: undefined };
}

async function resolveArch(ctx: DetectContext, options: ResolveOptions, reuseActiveTarget = false): Promise<ResolveResult<string>> {
    const platformDefault = (os.platform() === 'win32' ? 'x86' : 'x64');
    if (options.arch) return { value: options.arch };
    if (options.answers?.arch) return { value: options.answers.arch };
    if (reuseActiveTarget && (ctx.existingTarget?.arch || ctx.existingQt.arch)) return { value: ctx.existingTarget?.arch || ctx.existingQt.arch };
    if (options.interactive && os.platform() === 'win32') {
        const archs = [{ value: 'x86' }, { value: 'x64' }];
        const chosen = await chooseRequired(T('init.selectArch'), archs, a => a.value);
        console.log(`  ✓ ${chosen.value}`);
        return { value: chosen.value };
    }
    if (options.json && os.platform() === 'win32') {
        return { questions: [{ id: 'arch', label: T('setupQuestionArch'), choices: ['x86', 'x64'] }] };
    }
    return { value: platformDefault };
}

// ── Helpers ──

function ambiguousDiag(ctx: DetectContext): Array<{ level: 'info' | 'warning' | 'error'; message: string }> {
    if (ctx.qtCandidates.length > 0 && ctx.cppCandidates.length > 0) {
        return [{
            level: 'info',
            message: `${T('init.foundQtCppNotAutoSelecting')}: ${ctx.qtCandidates.length} Qt (${ctx.qtCandidates.map(c => c.label).join(', ')}), ${ctx.cppCandidates.length} C++ (${ctx.cppCandidates.map(c => c.label).join(', ')})`,
        }];
    }
    return [{
        level: 'info',
        message: `${T('init.foundTargetsNotAutoSelecting')}: ${ctx.candidates.length} (${ctx.candidates.map(c => c.label).join(', ')})`,
    }];
}

/**
 * Extract VS year from Qt path compiler tag (e.g. "msvc2019" → "2019", "msvc2022_64" → "2022").
 * Returns null if no recognized tag found.
 */
export function extractVsYearFromQtPath(qtPath: string): string | null {
    const match = qtPath.match(/msvc(\d{4})/);
    return match ? match[1] : null;
}
