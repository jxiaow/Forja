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
import { loadQtSettings, saveQtSettings, projectConfigPath, QtSettings, resolveVsDevShellPath, inferVsInstall } from '../../core/settingsIO';
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
        candidates: [],
        nextActions: [],
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

function withoutConfigOptions(options: CliOptions): CliOptions {
    return {
        ...options,
        project: null,
        mode: null,
        arch: null,
        qtPath: null,
        vsDevShell: null,
        target: null
    };
}

function insideWorkspace(workspace: string, filePath: string): boolean {
    const rel = path.relative(workspace, filePath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveProject(workspace: string, options: CliOptions, settings: QtSettings): { project: string | null; error: string | null } {
    const explicitProject = options.project
        ? (path.isAbsolute(options.project) ? path.resolve(options.project) : path.resolve(workspace, options.project))
        : null;
    if (explicitProject) {
        if (!insideWorkspace(workspace, explicitProject)) {
            return { project: null, error: '.pro 文件必须位于 workspace 内' };
        }
        return { project: explicitProject, error: null };
    }
    // From settings: pinnedProject or manualProPath
    const selectedProj = settings.pinnedProject;
    const savedProject = selectedProj ? path.join(selectedProj.root, selectedProj.relative) : null;
    if (savedProject && fs.existsSync(savedProject)) {
        return { project: savedProject, error: null };
    }
    if (settings.manualProPath && fs.existsSync(settings.manualProPath)) {
        return { project: settings.manualProPath, error: null };
    }
    const found = scanProFiles(workspace).map(rel => path.join(workspace, rel));
    if (found.length === 1) {
        return { project: found[0], error: null };
    }
    if (found.length > 1) {
        return { project: null, error: `发现多个 .pro 文件: ${found.join(', ')}。请先运行 compilot qt projects --json 查看候选，再用 compilot qt use --project <path> --json 选择项目。` };
    }
    return { project: null, error: '未找到 .pro 文件。请在工作区中创建 .pro 文件，或用 compilot qt use --project <path> --json 选择已有项目。' };
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
        'compilot qt projects --json',
        'compilot qt use --project <path> --json'
    ];
}

function buildToolchainActions(missingTools: ReturnType<typeof getMissingTools>): string[] {
    const actions = ['compilot qt env --json'];
    for (const tool of missingTools) {
        if (tool.cliFlag) {
            actions.push(`compilot qt use ${tool.cliFlag.replace(/<[^>]+>/g, '<path>')} --json`);
        }
    }
    return actions;
}

function buildStatusGuidance(hasSettings: boolean, projectExists: boolean, missingTools: ReturnType<typeof getMissingTools>, hasMakefile: boolean, hasExecutable: boolean): { nextAction: string; nextActions: string[] } {
    if (!hasSettings) {
        return { nextAction: 'init', nextActions: ['compilot qt init --json'] };
    }
    if (!projectExists) {
        return { nextAction: 'projects', nextActions: buildProjectSelectionActions() };
    }
    if (missingTools.length > 0) {
        return { nextAction: 'env', nextActions: buildToolchainActions(missingTools) };
    }
    if (!hasMakefile) {
        return { nextAction: 'qmake', nextActions: ['compilot qt qmake --json'] };
    }
    if (!hasExecutable) {
        return { nextAction: 'build', nextActions: ['compilot qt build --json'] };
    }
    return { nextAction: 'run', nextActions: ['compilot qt run --json'] };
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
    if (!input.options.mode) { autoSelected.push('mode'); }
    if (!input.options.arch && getAvailableArch().length > 1) { autoSelected.push('arch'); }
    if (!input.options.qtPath && input.qtCandidates.length > 1) { autoSelected.push('qtPath'); }
    if (autoSelected.length > 0) {
        diagnostics.push({ level: 'warning', message: `部分配置为自动选择（${autoSelected.join(', ')}），可用 compilot qt env --json 查看可选项` });
    }

    // 项目相关提示
    if (!input.project) {
        const proCount = input.projects.length;
        if (proCount > 1) {
            diagnostics.push({ level: 'warning', message: `发现 ${proCount} 个 .pro 文件，未自动选择，可用 compilot qt projects --json 查看全部` });
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

function buildInitNextActions(project: string | null, projects: string[], missingTools: ReturnType<typeof getMissingTools>): string[] {
    const nextActions: string[] = [];
    if (!project) {
        if (projects.length > 1) {
            nextActions.push(...buildProjectSelectionActions());
        } else if (projects.length === 0) {
            nextActions.push('在工作区中创建 .pro 文件');
        }
    }
    if (missingTools.length > 0) {
        nextActions.push(...buildToolchainActions(missingTools));
    }
    if (nextActions.length === 0) {
        nextActions.push('compilot qt status --json');
    }
    return Array.from(new Set(nextActions));
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

export async function createActionPlan(options: CliOptions): Promise<CliResult> {
    const workspace = resolveWorkspace(options.workspace);
    const result = emptyResult(options, workspace);

    if (!fs.existsSync(workspace)) {
        result.diagnostics.push({ level: 'error', message: `workspace 不存在: ${workspace}` });
        return result;
    }

    const settings = loadQtSettings(workspace);
    const effectiveOptions = options.action === 'init' ? withoutConfigOptions(options) : options;

    if (options.action === 'status') {
        const hasSettings = fs.existsSync(projectConfigPath(workspace, 'qt'));
        const selectedProj = settings.pinnedProject;
        const projectRel = selectedProj ? selectedProj.relative : null;
        const projectFull = projectRel ? path.join(workspace, projectRel) : null;
        const projectExists = projectFull ? fs.existsSync(projectFull) : false;

        const mode = settings.mode || 'debug';
        const arch = settings.arch || getDefaultArch();
        const qtPath = settings.qtPath || '';
        const vsDevShell = resolveVsDevShellPath(settings.vsInstall) || '';
        const jomPath = settings.jomPath || '';
        const target = settings.target || '';

        // 快速文件系统检查（不跑环境检测）
        const projectDir = projectFull ? path.dirname(projectFull) : null;
        const makefileValidation = projectDir ? validateMakefile(projectDir, { mode, arch, qtPath, proFile: projectFull || '', target }) : { exists: false, matches: false };
        const hasMakefile = makefileValidation.exists && makefileValidation.matches;
        const runtimeTarget = (hasMakefile && projectDir) ? resolveRuntimeTarget(projectDir, mode, arch) : null;
        const hasExecutable = runtimeTarget ? fs.existsSync(runtimeTarget.exePath) : false;

        const { allReady: toolsReady, checks: toolChecks } = checkToolsReady(settings);
        const missingTools = getMissingTools(settings);
        const checks: Record<string, boolean> = {
            settings: hasSettings,
            project: projectExists,
            ...toolChecks,
            makefile: hasMakefile,
            executable: hasExecutable
        };

        // 推导下一步：init 只用于首次 bootstrap，已有配置后的缺项改由 env/projects/use 处理。
        const guidance = buildStatusGuidance(hasSettings, projectExists, missingTools, hasMakefile, hasExecutable);

        // ready = 所有构建前置条件满足（可以 build）
        const ready = hasSettings && projectExists && toolsReady && hasMakefile;

        const diagnostics: CliResult['diagnostics'] = [];
        if (!hasSettings) {
            diagnostics.push({ level: 'warning', message: '尚未初始化' });
        } else {
            if (!projectExists) {
                diagnostics.push({ level: 'warning', message: '未配置项目' });
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

        // 解析 RCC 项目路径
        const rccPath = resolveRccProjectPath(settings.rccProjectPath || '', workspace);

        const statusResult: Record<string, unknown> = {
            ok: true,
            action: 'status',
            workspace,
            ready,
            checks,
            nextAction: guidance.nextAction,
            nextActions: guidance.nextActions
        };

        // missing: 列出哪些前置条件未满足（辅助调用方决定调 env 还是 projects）
        const missing: string[] = [];
        if (!hasSettings) { missing.push('settings'); }
        if (!projectExists && hasSettings) { missing.push('project'); }
        for (const tool of missingTools) { missing.push(tool.key); }
        if (makefileValidation.exists && !makefileValidation.matches) { missing.push('makefile'); }
        else if (!makefileValidation.exists && projectExists) { missing.push('makefile'); }
        if (hasMakefile && !hasExecutable) { missing.push('executable'); }
        if (missing.length > 0) { statusResult.missing = missing; }

        if (diagnostics.length > 0) { statusResult.diagnostics = diagnostics; }
        if (rccPath) { statusResult.rccProjectPath = rccPath; }

        // 用 stdout 传自定义结构（和 env/projects 一样）
        result.ok = true;
        result.resolved = statusResolved;
        result.nextActions = guidance.nextActions;
        result.data = statusResult;
        result.stdout = JSON.stringify(statusResult);
        return result;
    }

    if (options.action === 'env') {
        const detected = await detectEnvironment(workspace, options);
        const mode = options.mode || settings.mode || 'debug';
        const arch = options.arch || settings.arch || getDefaultArch();
        const currentQtPath = options.qtPath || settings.qtPath || detected.detected.qt?.path || '';
        const currentVsDevShell = options.vsDevShell || resolveVsDevShellPath(settings.vsInstall) || detected.detected.vs?.devShellPath || '';
        const jomPath = detected.detected.jom || settings.jomPath || '';

        // Encode env response in CliResult fields
        result.ok = true;
        result.diagnostics = [];
        result.resolved = buildResolvedConfig(mode, arch, currentQtPath, currentVsDevShell, '', detected.detected.qt?.version, detected.detected.vs?.version, jomPath || undefined);
        // Store available data in candidates (repurposed) and stdout (JSON blob)
        const envData = {
            available: {
                mode: ['debug', 'release'],
                arch: getAvailableArch(),
                qt: detected.qtCandidates.map(c => ({ path: c.path, version: c.version, compiler: c.compiler })),
                ...(process.platform === 'win32' ? { vsDevShell: detected.vsCandidates.map(c => ({ path: c.devShellPath, version: c.version, edition: c.edition })) } : {})
            },
            configHints: {
                usage: 'compilot qt use [options] --json',
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
    }

    if (options.action === 'projects') {
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
                usage: 'compilot qt use --project <path> --json'
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

    if (options.action === 'use') {
        const updatedQt: QtSettings = { ...settings };
        const updated: Record<string, string> = {};
        let project: string | null = settings.pinnedProject
            ? path.join(settings.pinnedProject.root, settings.pinnedProject.relative)
            : null;

        if (options.project) {
            const projectResult = resolveProject(workspace, options, settings);
            if (projectResult.error || !projectResult.project) {
                result.diagnostics.push({ level: 'error', message: projectResult.error || '项目路径无效' });
                result.nextActions.push('compilot qt projects --json');
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

        if (Object.keys(updated).length === 0) {
            result.diagnostics.push({ level: 'error', message: 'use 需要至少指定一个配置参数' });
            result.nextActions.push('compilot qt use --mode release --json');
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
            nextActions: ['compilot qt status --json', 'compilot qt build --json']
        };

        return {
            ...result,
            ok: true,
            project,
            diagnostics: options.executionMode === 'dryRun' ? [{ level: 'info', message: '预览配置切换，未写入本地配置' }] : [],
            nextActions: ['compilot qt status --json', 'compilot qt build --json'],
            resolved: useResolved,
            data: useData,
            stdout: JSON.stringify(useData)
        };
    }

    const projectResult = resolveProject(workspace, effectiveOptions, settings);
    if (projectResult.error && options.action !== 'init') {
        const errMode = settings.mode || 'debug';
        const errArch = settings.arch || getDefaultArch();
        const errQtPath = settings.qtPath || process.env.QT_PILOT_QT_PATH || '';
        const errVsDevShell = resolveVsDevShellPath(settings.vsInstall) || process.env.QT_PILOT_VS_DEV_SHELL || '';
        const errQmakeTarget = settings.target || '';
        result.resolved = buildResolvedConfig(errMode, errArch, errQtPath, errVsDevShell, errQmakeTarget, undefined, undefined, settings.jomPath || undefined);
        result.diagnostics.push({ level: 'error', message: projectResult.error });
        result.nextActions.push('compilot qt status --json');
        return result;
    }

    const project = projectResult.project;
    const mode = settings.mode || 'debug';
    const arch = settings.arch || getDefaultArch();
    const qtPath = settings.qtPath || process.env.QT_PILOT_QT_PATH || '';
    const vsDevShell = resolveVsDevShellPath(settings.vsInstall) || process.env.QT_PILOT_VS_DEV_SHELL || '';
    const target = settings.target || '';
    const jomPath = settings.jomPath || '';
    const resolved = buildResolvedConfig(mode, arch, qtPath, vsDevShell, target, undefined, undefined, jomPath || undefined);

    if (options.action === 'init') {
        if (options.executionMode === 'execute') {
            ensureLocalStateDir(workspace);
            // #1: detectEnvironment 内部已调用 detectEnv，直接复用其结果，不再重复调用
            const detected = await detectEnvironment(workspace, effectiveOptions);
            // 直接从检测结果获取候选列表
            const allQtCandidates = detected.qtCandidates;
            let effectiveTarget = target;
            if (project) {
                // 如果用户没指定 target，从 .pro 文件探测
                if (!effectiveTarget) {
                    const proInfo = parseProFile(project);
                    if (proInfo) { effectiveTarget = proInfo.target; }
                }
                // #2: 写入 pinnedProject
                const relativeProject = path.relative(workspace, project).replace(/\\/g, '/');
                const updatedQt: QtSettings = {
                    ...settings,
                    mode: settings.mode,
                    arch: settings.arch,
                    qtPath: qtPath || detected.detected.qt?.path || '',
                    vsInstall: settings.vsInstall || inferVsInstall(vsDevShell || detected.detected.vs?.devShellPath || ''),
                    jomPath: detected.detected.jom || '',
                    target: effectiveTarget,
                    pinnedProject: { root: workspace, relative: relativeProject }
                };
                saveQtSettings(workspace, updatedQt);
            } else {
                // #3: 多 .pro 文件或无 .pro 时，仍保存 qtPath 等，显式清除 pinnedProject
                const updatedQt: QtSettings = {
                    ...settings,
                    mode: settings.mode,
                    arch: settings.arch,
                    qtPath: qtPath || detected.detected.qt?.path || '',
                    vsInstall: settings.vsInstall || inferVsInstall(vsDevShell || detected.detected.vs?.devShellPath || ''),
                    jomPath: detected.detected.jom || '',
                    target: effectiveTarget,
                    pinnedProject: null
                };
                saveQtSettings(workspace, updatedQt);
            }
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
            const initNextActions = buildInitNextActions(project, detected.detected.projects, getMissingTools(effectiveSettingsForCheck));

            const initResolved = buildResolvedConfig(mode, arch, effectiveQtPath, effectiveVsDevShell, effectiveTarget, detected.detected.qt?.version, detected.detected.vs?.version, detected.detected.jom || undefined);
            if (project) {
                initResolved.project = path.relative(workspace, project).replace(/\\/g, '/');
            }
            return { ...result, ok: true, project, diagnostics: initDiagnostics, nextActions: initNextActions, resolved: initResolved };
        }

        // dry-run: preview what init would do
        const detected = await detectEnvironment(workspace, effectiveOptions);
        const previewQtPath = qtPath || detected.detected.qt?.path || '';
        const previewVsDevShell = vsDevShell || detected.detected.vs?.devShellPath || '';

        const previewDiagnostics: CliResult['diagnostics'] = [
            { level: 'info', message: '将写入 Compilot 本地配置' }
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
        const previewNextActions = [
            '确认无误后运行 compilot qt init --json 写入本地配置',
            ...buildInitNextActions(project, detected.detected.projects, getMissingTools(previewSettingsForCheck))
        ];

        const previewResolved = buildResolvedConfig(mode, arch, previewQtPath, previewVsDevShell, target, detected.detected.qt?.version, detected.detected.vs?.version, detected.detected.jom || undefined);

        return {
            ...result,
            ok: true,
            project,
            diagnostics: previewDiagnostics,
            nextActions: Array.from(new Set(previewNextActions)),
            resolved: previewResolved
        };
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
        jomPath
    });
    let commands: string[] = [];

    if (options.action === 'qmake') {
        commands = shellBuilder.qmakeCommands(buildConfig).commands;
    } else if (options.action === 'build') {
        commands = shellBuilder.buildCommands(buildConfig).commands;
    } else if (options.action === 'run') {
        const buildCmds = shellBuilder.buildCommands(buildConfig).commands;

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
            const runCmd = buildRunCommand(project, mode, arch);
            if (runCmd) {
                // Kill existing process before build (use actual exe name from Makefile)
                const runtimeTarget = resolveRuntimeTarget(path.dirname(project), mode, arch);
                const exeName = runtimeTarget ? path.basename(runtimeTarget.exePath, path.extname(runtimeTarget.exePath)) : path.basename(project, '.pro');
                const killCmd = (process.platform === 'win32' ? winConfig : linuxConfig).killCommand(exeName);
                commands = [killCmd, ...rccCmds, ...buildCmds, runCmd];
            } else {
                // Makefile not yet generated or mismatched — return build commands with hint to run status
                const fallbackExeName = path.basename(project, '.pro');
                const fallbackKillCmd = (process.platform === 'win32' ? winConfig : linuxConfig).killCommand(fallbackExeName);
                const fallbackCmds = [fallbackKillCmd, ...buildCmds];
                return {
                    ...result,
                    ok: true,
                    project,
                    commands: fallbackCmds,
                    shellCommand: fallbackCmds.join(' && '),
                    diagnostics: [
                        { level: 'warning', message: 'Makefile 不匹配或未生成，无法解析可执行文件路径，仅返回 build 命令' }
                    ],
                    nextActions: ['compilot qt status --json'],
                    resolved
                };
            }
        }
    } else if (options.action === 'clean') {
        commands = shellBuilder.cleanCommands(buildConfig).commands;
    } else if (options.action === 'stop') {
        commands = shellBuilder.stopCommands(path.basename(project || 'app', '.pro'));
    } else if (options.action === 'rcc') {
        const rccPath = resolveRccProjectPath(settings.rccProjectPath || '', workspace);
        if (!rccPath) {
            result.diagnostics.push({ level: 'error', message: '未找到 XYRcc 目录，请在 settings.json 中配置 rccProjectPath' });
            result.nextActions.push('compilot qt status --json');
            return result;
        }
        const targets = scanRccTargets(rccPath);
        if (targets.length === 0) {
            result.diagnostics.push({ level: 'warning', message: 'XYRcc 目录下未找到 .qrc 文件' });
            result.nextActions.push('compilot qt status --json');
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
