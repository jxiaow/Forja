/**
 * `forja init` — register a workroot and configure initial target.
 */
import * as path from 'path';
import * as fs from 'fs';
import { T, Diagnostic, Question } from './types';
import type { ForjaJsonResult } from './types';
import {
    resolveWorkroot, isWorkrootRegistered, registerWorkroot, unregisterWorkroot,
    loadWorkspaceConfig, saveWorkspaceConfig, createEmptyWorkspaceConfig,
    generateTargetId, removeTarget,
    type WorkspaceConfig, type TargetProfile,
} from '../../core/workspaceStore';
import { scanProFiles } from '../../qt/shared/projectScanner';
import { scanCppProjects } from '../../core/cppProjectScanner';
import { detectProjectType } from '../../core/projectTypeDetector';
import { detectEnv } from '../../qt/env/envDetector';
import { scanRccCandidates } from '../../qt/shared/rccResolver';
import { setSilent } from '../../core/loggerBase';
import { confirm, prompt, choose, chooseRequired } from './prompt';
import { getProjectGroup } from './projectGrouping';
export { getProjectGroup } from './projectGrouping';

// ── Result type ──

export interface InitResult extends ForjaJsonResult {
    action: 'init';
    registered?: boolean;
    target?: TargetProfile;
    questions?: Question[];
}

// ── Entry options ──

export interface InitOptions {
    workroot?: string;
    interactive: boolean;
    json: boolean;
    answers?: Record<string, string>;
}

// ── Text formatter ──

export function formatInitText(result: InitResult): string {
    const lines: string[] = [];
    if (!result.ok) {
        lines.push(T('error'));
        if (result.diagnostics) {
            for (const d of result.diagnostics) { lines.push(`  ${d.message}`); }
        }
        if (result.nextAction) { lines.push(T('next')); lines.push(`  ${result.nextAction}`); }
        return lines.join('\n');
    }

    lines.push(T('init.title'));
    lines.push(`  ${T('init.workroot')}: ${result.workroot}`);
    if (result.registered) {
        lines.push(`  ${T('init.newlyRegistered')}`);
    }
    if (result.target) {
        const t = result.target;
        lines.push(`  ${T('target')}: ${t.name} [${t.kind}]`);
        lines.push(`  ${T('init.project')}: ${t.project}`);
        lines.push(`  ${T('init.modeArch')}: ${t.mode} | ${t.arch}`);
        if (t.toolchain.qtPath) lines.push(`  ${T('init.qt')}: ${t.toolchain.qtPath}`);
        if (t.toolchain.vsInstall) lines.push(`  ${T('init.vs')}: ${t.toolchain.vsInstall}`);
    }
    if (result.nextAction) { lines.push(T('next')); lines.push(`  ${result.nextAction}`); }
    return lines.join('\n');
}

// ── Main entry ──

export async function runInit(cwd: string, options: InitOptions): Promise<InitResult> {
    // Resolve workroot — if --workroot is given, use it; otherwise check if cwd is under an existing workroot
    let workroot: string;
    if (options.workroot) {
        workroot = path.resolve(options.workroot);
    } else {
        // Check if cwd is under an already-registered workroot (e.g. running from a subdirectory)
        const existingWorkroot = resolveWorkroot(cwd);
        workroot = existingWorkroot || cwd;
    }

    if (!fs.existsSync(workroot)) {
        return {
            ok: false, action: 'init',
            diagnostics: [{ level: 'error', message: `${T('init.workrootNotFound')}: ${workroot}` }],
        };
    }

    if (!fs.statSync(workroot).isDirectory()) {
        return {
            ok: false, action: 'init',
            diagnostics: [{ level: 'error', message: `Workroot must be a directory: ${workroot}` }],
        };
    }

    const alreadyRegistered = isWorkrootRegistered(workroot);

    if (alreadyRegistered) {
        return handleExistingWorkroot(workroot, options);
    }

    return handleNewWorkroot(workroot, options);
}

// ── Existing workroot ──

