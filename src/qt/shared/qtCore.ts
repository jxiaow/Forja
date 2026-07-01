import * as fs from 'fs';
import * as path from 'path';
import { CliOptions, CliResolvedConfig, CliResult } from '../cli/types';
import { detectEnv } from '../env/envDetector';
import { createShellPlanBuilder } from '../platform/shellPlan';
import { winConfig } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import { resolveBuildConfig } from './configResolver';
import { scanProFiles, parseProFile } from './projectScanner';
import {
    ensureLocalStateDir,
} from './localState';
import { loadQtSettings, saveQtSettings, resolveConfigPath, QtSettings, resolveVsDevShellPath, inferVsInstall } from '../../core/settingsIO';
import { buildRunCommand } from './commandRunner';
import { resolveRuntimeTarget, validateMakefile } from './runtimeTarget';
import { resolveRccProjectPath, scanRccTargets, rccNeedsRebuild, buildRccCommands } from './rccResolver';
import { getPlatformRequirements, checkToolsReady, getMissingTools, getAvailableArch, getDefaultArch } from '../platform/requirements';

function emptyResult(options: CliOptions, workspace: string): CliResult {
    return {
        ok: false,
        action: options.action,
        mode: options.executionMode,
        workspace,
        project: null,
        commands: [],
        shellCommand: '',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        diagnostics: [],
        resolved: null
    };
}

function resolveWorkspace(input: string | null): string {
    return path.resolve(input || process.cwd());
}

function getQtPathEnv(): string {
    return process.env.FORJA_QT_PATH || '';
}

function getVsDevShellEnv(): string {
    return process.env.FORJA_VS_DEV_SHELL || '';
}

function withoutConfigOptions(options: CliOptions): CliOptions {
    return {
        ...options,
        project: null,
        mode: null,
        arch: null,
        qtPath: null,
        vsDevShell: null,
        target: null,
        qmakeArgs: null
    };
}

