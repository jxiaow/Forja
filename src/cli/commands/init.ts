/**
 * `forja init` — register a workroot and configure initial target.
 */
import * as path from 'path';
import * as fs from 'fs';
import { T, diag, Diagnostic, Question } from './types';
import type { ForjaJsonResult } from './types';
import {
    resolveWorkroot, isWorkrootRegistered, registerWorkroot,
    loadWorkspaceConfig, saveWorkspaceConfig, createEmptyWorkspaceConfig,
    generateTargetId, getActiveTarget,
    type WorkspaceConfig, type TargetProfile,
} from '../../core/workspaceStore';
import { scanProFiles } from '../../qt/shared/projectScanner';
import { scanSdkProjects } from '../../core/sdkProjectScanner';
import { detectProjectType } from '../../core/projectTypeDetector';
import { detectEnv } from '../../qt/env/envDetector';
import { setSilent } from '../../core/loggerBase';
import { confirm, prompt, choose, chooseRequired } from './prompt';

// ── Result type ──

export interface InitResult extends ForjaJsonResult {
    action: 'init';
    workroot?: string;
    registered?: boolean;
    target?: TargetProfile;
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
    // Resolve workroot
    const workroot = options.workroot ? path.resolve(options.workroot) : cwd;

    if (!fs.existsSync(workroot)) {
        return {
            ok: false, action: 'init',
            diagnostics: [{ level: 'error', message: `${T('init.workrootNotFound')}: ${workroot}` }],
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

    if (!options.interactive) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.workrootAlreadyRegistered') }],
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
        { value: 'exit', label: T('init.exitAction') },
    ], item => item.label);

    if (!action || action.value === 'exit') {
        return { ok: true, action: 'init', workroot };
    }

    if (action.value === 'modify') {
        return handleModifyTarget(workroot, config, options);
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

async function handleModifyTarget(workroot: string, config: WorkspaceConfig, options: InitOptions): Promise<InitResult> {
    const targets = Object.values(config.targets);
    if (targets.length === 0) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.noTargetsToModify') }],
            nextAction: 'forja init',
        };
    }

    const selected = await chooseRequired(T('init.selectTargetToModify'), targets, t => `${t.name} [${t.kind}] ${t.project}`);

    // Re-detect toolchain and reconfigure
    const updated = await configureTargetFields(selected, options);
    if (!updated) {
        return { ok: false, action: 'init', workroot, diagnostics: [{ level: 'error', message: T('init.configurationCancelled') }] };
    }

    config.targets[updated.id] = updated;
    saveWorkspaceConfig(config);

    return {
        ok: true, action: 'init', workroot,
        target: updated,
        nextAction: 'forja status',
    };
}

// ── New workroot ──

async function handleNewWorkroot(workroot: string, options: InitOptions): Promise<InitResult> {
    if (options.json && !options.answers) {
        // Scan and return questions
        const candidates = await scanProjects(workroot);
        if (candidates.length === 0) {
            return {
                ok: false, action: 'init', workroot,
                diagnostics: [{ level: 'error', message: T('init.noProjectsFound') }],
            };
        }
        const questions: Question[] = [
            { id: 'project', label: T('init.selectProject'), choices: candidates.map(c => c.project) },
            { id: 'mode', label: T('init.selectMode'), choices: ['debug', 'release'] },
            { id: 'arch', label: T('init.selectArch'), choices: ['x86', 'x64'] },
        ];
        return {
            ok: false, action: 'init', workroot,
            questions,
            nextAction: 'forja init --answers <answers.json>',
        };
    }

    if (!options.interactive) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.workrootNotRegistered') }],
            nextAction: 'forja init',
        };
    }

    // Interactive flow
    console.log(T('init.newWorkroot'));
    console.log(`  ${T('init.workroot')}: ${workroot}`);

    const candidates = await scanProjects(workroot);
    if (candidates.length === 0) {
        return {
            ok: false, action: 'init', workroot,
            diagnostics: [{ level: 'error', message: T('init.noProjectsFound') }],
        };
    }

    console.log(`  ${T('init.foundProjects')}: ${candidates.length}`);

    const config = createEmptyWorkspaceConfig(workroot);

    // Register workroot FIRST so resolveWorkroot can find it even if config save fails
    registerWorkroot(workroot);

    const result = await configureNewTarget(workroot, config, options);
    if (!result.ok) return result;

    return {
        ok: true, action: 'init', workroot,
        registered: true,
        target: result.target,
        nextAction: 'forja status',
    };
}

