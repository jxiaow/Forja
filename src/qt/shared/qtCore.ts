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
    ensureCompilotGitignored,
} from './localState';
import { loadSettings, saveSettings, settingsFilePath, QtPilotSettings } from '../../core/settingsIO';
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

function insideWorkspace(workspace: string, filePath: string): boolean {
    const rel = path.relative(workspace, filePath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveProject(workspace: string, options: CliOptions, settings: QtPilotSettings): { project: string | null; error: string | null } {
    const explicitProject = options.project ? path.resolve(options.project) : null;
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
        return { project: null, error: `发现多个 .pro 文件: ${found.join(', ')}。请使用 --project 指定。` };
    }
    return { project: null, error: '未找到 .pro 文件。请使用 --project 指定。' };
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

interface InitDiagnosticsInput {
    options: CliOptions;
    qtCandidates: Array<{path: string; version: string; compiler: string}>;
    projects: string[];
    project: string | null;
    effectiveSettings: QtPilotSettings;
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

async function detectEnvironment(workspace: string, options: CliOptions): Promise<{
    detected: {
        qt: { path: string; qmake: string; version?: string; compiler?: string } | null;
        vs: { devShellPath: string; version?: string; edition?: string } | null;
        jom: string | null;
        projects: string[];
    };
    qtCandidates: Array<{path: string; version: string; compiler: string}>;
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
        qtCandidates: env.qtCandidates || []
    };
}

export async function createActionPlan(options: CliOptions): Promise<CliResult> {
    const workspace = resolveWorkspace(options.workspace);
    const result = emptyResult(options, workspace);

    if (!fs.existsSync(workspace)) {
        result.diagnostics.push({ level: 'error', message: `workspace 不存在: ${workspace}` });
        return result;
    }

    const settings = loadSettings(workspace);

    if (options.action === 'status') {
        const hasSettings = fs.existsSync(settingsFilePath(workspace));
        const selectedProj = settings.pinnedProject;
        const projectRel = selectedProj ? selectedProj.relative : null;
        const projectFull = projectRel ? path.join(workspace, projectRel) : null;
        const projectExists = projectFull ? fs.existsSync(projectFull) : false;

        const mode = settings.mode || 'debug';
        const arch = settings.arch || getDefaultArch();
        const qtPath = settings.qtPath || '';
        const vsDevShell = settings.vsDevShellPath || '';
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

        // 推导 nextAction（ready = "ready to build"，不含 executable）
        let nextAction: string;
        if (!hasSettings) {
            nextAction = 'init';
        } else if (!projectExists) {
            nextAction = 'init';
        } else if (missingTools.length > 0) {
            nextAction = 'init';
        } else if (!hasMakefile) {
            nextAction = 'qmake';
        } else if (!hasExecutable) {
            nextAction = 'build';
        } else {
            nextAction = 'run';
        }

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
            ready,
            checks,
            nextAction
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
        result.data = statusResult;
        result.stdout = JSON.stringify(statusResult);
        return result;
    }

    if (options.action === 'env') {
        const detected = await detectEnvironment(workspace, options);
        const mode = options.mode || settings.mode || 'debug';
        const arch = options.arch || settings.arch || getDefaultArch();
        const currentQtPath = options.qtPath || settings.qtPath || detected.detected.qt?.path || '';
        const currentVsDevShell = options.vsDevShell || settings.vsDevShellPath || detected.detected.vs?.devShellPath || '';
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
                // envDetector 当前只返回最优的一个 VS，available 数组长度为 0 或 1
                ...(process.platform === 'win32' ? { vsDevShell: detected.detected.vs ? [{ path: detected.detected.vs.devShellPath, version: detected.detected.vs.version || '', edition: detected.detected.vs.edition || '' }] : [] } : {})
            },
            configHints: {
                usage: 'compilot qt init [options] --json',
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
                usage: 'compilot qt init --project <path> --json'
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

    const projectResult = resolveProject(workspace, options, settings);
    if (projectResult.error && options.action !== 'init') {
        const errMode = options.mode || settings.mode || 'debug';
        const errArch = options.arch || settings.arch || getDefaultArch();
        const errQtPath = options.qtPath || settings.qtPath || process.env.QT_PILOT_QT_PATH || '';
        const errVsDevShell = options.vsDevShell || settings.vsDevShellPath || process.env.QT_PILOT_VS_DEV_SHELL || '';
        const errQmakeTarget = options.target || settings.target || '';
        result.resolved = buildResolvedConfig(errMode, errArch, errQtPath, errVsDevShell, errQmakeTarget, undefined, undefined, settings.jomPath || undefined);
        result.diagnostics.push({ level: 'error', message: projectResult.error });
        result.nextActions.push('compilot qt status --json');
        return result;
    }

    const project = projectResult.project;
    const mode = options.mode || settings.mode || 'debug';
    const arch = options.arch || settings.arch || getDefaultArch();
    const qtPath = options.qtPath || settings.qtPath || process.env.QT_PILOT_QT_PATH || '';
    const vsDevShell = options.vsDevShell || settings.vsDevShellPath || process.env.QT_PILOT_VS_DEV_SHELL || '';
    const target = options.target || settings.target || '';
    const jomPath = settings.jomPath || '';
    const resolved = buildResolvedConfig(mode, arch, qtPath, vsDevShell, target, undefined, undefined, jomPath || undefined);

    if (options.action === 'init') {
        if (options.executionMode === 'execute') {
            ensureLocalStateDir(workspace);
            ensureCompilotGitignored(workspace);
            // #1: detectEnvironment 内部已调用 detectEnv，直接复用其结果，不再重复调用
            const detected = await detectEnvironment(workspace, options);
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
                const updatedSettings: QtPilotSettings = {
                    ...settings,
                    mode,
                    arch,
                    qtPath: qtPath || detected.detected.qt?.path || '',
                    vsDevShellPath: vsDevShell || detected.detected.vs?.devShellPath || '',
                    jomPath: detected.detected.jom || '',
                    target: effectiveTarget,
                    pinnedProject: { root: workspace, relative: relativeProject }
                };
                saveSettings(workspace, updatedSettings);
            } else {
                // #3: 多 .pro 文件或无 .pro 时，仍保存 mode/arch/qtPath 等，显式清除 pinnedProject
                const updatedSettings: QtPilotSettings = {
                    ...settings,
                    mode,
                    arch,
                    qtPath: qtPath || detected.detected.qt?.path || '',
                    vsDevShellPath: vsDevShell || detected.detected.vs?.devShellPath || '',
                    jomPath: detected.detected.jom || '',
                    target: effectiveTarget,
                    pinnedProject: null
                };
                saveSettings(workspace, updatedSettings);
            }
            const effectiveQtPath = qtPath || detected.detected.qt?.path || '';
            const effectiveVsDevShell = vsDevShell || detected.detected.vs?.devShellPath || '';
            const effectiveSettingsForCheck: QtPilotSettings = {
                ...settings,
                qtPath: effectiveQtPath,
                vsDevShellPath: effectiveVsDevShell,
                jomPath: detected.detected.jom || ''
            };
            const initDiagnostics = buildInitDiagnostics({
                options,
                qtCandidates: allQtCandidates,
                projects: detected.detected.projects,
                project,
                effectiveSettings: effectiveSettingsForCheck
            });

            const initResolved = buildResolvedConfig(mode, arch, effectiveQtPath, effectiveVsDevShell, effectiveTarget, detected.detected.qt?.version, detected.detected.vs?.version, detected.detected.jom || undefined);
            if (project) {
                initResolved.project = path.relative(workspace, project).replace(/\\/g, '/');
            }
            return { ...result, ok: true, project, diagnostics: initDiagnostics, resolved: initResolved };
        }

        // dry-run: preview what init would do
        const detected = await detectEnvironment(workspace, options);
        const previewQtPath = qtPath || detected.detected.qt?.path || '';
        const previewVsDevShell = vsDevShell || detected.detected.vs?.devShellPath || '';

        const previewDiagnostics: CliResult['diagnostics'] = [
            { level: 'info', message: '将创建 .compilot/ 目录并写入 settings.json' }
        ];
        const previewSettingsForCheck: QtPilotSettings = {
            ...settings,
            qtPath: previewQtPath,
            vsDevShellPath: previewVsDevShell,
            jomPath: detected.detected.jom || ''
        };
        previewDiagnostics.push(...buildInitDiagnostics({
            options,
            qtCandidates: detected.qtCandidates,
            projects: detected.detected.projects,
            project,
            effectiveSettings: previewSettingsForCheck
        }));

        const previewResolved = buildResolvedConfig(mode, arch, previewQtPath, previewVsDevShell, target, detected.detected.qt?.version, detected.detected.vs?.version, detected.detected.jom || undefined);

        return {
            ...result,
            ok: true,
            project,
            diagnostics: previewDiagnostics,
            nextActions: ['确认无误后运行 compilot qt init --json 写入本地配置'],
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