function insideWorkspace(workspace: string, filePath: string): boolean {
    const rel = path.relative(workspace, filePath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveExplicitProject(workspace: string, projectInput: string): { project: string | null; error: string | null } {
    const explicitProject = path.isAbsolute(projectInput) ? path.resolve(projectInput) : path.resolve(workspace, projectInput);
    if (!insideWorkspace(workspace, explicitProject)) {
        return { project: null, error: '.pro 文件必须位于 workspace 内' };
    }
    if (path.extname(explicitProject).toLowerCase() !== '.pro') {
        return { project: null, error: '项目文件必须是 .pro 文件' };
    }
    if (!fs.existsSync(explicitProject)) {
        return { project: null, error: `项目文件不存在: ${explicitProject}` };
    }
    return { project: explicitProject, error: null };
}

function resolveSavedProject(workspace: string, settings: QtSettings): { project: string | null; error: string | null } {
    const selectedProj = settings.pinnedProject;
    const savedProject = selectedProj ? path.join(selectedProj.root, selectedProj.relative) : null;
    if (savedProject && fs.existsSync(savedProject)) {
        return { project: savedProject, error: null };
    }
    if (savedProject) {
        return { project: null, error: `已配置项目不存在: ${savedProject}` };
    }
    if (settings.manualProPath && fs.existsSync(settings.manualProPath)) {
        return { project: settings.manualProPath, error: null };
    }
    if (settings.manualProPath) {
        return { project: null, error: `已配置项目不存在: ${settings.manualProPath}` };
    }
    return { project: null, error: '未配置项目。请先运行 forja list targets --json 查看候选，再用 forja use target --project <path> --json 选择项目。' };
}

function resolveInitProject(workspace: string, options: CliOptions, settings: QtSettings): { project: string | null; error: string | null } {
    const explicitProject = options.project
        ? resolveExplicitProject(workspace, options.project)
        : null;
    if (explicitProject) {
        return explicitProject;
    }
    const savedProject = resolveSavedProject(workspace, settings);
    if (savedProject.project) {
        return savedProject;
    }
    const found = scanProFiles(workspace).map(rel => path.join(workspace, rel));
    if (found.length === 1) {
        return { project: found[0], error: null };
    }
    if (found.length > 1) {
        return { project: null, error: `发现多个 .pro 文件: ${found.join(', ')}。请先运行 forja list targets --json 查看候选，再用 forja use target --project <path> --json 选择项目。` };
    }
    return { project: null, error: '未找到 .pro 文件。请在工作区中创建 .pro 文件，或用 forja use target --project <path> --json 选择已有项目。' };
}

function buildResolvedConfig(
    mode: CliResolvedConfig['mode'],
    arch: CliResolvedConfig['arch'],
    qtPath: string,
    vsDevShell: string,
    target: string,
    qtVersion?: string,
    vsVersion?: string,
    jomPath?: string
): CliResolvedConfig {
    const config: CliResolvedConfig = { mode, arch, qtPath, vsDevShell, target: target };
    if (jomPath) { config.jomPath = jomPath; }
    if (qtVersion) { config.qtVersion = qtVersion; }
    if (vsVersion) { config.vsVersion = vsVersion; }
    return config;
}

function buildProjectSelectionActions(): string[] {
    return [
        'forja list targets --json',
        'forja use target --project <path> --json'
    ];
}

function buildToolchainActions(missingTools: ReturnType<typeof getMissingTools>): string[] {
    const actions = ['forja list env --json'];
    for (const tool of missingTools) {
        if (tool.cliFlag) {
            actions.push(`forja use qt ${tool.cliFlag.replace(/<[^>]+>/g, '<path>')} --json`);
        }
    }
    return actions;
}

function getUnconfirmedBuildConfig(settings: QtSettings): Array<'mode' | 'arch'> {
    const missing: Array<'mode' | 'arch'> = [];
    if (!settings.mode) { missing.push('mode'); }
    if (!settings.arch) { missing.push('arch'); }
    return missing;
}

function buildConfigConfirmationActions(unconfirmed: Array<'mode' | 'arch'>): string[] {
    if (unconfirmed.length === 0) { return []; }
    const parts: string[] = [];
    if (unconfirmed.includes('mode')) { parts.push('--mode debug'); }
    if (unconfirmed.includes('arch')) { parts.push(`--arch ${getDefaultArch()}`); }
    return [`forja use target ${parts.join(' ')} --json`];
}

function buildStatusGuidance(
    hasSettings: boolean,
    projectExists: boolean,
    unconfirmedBuildConfig: Array<'mode' | 'arch'>,
    missingTools: ReturnType<typeof getMissingTools>,
    hasMakefile: boolean,
    hasExecutable: boolean
): { nextAction: string } {
    if (!hasSettings) {
        return { nextAction: 'forja setup --json' };
    }
    if (!projectExists) {
        return { nextAction: 'forja list targets --json' };
    }
    if (unconfirmedBuildConfig.length > 0) {
        return { nextAction: buildConfigConfirmationActions(unconfirmedBuildConfig)[0] || 'forja use target --json' };
    }
    if (missingTools.length > 0) {
        return { nextAction: buildToolchainActions(missingTools)[0] || 'forja list env --json' };
    }
    if (!hasMakefile) {
        return { nextAction: 'forja build --json' };
    }
    if (!hasExecutable) {
        return { nextAction: 'forja build --json' };
    }
    return { nextAction: 'forja run --json' };
}

interface InitDiagnosticsInput {
    options: CliOptions;
    qtCandidates: Array<{path: string; version: string; compiler: string}>;
    projects: string[];
    project: string | null;
    effectiveSettings: QtSettings;
}

function buildInitDiagnostics(input: InitDiagnosticsInput): CliResult['diagnostics'] {
    const diagnostics: CliResult['diagnostics'] = [];

    // 合并 env 相关的自动选择提示为一条 warning
    const autoSelected: string[] = [];
    if (!input.options.qtPath && input.qtCandidates.length > 1) { autoSelected.push('qtPath'); }
    if (autoSelected.length > 0) {
        diagnostics.push({ level: 'warning', message: `部分配置为自动选择（${autoSelected.join(', ')}），可用 forja list env --json 查看可选项` });
    }

    // 项目相关提示
    if (!input.project) {
        const proCount = input.projects.length;
        if (proCount > 1) {
            diagnostics.push({ level: 'warning', message: `发现 ${proCount} 个 .pro 文件，未自动选择，可用 forja list targets --json 查看全部` });
        } else if (proCount === 0) {
            diagnostics.push({ level: 'warning', message: '未检测到 .pro 文件' });
        }
    }

    // 缺失工具链（平台自适应）
    const missing = getMissingTools(input.effectiveSettings);
    for (const tool of missing) {
        const msg = `未检测到 ${tool.label}${tool.missingHint ? '，' + tool.missingHint : ''}`;
        diagnostics.push({ level: 'warning', message: msg });
    }

    return diagnostics;
}

function buildInitNextAction(project: string | null, projects: string[], missingTools: ReturnType<typeof getMissingTools>, autoSelected: string[] = []): string | undefined {
    if (autoSelected.includes('qtPath')) {
        return 'forja list env --json';
    }
    if (!project) {
        if (projects.length > 1) {
            return buildProjectSelectionActions()[0];
        } else if (projects.length === 0) {
            return '在工作区中创建 .pro 文件';
        }
    }
    if (missingTools.length > 0) {
        return buildToolchainActions(missingTools)[0];
    }
    return 'forja status --json';
}

async function detectEnvironment(workspace: string, options: CliOptions): Promise<{
    detected: {
        qt: { path: string; qmake: string; version?: string; compiler?: string } | null;
        vs: { devShellPath: string; version?: string; edition?: string } | null;
        jom: string | null;
        projects: string[];
    };
    qtCandidates: Array<{path: string; version: string; compiler: string}>;
    vsCandidates: Array<{version: string; edition: string; installPath: string; devShellPath: string}>;
}> {
    const env = await detectEnv(options.qtPath || undefined, options.vsDevShell || undefined).catch(() => ({
        vs: null,
        qt: null,
        qtCandidates: [] as Array<{path: string; version: string; compiler: string}>,
        vsCandidates: [] as Array<{version: string; edition: string; installPath: string; devShellPath: string}>,
        jom: null as string | null
    }));
    const qtPath = env.qt?.path || options.qtPath || '';
    return {
        detected: {
            qt: qtPath ? {
                path: qtPath,
                qmake: path.join(qtPath, 'bin', process.platform === 'win32' ? 'qmake.exe' : 'qmake'),
                version: env.qt?.version || undefined,
                compiler: env.qt?.compiler || undefined
            } : null,
            vs: env.vs?.devShellPath ? {
                devShellPath: env.vs.devShellPath,
                version: env.vs.version || undefined,
                edition: env.vs.edition || undefined
            } : null,
            jom: env.jom,
            projects: scanProFiles(workspace).map(rel => path.join(workspace, rel))
        },
        qtCandidates: env.qtCandidates || [],
        vsCandidates: env.vsCandidates || []
    };
}

function handleStatusAction(workspace: string, options: CliOptions, settings: QtSettings, result: CliResult): CliResult {
    const hasSettings = fs.existsSync(resolveConfigPath(workspace, 'qt'));
    const selectedProj = settings.pinnedProject;
    const projectRel = selectedProj ? selectedProj.relative : null;
    const projectFull = selectedProj ? path.join(selectedProj.root, selectedProj.relative) : null;
    const projectExists = projectFull ? fs.existsSync(projectFull) : false;

    const unconfirmedBuildConfig = getUnconfirmedBuildConfig(settings);
    const modeConfirmed = !!settings.mode;
    const archConfirmed = !!settings.arch;
    const mode = settings.mode || 'debug';
    const arch = settings.arch || getDefaultArch();
    const qtPath = settings.qtPath || '';
    const vsDevShell = resolveVsDevShellPath(settings.vsInstall) || '';
    const jomPath = settings.jomPath || '';
    const targetOverride = settings.target || '';
    const qmakeArgs = settings.qmakeArgs || '';
    const projectInfo = projectFull && projectExists ? parseProFile(projectFull) : null;
    const target = projectExists ? (targetOverride || projectInfo?.target || (projectRel ? path.basename(projectRel, '.pro') : '')) : '';

    const projectDir = projectFull ? path.dirname(projectFull) : null;
    const makefileValidation = projectDir ? validateMakefile(projectDir, { mode, arch, qtPath, proFile: projectFull || '', target: targetOverride, qmakeArgs }) : { exists: false, matches: false };
    const hasMakefile = makefileValidation.exists && makefileValidation.matches;
    const runtimeTarget = (hasMakefile && projectDir) ? resolveRuntimeTarget(projectDir, mode, arch) : null;
    const hasExecutable = runtimeTarget ? fs.existsSync(runtimeTarget.exePath) : false;

    const { allReady: toolsReady, checks: toolChecks } = checkToolsReady(settings);
    const missingTools = getMissingTools(settings);
    const checks: Record<string, boolean> = {
        settings: hasSettings,
        project: projectExists,
        mode: modeConfirmed,
        arch: archConfirmed,
        ...toolChecks,
        makefile: hasMakefile,
        executable: hasExecutable
    };

    const guidance = buildStatusGuidance(hasSettings, projectExists, unconfirmedBuildConfig, missingTools, hasMakefile, hasExecutable);
    const ready = hasSettings && projectExists && modeConfirmed && archConfirmed && toolsReady && hasMakefile;

    const diagnostics: CliResult['diagnostics'] = [];
    if (!hasSettings) {
        diagnostics.push({ level: 'warning', message: '尚未初始化' });
    } else {
        if (!projectExists) {
            diagnostics.push({ level: 'warning', message: '未配置项目' });
        }
        if (!modeConfirmed) {
            diagnostics.push({ level: 'warning', message: '未确认构建模式（默认建议 debug）' });
        }
        if (!archConfirmed) {
            diagnostics.push({ level: 'warning', message: `未确认目标架构（默认建议 ${getDefaultArch()}）` });
        }
        for (const tool of missingTools) {
            diagnostics.push({ level: 'warning', message: `未配置 ${tool.label}` });
        }
    }
    if (makefileValidation.exists && !makefileValidation.matches) {
        diagnostics.push({ level: 'warning', message: `Makefile 与当前配置不匹配（${makefileValidation.mismatch!.join(', ')}）` });
    }

    const statusResolved = buildResolvedConfig(mode, arch, qtPath, vsDevShell, target, undefined, undefined, jomPath || undefined);
    if (projectRel) {
        statusResolved.project = projectRel;
    }

    const rccPath = resolveRccProjectPath(settings.rccProjectPath || '', workspace);

    const statusResult: Record<string, unknown> = {
        ok: true,
        action: 'status',
        workspace,
        ready,
        checks,
        nextAction: guidance.nextAction,
    };

    const missing: string[] = [];
    if (!hasSettings) { missing.push('settings'); }
    if (hasSettings) {
        if (!projectExists) { missing.push('project'); }
        missing.push(...unconfirmedBuildConfig);
        for (const tool of missingTools) { missing.push(tool.key); }
    }
    if (makefileValidation.exists && !makefileValidation.matches) { missing.push('makefile'); }
    else if (!makefileValidation.exists && projectExists) { missing.push('makefile'); }
    if (hasMakefile && !hasExecutable) { missing.push('executable'); }
    if (missing.length > 0) { statusResult.missing = missing; }

    if (diagnostics.length > 0) { statusResult.diagnostics = diagnostics; }
    if (rccPath) { statusResult.rccProjectPath = rccPath; }

    result.ok = true;
    result.resolved = statusResolved;
    result.nextAction = guidance.nextAction;
    result.data = statusResult;
    result.stdout = JSON.stringify(statusResult);
    return result;
}

function handleEnvAction(workspace: string, options: CliOptions, settings: QtSettings, result: CliResult): Promise<CliResult> {
    return detectEnvironment(workspace, options).then(detected => {
        const mode = options.mode || settings.mode || 'debug';
        const arch = options.arch || settings.arch || getDefaultArch();
        const currentQtPath = options.qtPath || settings.qtPath || detected.detected.qt?.path || '';
        const currentVsDevShell = options.vsDevShell || resolveVsDevShellPath(settings.vsInstall) || detected.detected.vs?.devShellPath || '';
        const jomPath = detected.detected.jom || settings.jomPath || '';

        result.ok = true;
        result.diagnostics = [];
        result.resolved = buildResolvedConfig(mode, arch, currentQtPath, currentVsDevShell, '', detected.detected.qt?.version, detected.detected.vs?.version, jomPath || undefined);
        const envData = {
            available: {
                mode: ['debug', 'release'],
                arch: getAvailableArch(),
                qt: detected.qtCandidates.map(c => ({ path: c.path, version: c.version, compiler: c.compiler })),
                ...(process.platform === 'win32' ? { vsDevShell: detected.vsCandidates.map(c => ({ path: c.devShellPath, version: c.version, edition: c.edition })) } : {})
            },
            configHints: {
                usage: 'forja use target --mode <mode> [--arch <arch>] | forja use qt --qt-path <path> [--vs-dev-shell <path>] --json',
                mode: '--mode debug|release',
                ...(getAvailableArch().length > 1 ? { arch: `--arch ${getAvailableArch().join('|')}` } : {}),
                ...Object.fromEntries(
                    getPlatformRequirements()
                        .filter(r => r.cliFlag)
                        .map(r => [r.key, r.cliFlag])
                )
            }
        };
        result.stdout = JSON.stringify(envData);
        result.data = envData;
        return result;
    });
}

function handleProjectsAction(workspace: string, settings: QtSettings, result: CliResult): CliResult {
    const proFiles = scanProFiles(workspace);
    const selectedProj = settings.pinnedProject;
    const currentProject = selectedProj ? selectedProj.relative : null;
    const currentExists = currentProject ? fs.existsSync(path.join(workspace, currentProject)) : false;
    const available = proFiles.map(rel => {
        const fullPath = path.join(workspace, rel);
        const info = parseProFile(fullPath);
        return {
            path: rel,
            target: info?.target || path.basename(rel, '.pro'),
            modules: info?.qtModules || []
        };
    });
    const projectsData: Record<string, unknown> = {
        current: currentProject,
        available,
        configHints: {
            usage: 'forja use target --project <path> --json'
        }
    };
    if (currentProject && !currentExists) {
        projectsData.currentExists = false;
    }
    result.ok = true;
    result.data = projectsData;
    result.stdout = JSON.stringify(projectsData);
    return result;
}

function handleUseAction(workspace: string, options: CliOptions, settings: QtSettings, result: CliResult): CliResult {
    const updatedQt: QtSettings = { ...settings };
    const updated: Record<string, string> = {};
    let project: string | null = settings.pinnedProject
        ? path.join(settings.pinnedProject.root, settings.pinnedProject.relative)
        : null;

    if (options.project) {
        const projectResult = resolveExplicitProject(workspace, options.project);
        if (projectResult.error || !projectResult.project) {
            result.diagnostics.push({ level: 'error', message: projectResult.error || '项目路径无效' });
            result.nextAction = 'forja list targets --json';
            return result;
        }
        project = projectResult.project;
        const relativeProject = path.relative(workspace, project).replace(/\\/g, '/');
        updatedQt.pinnedProject = { root: workspace, relative: relativeProject };
        updated.project = relativeProject;
    }
    if (options.mode) {
        updatedQt.mode = options.mode;
        updated.mode = options.mode;
    }
    if (options.arch) {
        updatedQt.arch = options.arch;
        updated.arch = options.arch;
    }
    if (options.qtPath) {
        updatedQt.qtPath = options.qtPath;
        updated.qtPath = options.qtPath;
    }
    if (options.vsDevShell) {
        updatedQt.vsInstall = inferVsInstall(options.vsDevShell);
        updated.vsDevShell = options.vsDevShell;
    }
    if (options.target) {
        updatedQt.target = options.target;
        updated.target = options.target;
    }
    if (options.qmakeArgs !== undefined && options.qmakeArgs !== null) {
        updatedQt.qmakeArgs = options.qmakeArgs;
        updated.qmakeArgs = options.qmakeArgs;
    }

    if (Object.keys(updated).length === 0) {
        result.diagnostics.push({ level: 'error', message: 'use 需要至少指定一个配置参数' });
        result.nextAction = 'forja use target --mode release --json';
        return result;
    }

    if (options.executionMode === 'execute') {
        saveQtSettings(workspace, updatedQt);
    }

    const mode = updatedQt.mode || 'debug';
    const arch = updatedQt.arch || getDefaultArch();
    const vsDevShell = resolveVsDevShellPath(updatedQt.vsInstall) || options.vsDevShell || '';
    const useResolved = buildResolvedConfig(mode, arch, updatedQt.qtPath || '', vsDevShell, updatedQt.target || '', undefined, undefined, updatedQt.jomPath || undefined);
    if (updatedQt.pinnedProject) {
        useResolved.project = updatedQt.pinnedProject.relative;
    }

    const useData = {
        ok: true,
        action: 'use',
        workspace,
        mode: options.executionMode,
        updated,
        resolved: useResolved,
        nextAction: 'forja status --json'
    };

    return {
        ...result,
        ok: true,
        project,
        diagnostics: options.executionMode === 'dryRun' ? [{ level: 'info', message: '预览配置切换，未写入本地配置' }] : [],
        nextAction: 'forja status --json',
        resolved: useResolved,
        data: useData,
        stdout: JSON.stringify(useData)
    };
}

async function handleInitAction(workspace: string, options: CliOptions, settings: QtSettings, result: CliResult): Promise<CliResult> {
    const effectiveOptions = withoutConfigOptions(options);
    const mode = settings.mode || 'debug';
    const autoArch = getAvailableArch().length === 1 ? getDefaultArch() : '';
    const arch = settings.arch || autoArch || getDefaultArch();
    const qtPath = settings.qtPath || getQtPathEnv();
    const vsDevShell = resolveVsDevShellPath(settings.vsInstall) || getVsDevShellEnv();
    const jomPath = settings.jomPath || '';

    const projectResult = resolveInitProject(workspace, effectiveOptions, settings);
    const project = projectResult.project;
    let effectiveTarget = settings.target || '';
    if (project) {
        if (!effectiveTarget) {
            const proInfo = parseProFile(project);
            if (proInfo) { effectiveTarget = proInfo.target; }
        }
    }

    if (options.executionMode === 'execute') {
        ensureLocalStateDir(workspace);
        const detected = await detectEnvironment(workspace, effectiveOptions);
        const allQtCandidates = detected.qtCandidates;

        const relativeProject = project ? path.relative(workspace, project).replace(/\\/g, '/') : null;
        const updatedQt: QtSettings = {
            ...settings,
            mode: settings.mode,
            arch: settings.arch || autoArch,
            qtPath: qtPath || detected.detected.qt?.path || '',
            vsInstall: settings.vsInstall || inferVsInstall(vsDevShell || detected.detected.vs?.devShellPath || ''),
            jomPath: detected.detected.jom || '',
            target: effectiveTarget,
            pinnedProject: relativeProject ? { root: workspace, relative: relativeProject } : null
        };
        saveQtSettings(workspace, updatedQt);

        const effectiveQtPath = qtPath || detected.detected.qt?.path || '';
        const effectiveVsDevShell = vsDevShell || detected.detected.vs?.devShellPath || '';
        const effectiveSettingsForCheck: QtSettings = {
            ...settings,
            qtPath: effectiveQtPath,
            vsInstall: settings.vsInstall || inferVsInstall(effectiveVsDevShell),
            jomPath: detected.detected.jom || ''
        };
        const initDiagnostics = buildInitDiagnostics({
            options: effectiveOptions,
            qtCandidates: allQtCandidates,
            projects: detected.detected.projects,
            project,
            effectiveSettings: effectiveSettingsForCheck
        });
        const initNextAction = buildInitNextAction(project, detected.detected.projects, getMissingTools(effectiveSettingsForCheck));
        const initResolved = buildResolvedConfig(mode, arch, effectiveQtPath, effectiveVsDevShell, effectiveTarget, detected.detected.qt?.version, detected.detected.vs?.version, detected.detected.jom || undefined);
        if (project) {
            initResolved.project = path.relative(workspace, project).replace(/\\/g, '/');
        }
        return { ...result, ok: true, project, diagnostics: initDiagnostics, nextAction: initNextAction, resolved: initResolved };
    }

    const detected = await detectEnvironment(workspace, effectiveOptions);
    const previewQtPath = qtPath || detected.detected.qt?.path || '';
    const previewVsDevShell = vsDevShell || detected.detected.vs?.devShellPath || '';

    const previewDiagnostics: CliResult['diagnostics'] = [
        { level: 'info', message: '将写入 Forja 本地配置' }
    ];
    const previewSettingsForCheck: QtSettings = {
        ...settings,
        qtPath: previewQtPath,
        vsInstall: settings.vsInstall || inferVsInstall(previewVsDevShell),
        jomPath: detected.detected.jom || ''
    };
    previewDiagnostics.push(...buildInitDiagnostics({
        options: effectiveOptions,
        qtCandidates: detected.qtCandidates,
        projects: detected.detected.projects,
        project,
        effectiveSettings: previewSettingsForCheck
    }));
    const previewNextAction = buildInitNextAction(project, detected.detected.projects, getMissingTools(previewSettingsForCheck));
    const previewResolved = buildResolvedConfig(mode, arch, previewQtPath, previewVsDevShell, settings.target || '', detected.detected.qt?.version, detected.detected.vs?.version, detected.detected.jom || undefined);

    return {
        ...result,
        ok: true,
        project,
        diagnostics: previewDiagnostics,
        nextAction: previewNextAction,
        resolved: previewResolved
    };
}

export async function createActionPlan(options: CliOptions): Promise<CliResult> {
    const workspace = resolveWorkspace(options.workspace);
    const result = emptyResult(options, workspace);

    if (!fs.existsSync(workspace)) {
        result.diagnostics.push({ level: 'error', message: `workspace 不存在: ${workspace}` });
        return result;
    }

    const settings = loadQtSettings(workspace);

    if (options.action === 'status') {
        return handleStatusAction(workspace, options, settings, result);
    }
    if (options.action === 'env') {
        return handleEnvAction(workspace, options, settings, result);
    }
    if (options.action === 'projects') {
        return handleProjectsAction(workspace, settings, result);
    }
    if (options.action === 'use') {
        return handleUseAction(workspace, options, settings, result);
    }
    if (options.action === 'init') {
        return handleInitAction(workspace, options, settings, result);
    }

    const projectResult = resolveSavedProject(workspace, settings);
    if (projectResult.error) {
        const errMode = settings.mode || 'debug';
        const errArch = settings.arch || getDefaultArch();
        const errQtPath = settings.qtPath || getQtPathEnv();
        const errVsDevShell = resolveVsDevShellPath(settings.vsInstall) || getVsDevShellEnv();
        const errQmakeTarget = settings.target || '';
        result.resolved = buildResolvedConfig(errMode, errArch, errQtPath, errVsDevShell, errQmakeTarget, undefined, undefined, settings.jomPath || undefined);
        result.diagnostics.push({ level: 'error', message: projectResult.error });
        result.nextAction = 'forja status --json';
        return result;
    }

    const project = projectResult.project;
    const unconfirmedBuildConfig = getUnconfirmedBuildConfig(settings);
    const mode = settings.mode || 'debug';
    const autoArch = getAvailableArch().length === 1 ? getDefaultArch() : '';
    const arch = settings.arch || autoArch || getDefaultArch();
    const qtPath = settings.qtPath || getQtPathEnv();
    const vsDevShell = resolveVsDevShellPath(settings.vsInstall) || getVsDevShellEnv();
    const target = settings.target || '';
    const qmakeArgs = settings.qmakeArgs || '';
    const jomPath = settings.jomPath || '';
    const resolved = buildResolvedConfig(mode, arch, qtPath, vsDevShell, target, undefined, undefined, jomPath || undefined);

    if (unconfirmedBuildConfig.length > 0) {
        result.resolved = resolved;
        result.diagnostics.push({
            level: 'error',
            message: `未确认构建配置: ${unconfirmedBuildConfig.join(', ')}。请先运行 forja status --json 查看下一步。`
        });
        result.nextAction = 'forja status --json';
        return result;
    }

    const shellBuilder = createShellPlanBuilder(process.platform === 'win32' ? winConfig : linuxConfig);
    const buildConfig = resolveBuildConfig({
        workspace,
        projectPath: project,
        mode,
        arch,
        qtPath,
        vsDevShell,
        target,
        qmakeArgs,
        jomPath
    });
    let commands: string[] = [];

    if (options.action === 'qmake') {
        commands = shellBuilder.qmakeCommands(buildConfig).commands;
    } else if (options.action === 'build') {
        const buildCmds = shellBuilder.buildCommands(buildConfig).commands;
        if (project) {
            let qmakeCmds: string[] = [];
            if (buildConfig.projectDir && buildConfig.proFile) {
                const validation = validateMakefile(buildConfig.projectDir, {
                    mode: buildConfig.mode,
                    arch: buildConfig.arch,
                    qtPath: buildConfig.qtPath,
                    proFile: buildConfig.proFile,
                    target: buildConfig.target,
                    qmakeArgs: buildConfig.qmakeArgs
                });
                if (!validation.exists || !validation.matches) {
                    const reason = !validation.exists
                        ? '未找到 Makefile'
                        : `Makefile 与当前配置不匹配（${validation.mismatch!.join(', ')}）`;
                    result.diagnostics.push({ level: 'info', message: `自动 QMake：${reason}` });
                    qmakeCmds = shellBuilder.qmakeCommands(buildConfig).commands;
                }
            }
            const runtimeTarget = resolveRuntimeTarget(path.dirname(project), mode, arch);
            commands = [...qmakeCmds, ...buildCmds];
            if (runtimeTarget) { result.executablePath = runtimeTarget.exePath; }
        } else {
            commands = buildCmds;
        }
    } else if (options.action === 'run') {
        const buildCmds = shellBuilder.buildCommands(buildConfig).commands;

        // 检查 Makefile 是否最新，过期则先自动跑 qmake
        let qmakeCmds: string[] = [];
        if (buildConfig.projectDir && buildConfig.proFile) {
            const validation = validateMakefile(buildConfig.projectDir, {
                mode: buildConfig.mode,
                arch: buildConfig.arch,
                qtPath: buildConfig.qtPath,
                proFile: buildConfig.proFile,
                target: buildConfig.target,
                qmakeArgs: buildConfig.qmakeArgs
            });
            if (!validation.exists || !validation.matches) {
                const reason = !validation.exists
                    ? '未找到 Makefile'
                    : `Makefile 与当前配置不匹配（${validation.mismatch!.join(', ')}）`;
                result.diagnostics.push({ level: 'info', message: `自动 QMake：${reason}` });
                qmakeCmds = shellBuilder.qmakeCommands(buildConfig).commands;
            }
        }

        // 检查 rcc 是否需要重编，需要则在 build 前插入 rcc 命令
        let rccCmds: string[] = [];
        const rccPath = resolveRccProjectPath(settings.rccProjectPath || '', workspace);
        if (rccPath) {
            const targets = scanRccTargets(rccPath);
            if (targets.length > 0 && rccNeedsRebuild(targets)) {
                let outputDir: string | null = null;
                if (project) {
                    const rt = resolveRuntimeTarget(path.dirname(project), mode, arch);
                    if (rt) { outputDir = path.dirname(rt.exePath); }
                }
                rccCmds = buildRccCommands(targets, qtPath, outputDir, process.platform === 'win32' ? 'win32' : 'linux');
                result.diagnostics.push({ level: 'info', message: 'RCC 资源有变更，已插入 rcc 编译命令' });
            }
        }

        // Append run command (launch executable) for both dry-run and execute
        if (project) {
            const runCmd = buildRunCommand(project, mode, arch, qtPath);
            if (runCmd) {
                const runtimeTarget = resolveRuntimeTarget(path.dirname(project), mode, arch);
                commands = [...qmakeCmds, ...rccCmds, ...buildCmds, runCmd];
                result.executablePath = runtimeTarget?.exePath;
            } else {
                // Makefile not yet generated or mismatched — return build commands with hint to run status
                const fallbackCmds = [...qmakeCmds, ...buildCmds];
                return {
                    ...result,
                    ok: true,
                    project,
                    commands: fallbackCmds,
                    shellCommand: fallbackCmds.join(' && '),
                    diagnostics: [
                        { level: 'warning', message: 'Makefile 不匹配或未生成，无法解析可执行文件路径，仅返回 build 命令' }
                    ],
                    nextAction: 'forja status --json',
                    resolved
                };
            }
        }
    } else if (options.action === 'clean') {
        commands = shellBuilder.cleanCommands(buildConfig).commands;
    } else if (options.action === 'rcc') {
        const rccPath = resolveRccProjectPath(settings.rccProjectPath || '', workspace);
        if (!rccPath) {
            result.diagnostics.push({ level: 'error', message: '未找到 XYRcc 目录，请在 settings.json 中配置 rccProjectPath' });
            result.nextAction = 'forja status --json';
            return result;
        }
        const targets = scanRccTargets(rccPath);
        if (targets.length === 0) {
            result.diagnostics.push({ level: 'warning', message: 'XYRcc 目录下未找到 .qrc 文件' });
            result.nextAction = 'forja status --json';
            return result;
        }
        // 解析可执行文件输出目录
        let outputDir: string | null = null;
        if (project) {
            const runtimeTarget = resolveRuntimeTarget(path.dirname(project), mode, arch);
            if (runtimeTarget) { outputDir = path.dirname(runtimeTarget.exePath); }
        }
        // rcc 只需要 Qt bin 在 PATH，不需要 VS 环境
        const rccCmds = buildRccCommands(targets, qtPath, outputDir, process.platform === 'win32' ? 'win32' : 'linux');
        commands = rccCmds;
        if (!outputDir) {
            result.diagnostics.push({ level: 'warning', message: '无法确定输出目录，.rcc 仅生成不复制' });
        }
    }

    return {
        ...result,
        ok: true,
        project,
        commands,
        shellCommand: commands.length > 0 ? commands.join(' && ') : '',
        resolved
    };
}