// ── Shared helpers ──

interface ProjectCandidate {
    kind: 'qt' | 'sdk';
    project: string;
    label: string;
}

async function scanProjects(workroot: string): Promise<ProjectCandidate[]> {
    const candidates: ProjectCandidate[] = [];

    // Scan Qt projects (.pro files)
    setSilent(true);
    const proFiles = scanProFiles(workroot);
    setSilent(false);
    for (const pro of proFiles) {
        candidates.push({
            kind: 'qt',
            project: pro,
            label: `${path.basename(pro, '.pro')} (${pro})`,
        });
    }

    // Scan SDK projects
    setSilent(true);
    const sdkFiles = scanSdkProjects({ workspace: workroot, relativePaths: true });
    setSilent(false);
    for (const sdkFile of sdkFiles) {
        const fullPath = path.join(workroot, sdkFile);
        const typeInfo = detectProjectType(fullPath);
        const kind = typeInfo.usesQt ? 'qt' : 'sdk';
        // Skip if already found as .pro
        if (!candidates.some(c => c.project === sdkFile)) {
            candidates.push({
                kind,
                project: sdkFile,
                label: `${path.basename(sdkFile, path.extname(sdkFile))} (${sdkFile})`,
            });
        }
    }

    return candidates;
}

async function configureNewTarget(workroot: string, config: WorkspaceConfig, options: InitOptions): Promise<{ ok: boolean; action: 'init'; target?: TargetProfile; diagnostics?: Diagnostic[] }> {
    const candidates = await scanProjects(workroot);
    if (candidates.length === 0) {
        return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: T('init.noProjectsFound') }] };
    }

    // Select project
    let selectedProject: ProjectCandidate;
    if (options.answers?.project) {
        const match = candidates.find(c => c.project === options.answers!.project || c.label === options.answers!.project);
        if (!match) {
            return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: `${T('init.projectNotFound')}: ${options.answers.project}` }] };
        }
        selectedProject = match;
    } else if (options.interactive) {
        const chosen = await chooseRequired(T('init.selectProject'), candidates, c => c.label);
        selectedProject = chosen;
    } else {
        return { ok: false, action: 'init', diagnostics: [{ level: 'error', message: T('init.noProjectsFound') }] };
    }

    console.log(`  ✓ ${selectedProject.label}`);

    // Detect toolchain
    setSilent(true);
    const env = await detectEnv();
    setSilent(false);

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
        // SDK project — need VS only
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
    let mode: 'debug' | 'release' = 'debug';
    if (options.answers?.mode === 'debug' || options.answers?.mode === 'release') {
        mode = options.answers.mode;
    } else if (options.interactive) {
        const chosen = await choose(T('init.selectMode'), [
            { value: 'debug' as const, label: 'debug' },
            { value: 'release' as const, label: 'release' },
        ], item => item.label);
        if (chosen) mode = chosen.value;
    }

    // Arch — validate from answers
    let arch: 'x86' | 'x64' = process.platform === 'win32' ? 'x86' : 'x64';
    if (options.answers?.arch === 'x86' || options.answers?.arch === 'x64') {
        arch = options.answers.arch;
    } else if (options.interactive && process.platform === 'win32') {
        const chosen = await choose(T('init.selectArch'), [
            { value: 'x86' as const, label: 'x86' },
            { value: 'x64' as const, label: 'x64' },
        ], item => item.label);
        if (chosen) arch = chosen.value;
    }

    const existingIds = new Set(Object.keys(config.targets));
    const id = generateTargetId(selectedProject.kind, selectedProject.project, mode, arch, existingIds);
    const basename = path.basename(selectedProject.project, path.extname(selectedProject.project));

    const target: TargetProfile = {
        id,
        name: `${basename} ${mode} ${arch}`,
        kind: selectedProject.kind,
        project: selectedProject.project,
        mode,
        arch,
        runAt: 'local',
        toolchain: {
            qtPath,
            qtVersion: qtPath ? env.qtCandidates.find(q => q.path === qtPath)?.version : undefined,
            vsInstall,
            jomPath,
        },
    };

    config.targets[id] = target;
    config.activeTarget = id;
    saveWorkspaceConfig(config);

    return { ok: true, action: 'init', target };
}