async function handleExistingWorkroot(workroot: string, options: InitOptions): Promise<InitResult> {
    const config = loadWorkspaceConfig(workroot);
    const targets = Object.values(config.targets);

    if (options.json && !options.answers) {
        const questions: Question[] = [
            { id: 'action', label: T('init.existingAction'), choices: ['add', 'modify', 'exit'] },
        ];
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'info', message: T('init.workrootAlreadyRegistered') }],
            questions,
            nextAction: 'forja init --answers <answers.json>',
        };
    }

    if (!options.interactive && !options.answers) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.workrootAlreadyRegistered') }],
            nextAction: 'forja use target',
        };
    }

    // Answers mode: read action from answers
    if (options.answers) {
        const action = options.answers.action;
        if (action === 'add') {
            return handleAddTargetFromAnswers(workroot, config, options);
        } else if (action === 'modify') {
            return handleModifyTarget(workroot, config, options);
        } else if (action === 'exit') {
            return {
                ok: true, action: 'init', workroot,
                target: config.activeTarget ? config.targets[config.activeTarget] : undefined,
                nextAction: 'forja status',
            };
        }
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.invalidAction', [action]) }],
            nextAction: 'forja init',
        };
    }

    console.log(T('init.workrootAlreadyRegistered'));
    console.log(`  ${T('init.workroot')}: ${workroot}`);
    if (targets.length > 0) {
        console.log(`  ${T('init.existingTargets')}:`);
        for (const t of targets) {
            const marker = t.id === config.activeTarget ? ' *' : '';
            console.log(`    ${marker} ${t.name} [${t.kind}] ${t.project}`);
        }
    }

    const action = await choose(T('init.selectAction'), [
        { value: 'add', label: T('init.addAction') },
        { value: 'modify', label: T('init.modifyAction') },
        { value: 'remove', label: T('init.removeAction') },
        { value: 'exit', label: T('init.exitAction') },
    ], item => item.label);

    if (!action || action.value === 'exit') {
        return { ok: true, action: 'init', workroot };
    }

    if (action.value === 'modify') {
        return handleModifyTarget(workroot, config, options);
    }

    if (action.value === 'remove') {
        return handleRemoveTarget(workroot, config, options);
    }

    // Add new target
    const result = await configureNewTarget(workroot, config, options);
    if (!result.ok) return result;

    return {
        ok: true, action: 'init', workroot,
        registered: false,
        target: result.target,
        nextAction: 'forja status',
    };
}

async function handleAddTargetFromAnswers(workroot: string, config: WorkspaceConfig, options: InitOptions): Promise<InitResult> {
    const result = await configureNewTarget(workroot, config, options);
    if (!result.ok) return result;

    return {
        ok: true, action: 'init', workroot,
        registered: false,
        target: result.target,
        nextAction: 'forja status',
    };
}

