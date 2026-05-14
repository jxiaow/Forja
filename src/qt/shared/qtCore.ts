import * as fs from 'fs';
import * as path from 'path';
import { CliOptions, CliResolvedConfig, CliResult } from '../cli/types';
import { detectEnv } from '../env/envDetector';
import { createShellPlanBuilder } from '../platform/shellPlan';
import { winConfig } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import { resolveBuildConfig } from './configResolver';
import { scanProFiles } from './projectScanner';
import {
    LocalCache,
    ensureLocalStateDir,
    ensureCompilotGitignored,
    readLocalCache,
    writeLocalCache
} from './localState';
import { loadSettings, saveSettings, QtPilotSettings } from '../../core/settingsIO';
import { buildRunCommand } from './commandRunner';
import { resolveRuntimeTarget } from './runtimeTarget';

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
    // From settings: selectedProject or manualProPath
    const selectedProj = settings.selectedProject;
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

function listProjectCandidates(workspace: string): string[] {
    return scanProFiles(workspace).map(rel => path.join(workspace, rel));
}

function buildResolvedConfig(
    mode: CliResolvedConfig['mode'],
    arch: CliResolvedConfig['arch'],
    qtPath: string,
    vsDevShell: string,
    qmakeTarget: string
): CliResolvedConfig {
    return {
        mode,
        arch,
        qtPath,
        vsDevShell,
        qmakeTarget
    };
}

function buildEnvironmentGuidance(
    action: CliOptions['action'],
    qtPath: string,
    vsDevShell: string
): { diagnostics: CliResult['diagnostics']; nextActions: string[] } {
    const diagnostics: CliResult['diagnostics'] = [];
    const nextActions: string[] = [];

    if (!['qmake', 'build', 'clean', 'run'].includes(action)) {
        return { diagnostics, nextActions };
    }

    if (!qtPath) {
        diagnostics.push({ level: 'warning', message: 'Qt 路径未解析，当前计划可能无法在执行阶段找到 qmake 或 Qt 工具链' });
        nextActions.push('使用 --qt-path <path> 指定 Qt 安装路径，或先运行 init --execute 保存本地配置');
    }

    if (process.platform === 'win32' && !vsDevShell) {
        diagnostics.push({ level: 'warning', message: 'VS DevShell 路径未解析，当前计划可能无法在执行阶段初始化 MSVC 构建环境' });
        nextActions.push('使用 --vs-dev-shell <path> 指定 Launch-VsDevShell.ps1，或先运行 init --execute 保存本地配置');
    }

    return { diagnostics, nextActions };
}

async function detectAndCache(workspace: string, options: CliOptions): Promise<LocalCache> {
    const env = await detectEnv(options.qtPath || undefined, options.vsDevShell || undefined).catch(() => ({
        vs: null,
        qt: null,
        qtCandidates: [],
        jom: false
    }));
    const qtPath = env.qt?.path || options.qtPath || '';
    const cache: LocalCache = {
        version: 1,
        updatedAt: new Date().toISOString(),
        detected: {
            qt: qtPath ? {
                path: qtPath,
                qmake: path.join(qtPath, 'bin', process.platform === 'win32' ? 'qmake.exe' : 'qmake')
            } : null,
            vs: env.vs?.devShellPath ? { devShellPath: env.vs.devShellPath } : null,
            projects: scanProFiles(workspace).map(rel => path.join(workspace, rel))
        }
    };
    return cache;
}