async function configureTargetFields(target: TargetProfile, options: InitOptions): Promise<TargetProfile | null> {
    setSilent(true);
    const env = await detectEnv();
    setSilent(false);

    const updated = { ...target, toolchain: { ...target.toolchain } };

    // Re-detect toolchain — answers take priority, then interactive, then auto-detect
    if (target.kind === 'qt') {
        if (options.answers?.qtPath) {
            updated.toolchain.qtPath = options.answers.qtPath;
        } else if (options.interactive && env.qtCandidates.length > 1) {
            const chosen = await choose(T('init.selectQt'), env.qtCandidates, q => `${q.version} — ${q.path}`);
            if (chosen) {
                updated.toolchain.qtPath = chosen.path;
                updated.toolchain.qtVersion = chosen.version;
            }
        } else if (env.qt) {
            updated.toolchain.qtPath = env.qt.path;
            updated.toolchain.qtVersion = env.qt.version;
        }

        if (options.answers?.vsInstall) {
            updated.toolchain.vsInstall = options.answers.vsInstall;
        } else if (options.interactive && env.vsCandidates.length > 1) {
            const chosen = await choose(T('init.selectVs'), env.vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) updated.toolchain.vsInstall = chosen.installPath;
        } else if (env.vs) {
            updated.toolchain.vsInstall = env.vs.installPath;
        }

        if (env.jom) updated.toolchain.jomPath = env.jom;
    } else {
        if (options.answers?.vsInstall) {
            updated.toolchain.vsInstall = options.answers.vsInstall;
        } else if (options.interactive && env.vsCandidates.length > 1) {
            const chosen = await choose(T('init.selectVs'), env.vsCandidates, v => `${v.version} ${v.edition} — ${v.installPath}`);
            if (chosen) updated.toolchain.vsInstall = chosen.installPath;
        } else if (env.vs) {
            updated.toolchain.vsInstall = env.vs.installPath;
        }
    }

    // Mode — validate from answers
    if (options.answers?.mode === 'debug' || options.answers?.mode === 'release') {
        updated.mode = options.answers.mode;
    } else if (options.interactive) {
        const chosen = await choose(T('init.selectMode'), [
            { value: 'debug' as const, label: `debug ${updated.mode === 'debug' ? '(current)' : ''}` },
            { value: 'release' as const, label: `release ${updated.mode === 'release' ? '(current)' : ''}` },
        ], item => item.label);
        if (chosen) updated.mode = chosen.value;
    }

    // Arch — validate from answers
    if (options.answers?.arch === 'x86' || options.answers?.arch === 'x64') {
        updated.arch = options.answers.arch;
    } else if (options.interactive && process.platform === 'win32') {
        const chosen = await choose(T('init.selectArch'), [
            { value: 'x86' as const, label: `x86 ${updated.arch === 'x86' ? '(current)' : ''}` },
            { value: 'x64' as const, label: `x64 ${updated.arch === 'x64' ? '(current)' : ''}` },
        ], item => item.label);
        if (chosen) updated.arch = chosen.value;
    }

    // Update name
    const basename = path.basename(target.project, path.extname(target.project));
    updated.name = `${basename} ${updated.mode} ${updated.arch}`;

    return updated;
}