async function handleModifyTarget(workroot: string, config: WorkspaceConfig, options: InitOptions): Promise<InitResult> {
    const targets = Object.values(config.targets);
    if (targets.length === 0) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.noTargetsToModify') }],
            nextAction: 'forja init',
        };
    }

    // Answers mode: find target by ID or name from answers
    let selected: TargetProfile;
    if (options.answers?.target) {
        const match = targets.find(t => t.id === options.answers!.target || t.name === options.answers!.target);
        if (!match) {
            return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: `${T('init.targetNotFound')}: ${options.answers.target}` }] };
        }
        selected = match;
    } else if (options.interactive) {
        selected = await chooseRequired(T('init.selectTargetToModify'), targets, t => `${t.name} [${t.kind}] ${t.project}`);
    } else {
        return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: T('init.answersMissingTarget') }] };
    }

    // Re-detect toolchain and reconfigure
    const updatedResult = await configureTargetFields(selected, options, workroot);
    if (!updatedResult.ok) {
        return { ok: false, action: 'init', workroot, diagnostics: updatedResult.diagnostics };
    }

    config.targets[updatedResult.target.id] = updatedResult.target;
    if (updatedResult.rccProjectPath !== undefined) {
        config.qtModulePrefs.rccProjectPath = updatedResult.rccProjectPath;
    }
    try { saveWorkspaceConfig(config); } catch (e) {
        return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` }] };
    }

    return {
        ok: true, action: 'init', workroot,
        target: updatedResult.target,
        nextAction: 'forja status',
    };
}

async function handleRemoveTarget(workroot: string, config: WorkspaceConfig, options: InitOptions): Promise<InitResult> {
    const targets = Object.values(config.targets);
    if (targets.length === 0) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('use.noTargetsToRemove') }],
            nextAction: 'forja init',
        };
    }

    let selected: TargetProfile;
    if (options.answers?.target) {
        const match = targets.find(t => t.id === options.answers!.target || t.name === options.answers!.target);
        if (!match) {
            return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: T('use.targetNotFound', [options.answers.target]) }] };
        }
        selected = match;
    } else if (options.interactive) {
        const chosen = await chooseRequired(T('use.selectTarget'), targets, t => `${t.name} [${t.kind}] ${t.project}`);
        if (!chosen) {
            return { ok: true, action: 'init', workroot, diagnostics: [{ level: 'info', message: T('cancelled') }] };
        }
        selected = chosen;
    } else {
        return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: T('init.answersMissingTarget') }] };
    }

    if (options.interactive) {
        const yes = await confirm(T('confirmRemoveTarget', [selected.id]), false);
        if (!yes) {
            return { ok: true, action: 'init', workroot, diagnostics: [{ level: 'info', message: T('cancelled') }] };
        }
    }

    try {
        removeTarget(workroot, selected.id);
    } catch (e) {
        return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: e instanceof Error ? e.message : String(e) }] };
    }

    return {
        ok: true, action: 'init', workroot,
        diagnostics: [{ level: 'info', message: T('use.targetRemoved', [selected.id]) }],
        nextAction: 'forja list targets',
    };
}

// ── New workroot ──

async function handleNewWorkroot(workroot: string, options: InitOptions): Promise<InitResult> {
    if (options.json && !options.answers) {
        // Ask for the root before scanning so JSON callers can choose a
        // different top-level directory than the current process directory.
        if (!options.workroot) {
            return {
                ok: false, action: 'init', workroot,
                questions: [{ id: 'workroot', label: T('init.workroot'), default: workroot }],
                nextAction: 'forja init --answers <answers.json>',
            };
        }
        // Scan and return questions
        const candidates = await scanProjects(workroot);
        if (candidates.length === 0) {
            return {
                ok: false, action: 'init', workroot,
                diagnostics: [{ level: 'error', message: T('init.noProjectsFound') }],
            };
        }
        const projectGroups = groupProjectCandidates(candidates);
        const groupedChoices = Object.fromEntries(projectGroups.map(group => [
            group.name,
            group.candidates.map(candidate => candidate.project),
        ]));
        const questions: Question[] = [
            { id: 'projectGroup', label: T('init.selectProjectGroup'), choices: projectGroups.map(group => group.name) },
            { id: 'project', label: T('init.selectProject'), choicesBy: { questionId: 'projectGroup', values: groupedChoices } },
            { id: 'mode', label: T('init.selectMode'), choices: ['debug', 'release'] },
        ];
        // Only prompt arch on Windows where multiple options exist
        if (process.platform === 'win32') {
            questions.push({ id: 'arch', label: T('init.selectArch'), choices: ['x86', 'x64'] });
        }
        setSilent(true);
        let env;
        try { env = await detectEnv(); } finally { setSilent(false); }
        if (candidates.some(candidate => candidate.kind === 'qt') && env.qtCandidates.length > 1) {
            questions.push({
                id: 'qtPath',
                label: T('setupQuestionQtPath'),
                choicesBy: {
                    questionId: 'project',
                    values: Object.fromEntries(candidates.map(candidate => [
                        candidate.project,
                        candidate.kind === 'qt' ? env.qtCandidates.map(q => q.path) : [],
                    ])),
                },
            });
        }
        if (env.vsCandidates.length > 1) {
            questions.push({
                id: 'vsInstall',
                label: T('setupQuestionVsInstall'),
                choices: env.vsCandidates.map(v => v.installPath),
            });
        }
        return {
            ok: false, action: 'init', workroot,
            questions,
            nextAction: 'forja init --answers <answers.json>',
        };
    }

    if (!options.interactive && !options.answers) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.workrootNotRegistered') }],
            nextAction: 'forja init',
        };
    }

    // Answers mode: skip interactive confirmation, use workroot as-is
    if (options.answers) {
        const emptyConfig = createEmptyWorkspaceConfig(workroot);
        registerWorkroot(workroot);
        const result = await configureNewTarget(workroot, emptyConfig, options);
        if (!result.ok) {
            // Rollback registration to avoid orphaned empty workroot
            unregisterWorkroot(workroot);
            return result;
        }
        return {
            ok: true, action: 'init', workroot,
            registered: true,
            target: result.target,
            nextAction: 'forja status',
        };
    }

    // Interactive flow
    console.log(T('init.newWorkroot'));
    console.log(`  ${T('init.workroot')}: ${workroot}`);
    console.log(`  ${T('init.workrootHint')}`);
    console.log(`  ${T('init.workrootSuggestion')}`);

    // Confirm or change workroot before scanning
    const confirmed = await confirm(T('init.confirmWorkroot'), true);
    if (!confirmed) {
        const newRoot = await prompt(`${T('init.workroot')}: `);
        if (!newRoot) {
            return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: T('init.configurationCancelled') }] };
        }
        workroot = path.resolve(newRoot);
        if (!fs.existsSync(workroot)) {
            return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: `${T('init.workrootNotFound')}: ${workroot}` }] };
        }
        console.log(`  ${T('init.workroot')}: ${workroot}`);
    }

    const candidates = await scanProjects(workroot);

    console.log(`  ${T('init.foundProjects')}: ${candidates.length}`);

    const config = createEmptyWorkspaceConfig(workroot);

    // Register BEFORE configureNewTarget — avoids orphaned config if registration fails
    registerWorkroot(workroot);

    const result = await configureNewTarget(workroot, config, options, candidates);
    if (!result.ok) {
        // Rollback registration to avoid orphaned empty workroot
        unregisterWorkroot(workroot);
        return result;
    }

    return {
        ok: true, action: 'init', workroot,
        registered: true,
        target: result.target,
        nextAction: 'forja status',
    };
}

// ── Shared helpers ──

export interface ProjectCandidate {
    kind: 'qt' | 'cpp';
    project: string;
    label: string;
}

export interface ProjectGroup {
    name: string;
    candidates: ProjectCandidate[];
}

export function groupProjectCandidates(candidates: ProjectCandidate[]): ProjectGroup[] {
    const groups = new Map<string, ProjectCandidate[]>();
    for (const candidate of candidates) {
        const name = getProjectGroup(candidate.project);
        const items = groups.get(name) || [];
        items.push(candidate);
        groups.set(name, items);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, items]) => ({
            name,
            candidates: items.sort((a, b) => a.project.localeCompare(b.project)),
        }));
}

async function scanProjects(workroot: string): Promise<ProjectCandidate[]> {
    const candidates: ProjectCandidate[] = [];

    // Scan Qt projects (.pro files)
    setSilent(true);
    let proFiles;
    try { proFiles = scanProFiles(workroot, [], ['build', '.worktrees']); } finally { setSilent(false); }
    for (const pro of proFiles) {
        candidates.push({
            kind: 'qt',
            project: pro,
            label: `${path.basename(pro, '.pro')} (${pro})`,
        });
    }

    // Scan C++ projects
    setSilent(true);
    let cppFiles;
    try { cppFiles = scanCppProjects({ workspace: workroot, relativePaths: true }); } finally { setSilent(false); }
    for (const cppFile of cppFiles) {
        const fullPath = path.join(workroot, cppFile);
        const typeInfo = detectProjectType(fullPath);
        const kind = typeInfo.usesQt ? 'qt' : 'cpp';
        // Skip if already found as .pro
        if (!candidates.some(c => c.project === cppFile)) {
            candidates.push({
                kind,
                project: cppFile,
                label: `${path.basename(cppFile, path.extname(cppFile))} (${cppFile})`,
            });
        }
    }

    return candidates;
}

export async function promptRccProjectPath(workroot: string, interactive: boolean, answersRccPath: string | undefined, current?: string): Promise<string | undefined> {
    if (answersRccPath !== undefined) {
        return answersRccPath || undefined;
    }
    if (!interactive) return undefined;

    const candidates = scanRccCandidates(workroot);
    const skipLabel = current ? `${T('init.rccSkip')} (${current})` : T('init.rccSkip');
    const items = [
        ...candidates.map(c => ({ value: c, label: c })),
        { value: '__manual__', label: T('init.rccManual') },
        { value: '__skip__', label: skipLabel },
    ];
    const chosen = await choose(T('init.rccProject'), items, item => item.label);
    if (!chosen || chosen.value === '__skip__') return undefined;
    if (chosen.value === '__manual__') {
        const input = await prompt(T('init.rccProject'), current);
        return input?.trim() || undefined;
    }
    return chosen.value;
}

async function configureNewTarget(workroot: string, config: WorkspaceConfig, options: InitOptions, existingCandidates?: ProjectCandidate[]): Promise<InitResult> {
    const candidates = existingCandidates || await scanProjects(workroot);

    // Select project
    let selectedProject: ProjectCandidate;
    if (options.answers?.project) {
        // Check if the project path is a build script (.sh/.bat) — create synthetic candidate
        const projExt = path.extname(options.answers.project).toLowerCase();
        if (projExt === '.sh' || projExt === '.bat') {
            const scriptPath = options.answers.project;
            const absoluteScript = path.isAbsolute(scriptPath) ? scriptPath : path.join(workroot, scriptPath);
            if (!fs.existsSync(absoluteScript)) {
                return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: `${T('init.projectNotFound')}: ${scriptPath}` }] };
            }
            selectedProject = {
                kind: 'cpp',
                project: scriptPath,
                label: `${path.basename(scriptPath, projExt)} (${scriptPath})`,
            };
        } else {
            const match = candidates.find(c => c.project === options.answers!.project || c.label === options.answers!.project);
            if (!match) {
                return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: `${T('init.projectNotFound')}: ${options.answers.project}` }] };
            }
            selectedProject = match;
        }
    } else if (options.interactive) {
        const MANUAL_INPUT = '__manual_input__' as const;
        interface PickerItem { project: string; label: string; kind: 'qt' | 'cpp'; __manual?: boolean }
        let groupCandidates: ProjectCandidate[] = [];
        if (candidates.length > 0) {
            const groups = groupProjectCandidates(candidates);
            const selectedGroup = await chooseRequired(T('init.selectProjectGroup'), groups, group => `${group.name} (${group.candidates.length})`);
            groupCandidates = selectedGroup.candidates;
        }
        const items: PickerItem[] = [
            ...groupCandidates,
            { project: MANUAL_INPUT, label: T('init.manualProjectPath'), kind: 'cpp' as const, __manual: true },
        ];
        const chosen = await chooseRequired(T('init.selectProject'), items, c => c.label);
        if (chosen.__manual) {
            const manualPath = await prompt(T('init.enterProjectPath'));
            if (!manualPath) {
                return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: T('init.projectNotFound') }] };
            }
            const absolutePath = path.isAbsolute(manualPath) ? manualPath : path.join(workroot, manualPath);
            if (!fs.existsSync(absolutePath)) {
                return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: `${T('init.projectNotFound')}: ${manualPath}` }] };
            }
            const ext = path.extname(manualPath).toLowerCase();
            const typeInfo = detectProjectType(absolutePath);
            selectedProject = {
                kind: typeInfo.usesQt ? 'qt' : 'cpp',
                project: manualPath,
                label: `${path.basename(manualPath, ext)} (${manualPath})`,
            };
        } else {
            selectedProject = chosen;
        }
    } else {
        return {
            ok: false,
            action: 'init',
            diagnostics: [{ level: 'error', message: candidates.length === 0 ? T('init.noProjectsFound') : T('init.answersMissingProject') }],
        };
    }

    if (options.interactive) {
        console.log(`  ${T('selectedMark')} ${selectedProject.label}`);
    }

    if (!options.interactive) {
        const questions: Question[] = [];
        if (!options.answers?.mode) {
            questions.push({ id: 'mode', label: T('init.selectMode'), choices: ['debug', 'release'] });
        }
        if (process.platform === 'win32' && !options.answers?.arch) {
            questions.push({ id: 'arch', label: T('init.selectArch'), choices: ['x86', 'x64'] });
        }
        setSilent(true);
        let initialEnv;
        try { initialEnv = await detectEnv(); } finally { setSilent(false); }
        if (selectedProject.kind === 'qt' &&
            initialEnv.qtCandidates.length > 1 && !options.answers?.qtPath) {
            questions.push({
                id: 'qtPath',
                label: T('setupQuestionQtPath'),
                choices: initialEnv.qtCandidates.map(q => q.path),
            });
        }
        if (initialEnv.vsCandidates.length > 1 && !options.answers?.vsInstall) {
            questions.push({
                id: 'vsInstall',
                label: T('setupQuestionVsInstall'),
                choices: initialEnv.vsCandidates.map(v => v.installPath),
            });
        }
        if (questions.length > 0) {
            return {
                ok: false,
                action: 'init',
                workroot,
                questions,
                nextAction: 'forja init --answers <answers.json>',
            };
        }
    }

    // Detect toolchain
    setSilent(true);
    let env;
    try { env = await detectEnv(); } finally { setSilent(false); }

    let qtPath: string | undefined;
    let vsInstall: string | undefined;
    let jomPath: string | undefined;

    if (selectedProject.kind === 'qt') {
        // Qt project — need Qt + VS
        if (options.answers?.qtPath) {
            qtPath = options.answers.qtPath;
        } else if (options.interactive && env.qtCandidates.length > 1) {
            const chosen = await choose(T('init.selectQt'), env.qtCandidates, q => `${q.version} — ${q.path}`);
            if (chosen) qtPath = chosen.path;
        } else if (env.qt) {
            qtPath = env.qt.path;
        }

        if (options.answers?.vsInstall) {
            vsInstall = options.answers.vsInstall;
        } else if (options.interactive && env.vsCandidates.length > 1) {
            const chosen = await choose(T('init.selectVs'), env.vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) vsInstall = chosen.installPath;
        } else if (env.vs) {
            vsInstall = env.vs.installPath;
        }

        if (env.jom) jomPath = env.jom;
    } else {
        // C++ project — need VS only
        if (options.answers?.vsInstall) {
            vsInstall = options.answers.vsInstall;
        } else if (options.interactive && env.vsCandidates.length > 1) {
            const chosen = await choose(T('init.selectVs'), env.vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) vsInstall = chosen.installPath;
        } else if (env.vs) {
            vsInstall = env.vs.installPath;
        }
    }

    // Mode — validate from answers
    let mode: 'debug' | 'release' | undefined;
    if (options.answers?.mode) {
        if (options.answers.mode === 'debug' || options.answers.mode === 'release') {
            mode = options.answers.mode;
        } else {
            return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: T('init.invalidMode', [options.answers.mode]) }] };
        }
    } else if (options.interactive) {
        const chosen = await chooseRequired(T('init.selectMode'), [
            { value: 'debug' as const, label: `debug` },
            { value: 'release' as const, label: `release` },
        ], item => item.label);
        mode = chosen.value;
    }

    // Arch — validate from answers
    let arch: 'x86' | 'x64' | undefined = process.platform === 'win32' ? undefined : 'x64';
    if (options.answers?.arch) {
        if (options.answers.arch === 'x86' || options.answers.arch === 'x64') {
            arch = options.answers.arch;
        } else {
            return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: T('init.invalidArch', [options.answers.arch]) }] };
        }
    } else if (options.interactive && process.platform === 'win32') {
        const chosen = await chooseRequired(T('init.selectArch'), [
            { value: 'x86' as const, label: `x86` },
            { value: 'x64' as const, label: `x64` },
        ], item => item.label);
        arch = chosen.value;
    }

    if (!mode || !arch) {
        return {
            ok: false,
            action: 'init',
            workroot,
            diagnostics: [{ level: 'error', message: T('init.configurationCancelled') }],
        };
    }

    const existingIds = new Set(Object.keys(config.targets));
    const id = generateTargetId(selectedProject.kind, selectedProject.project, mode, arch, existingIds);
    const basename = path.basename(selectedProject.project, path.extname(selectedProject.project));

    // Resolve Qt version — try exact match first, then extract from path as fallback
    let qtVersion: string | undefined;
    if (qtPath) {
        const exact = env.qtCandidates.find(q => q.path === qtPath);
        if (exact) {
            qtVersion = exact.version;
        } else {
            // Extract the LAST X.Y.Z match (handles paths like /opt/1.2.3/Qt/6.5.3/)
            const matches = [...qtPath.matchAll(/(\d+\.\d+\.\d+)/g)];
            if (matches.length > 0) qtVersion = matches[matches.length - 1][1];
        }
    }

    const target: TargetProfile = {
        id,
        name: `${basename} ${mode} ${arch}`,
        kind: selectedProject.kind,
        project: selectedProject.project,
        mode,
        arch,
        toolchain: {
            qtPath,
            qtVersion,
            vsInstall,
            jomPath,
        },
    };

    config.targets[id] = target;
    config.activeTarget = id;

    // RCC project path (Qt projects only)
    if (selectedProject.kind === 'qt') {
        const rccPath = await promptRccProjectPath(workroot, options.interactive, options.answers?.rccProjectPath);
        if (rccPath !== undefined) { config.qtModulePrefs.rccProjectPath = rccPath; }
    }

    try { saveWorkspaceConfig(config); } catch (e) {
        return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: `${T('use.failedToSaveTarget')}: ${e instanceof Error ? e.message : String(e)}` }] };
    }

    return { ok: true, action: 'init', target };
}

async function configureTargetFields(target: TargetProfile, options: InitOptions, workroot?: string): Promise<{ ok: true; target: TargetProfile; rccProjectPath?: string } | { ok: false; diagnostics: Diagnostic[] }> {
    setSilent(true);
    let env;
    try { env = await detectEnv(); } finally { setSilent(false); }

    const updated = { ...target, toolchain: { ...target.toolchain } };

    // Re-detect toolchain — answers take priority, then interactive, then auto-detect
    // In modify mode: only auto-apply single-candidate detection when not previously configured
    if (target.kind === 'qt') {
        if (options.answers?.qtPath) {
            updated.toolchain.qtPath = options.answers.qtPath;
        } else if (options.interactive && env.qtCandidates.length > 1) {
            const chosen = await choose(T('init.selectQt'), env.qtCandidates, q => `${q.version} — ${q.path}`);
            if (chosen) {
                updated.toolchain.qtPath = chosen.path;
                updated.toolchain.qtVersion = chosen.version;
            }
        } else if (env.qt && !target.toolchain.qtPath) {
            // Only auto-apply if not previously configured
            updated.toolchain.qtPath = env.qt.path;
            updated.toolchain.qtVersion = env.qt.version;
        }

        if (options.answers?.vsInstall) {
            updated.toolchain.vsInstall = options.answers.vsInstall;
        } else if (options.interactive && env.vsCandidates.length > 1) {
            const chosen = await choose(T('init.selectVs'), env.vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) updated.toolchain.vsInstall = chosen.installPath;
        } else if (env.vs && !target.toolchain.vsInstall) {
            // Only auto-apply if not previously configured
            updated.toolchain.vsInstall = env.vs.installPath;
        }

        if (env.jom && !target.toolchain.jomPath) updated.toolchain.jomPath = env.jom;
    } else {
        if (options.answers?.vsInstall) {
            updated.toolchain.vsInstall = options.answers.vsInstall;
        } else if (options.interactive && env.vsCandidates.length > 1) {
            const chosen = await choose(T('init.selectVs'), env.vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) updated.toolchain.vsInstall = chosen.installPath;
        } else if (env.vs && !target.toolchain.vsInstall) {
            // Only auto-apply if not previously configured
            updated.toolchain.vsInstall = env.vs.installPath;
        }
    }

    // Mode — validate from answers
    if (options.answers?.mode) {
        if (options.answers.mode === 'debug' || options.answers.mode === 'release') {
            updated.mode = options.answers.mode;
        } else {
            return { ok: false, diagnostics: [{ level: 'error', message: T('init.invalidMode', [options.answers.mode]) }] };
        }
    } else if (options.interactive) {
        const chosen = await chooseRequired(T('init.selectMode'), [
            { value: 'debug' as const, label: `debug ${updated.mode === 'debug' ? T('currentMarker') : ''}` },
            { value: 'release' as const, label: `release ${updated.mode === 'release' ? T('currentMarker') : ''}` },
        ], item => item.label);
        updated.mode = chosen.value;
    }

    // Arch — validate from answers
    if (options.answers?.arch) {
        if (options.answers.arch === 'x86' || options.answers.arch === 'x64') {
            updated.arch = options.answers.arch;
        } else {
            return { ok: false, diagnostics: [{ level: 'error', message: T('init.invalidArch', [options.answers.arch]) }] };
        }
    } else if (options.interactive && process.platform === 'win32') {
        const chosen = await chooseRequired(T('init.selectArch'), [
            { value: 'x86' as const, label: `x86 ${updated.arch === 'x86' ? T('currentMarker') : ''}` },
            { value: 'x64' as const, label: `x64 ${updated.arch === 'x64' ? T('currentMarker') : ''}` },
        ], item => item.label);
        updated.arch = chosen.value;
    }

    // Update name
    const basename = path.basename(target.project, path.extname(target.project));
    updated.name = `${basename} ${updated.mode} ${updated.arch}`;

    // RCC project path (Qt projects only)
    let rccProjectPath: string | undefined;
    if (target.kind === 'qt' && workroot) {
        rccProjectPath = await promptRccProjectPath(workroot, options.interactive, options.answers?.rccProjectPath);
    }

    return { ok: true, target: updated, rccProjectPath };
}