export async function createActionPlan(options: CliOptions): Promise<CliResult> {
    const workspace = resolveWorkspace(options.workspace);
    const result = emptyResult(options, workspace);

    if (!fs.existsSync(workspace)) {
        result.diagnostics.push({ level: 'error', message: `workspace 不存在: ${workspace}` });
        return result;
    }

    const cache = readLocalCache(workspace);
    const settings = loadSettings(workspace);

    if (options.action === 'detect' || options.action === 'projects' || options.action === 'status') {
        const detected = await detectAndCache(workspace, options);
        const candidates = detected.detected.projects;
        const selectedProj = settings.selectedProject;
        const savedProject = selectedProj ? path.join(selectedProj.root, selectedProj.relative) : null;
        const project = savedProject && fs.existsSync(savedProject)
            ? savedProject
            : candidates.length === 1
                ? candidates[0]
                : null;
        const mode = options.mode || settings.mode || 'debug';
        const arch = options.arch || settings.arch || 'x86';
        const qtPath = options.qtPath || settings.qtPath || detected.detected.qt?.path || '';
        const vsDevShell = options.vsDevShell || settings.vsDevShellPath || detected.detected.vs?.devShellPath || '';
        const qmakeTarget = options.target || settings.qmakeTarget || '';
        const diagnostics = [];
        const nextActions: string[] = [];

        if (options.action !== 'detect' && candidates.length > 1 && !project) {
            diagnostics.push({ level: 'warning' as const, message: `发现多个 .pro 文件，共 ${candidates.length} 个` });
            nextActions.push('使用 --project <path> 指定要操作的 .pro 文件');
        } else if (options.action !== 'detect' && candidates.length === 0 && !project) {
            diagnostics.push({ level: 'warning' as const, message: '当前 workspace 下未检测到 .pro 文件' });
            nextActions.push('将工作目录切到 Qt 工程根目录，或使用 --project <path>');
        }

        if (options.saveLocal) {
            ensureLocalStateDir(workspace);
            writeLocalCache(workspace, detected);
        }
        return {
            ...result,
            ok: true,
            project,
            commands: [],
            candidates,
            diagnostics,
            nextActions,
            resolved: buildResolvedConfig(mode, arch, qtPath, vsDevShell, qmakeTarget)
        };
    }

    const projectResult = resolveProject(workspace, options, settings);
    if (projectResult.error && options.action !== 'init') {
        result.candidates = listProjectCandidates(workspace);
        result.diagnostics.push({ level: 'error', message: projectResult.error });
        if (result.candidates.length > 1) {
            result.nextActions.push('从 candidates 中选择一个 .pro 文件，并使用 --project <path> 重试');
        } else if (result.candidates.length === 1) {
            result.nextActions.push(`使用 --project "${result.candidates[0]}" 重试，或先运行 init --execute 保存默认项目`);
        } else {
            result.nextActions.push('确认 workspace 正确，或使用 --project <path-to-pro> 指定项目');
        }
        return result;
    }

    const project = projectResult.project;
    const mode = options.mode || settings.mode || 'debug';
    const arch = options.arch || settings.arch || 'x86';
    const qtPath = options.qtPath || settings.qtPath || cache?.detected.qt?.path || process.env.QT_PILOT_QT_PATH || '';
    const vsDevShell = options.vsDevShell || settings.vsDevShellPath || cache?.detected.vs?.devShellPath || process.env.QT_PILOT_VS_DEV_SHELL || '';
    const qmakeTarget = options.target || settings.qmakeTarget || '';
    const resolved = buildResolvedConfig(mode, arch, qtPath, vsDevShell, qmakeTarget);

    if (options.action === 'init') {
        if (options.executionMode === 'execute') {
            ensureLocalStateDir(workspace);
            ensureCompilotGitignored(workspace);
            const detected = await detectAndCache(workspace, options);
            writeLocalCache(workspace, detected);
            if (project) {
                const updatedSettings: QtPilotSettings = {
                    ...settings,
                    mode,
                    arch,
                    qtPath: qtPath || detected.detected.qt?.path || '',
                    vsDevShellPath: vsDevShell || detected.detected.vs?.devShellPath || '',
                    qmakeTarget
                };
                saveSettings(workspace, updatedSettings);
            }
            return { ...result, ok: true, project, diagnostics: [], resolved };
        }

        // dry-run: preview what init --execute would do
        const detected = await detectAndCache(workspace, options);
        const previewDiagnostics: CliResult['diagnostics'] = [];
        const previewNextActions: string[] = [];

        previewDiagnostics.push({ level: 'info', message: `将创建 .compilot/ 目录` });
        previewDiagnostics.push({ level: 'info', message: `将确保 .gitignore 包含 .compilot/` });
        previewDiagnostics.push({ level: 'info', message: `将写入 cache.json（环境检测结果）` });

        if (project) {
            previewDiagnostics.push({ level: 'info', message: `将写入 config.json（选中项目: ${path.basename(project)}）` });
        } else if (detected.detected.projects.length > 1) {
            previewDiagnostics.push({ level: 'warning', message: `发现 ${detected.detected.projects.length} 个 .pro 文件，init 不会自动选择项目` });
            previewNextActions.push('使用 --project <path> 指定要保存的默认项目');
        } else if (detected.detected.projects.length === 0) {
            previewDiagnostics.push({ level: 'warning', message: '未检测到 .pro 文件，config.json 不会包含项目路径' });
        }

        if (detected.detected.qt) {
            previewDiagnostics.push({ level: 'info', message: `检测到 Qt: ${detected.detected.qt.path}` });
        } else {
            previewDiagnostics.push({ level: 'warning', message: 'Qt 路径未检测到，可使用 --qt-path 指定' });
        }

        if (detected.detected.vs) {
            previewDiagnostics.push({ level: 'info', message: `检测到 VS DevShell: ${detected.detected.vs.devShellPath}` });
        } else if (process.platform === 'win32') {
            previewDiagnostics.push({ level: 'warning', message: 'VS DevShell 未检测到，可使用 --vs-dev-shell 指定' });
        }

        previewNextActions.push('确认无误后运行 init --execute --json 写入本地配置');

        return {
            ...result,
            ok: true,
            project,
            candidates: detected.detected.projects,
            diagnostics: previewDiagnostics,
            nextActions: previewNextActions,
            resolved
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
        qmakeTarget
    });
    let commands: string[] = [];

    if (options.action === 'qmake') {
        commands = shellBuilder.qmakeCommands(buildConfig).commands;
    } else if (options.action === 'build') {
        commands = shellBuilder.buildCommands(buildConfig).commands;
    } else if (options.action === 'run') {
        const buildCmds = shellBuilder.buildCommands(buildConfig).commands;
        // Append run command (launch executable) for both dry-run and execute
        if (project) {
            const runCmd = buildRunCommand(project, mode, arch);
            if (runCmd) {
                // Kill existing process before build (use actual exe name from Makefile)
                const runtimeTarget = resolveRuntimeTarget(path.dirname(project), mode, arch);
                const exeName = runtimeTarget ? path.basename(runtimeTarget.exePath, path.extname(runtimeTarget.exePath)) : path.basename(project, '.pro');
                const killCmd = (process.platform === 'win32' ? winConfig : linuxConfig).killCommand(exeName);
                commands = [killCmd, ...buildCmds, runCmd];
            } else {
                // Makefile not yet generated — can't resolve executable path
                const environmentGuidance = buildEnvironmentGuidance(options.action, qtPath, vsDevShell);
                const fallbackExeName = path.basename(project, '.pro');
                const fallbackKillCmd = (process.platform === 'win32' ? winConfig : linuxConfig).killCommand(fallbackExeName);
                const fallbackCmds = [fallbackKillCmd, ...shellBuilder.buildCommands(buildConfig).commands];
                return {
                    ...result,
                    ok: true,
                    project,
                    commands: fallbackCmds,
                    shellCommand: fallbackCmds.join(' && '),
                    diagnostics: [
                        ...environmentGuidance.diagnostics,
                        { level: 'warning', message: '无法解析可执行文件路径（Makefile 可能尚未生成），仅返回 build 命令' }
                    ],
                    nextActions: [
                        ...environmentGuidance.nextActions,
                        '先执行 qmake 生成 Makefile，再重新调用 run'
                    ],
                    resolved
                };
            }
        }
    } else if (options.action === 'clean') {
        commands = shellBuilder.cleanCommands(buildConfig).commands;
    } else if (options.action === 'stop') {
        commands = shellBuilder.stopCommands(path.basename(project || 'app', '.pro'));
    }

    const environmentGuidance = buildEnvironmentGuidance(options.action, qtPath, vsDevShell);

    return {
        ...result,
        ok: true,
        project,
        commands,
        shellCommand: commands.length > 0 ? commands.join(' && ') : '',
        diagnostics: environmentGuidance.diagnostics,
        nextActions: environmentGuidance.nextActions,
        resolved
    };
}
