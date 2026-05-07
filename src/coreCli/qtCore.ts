import * as fs from 'fs';
import * as path from 'path';
import { CliOptions, CliResolvedConfig, CliResult } from '../cli/types';
import { detectEnv } from '../env/envDetector';
import { createShellPlanBuilder } from '../platform/shellPlan';
import { winConfig } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import {
    LocalCache,
    LocalConfig,
    ensureLocalStateDir,
    ensureWorkGitignored,
    readLocalCache,
    readLocalConfig,
    writeLocalCache,
    writeLocalConfig
} from './localState';

const maxScanDepth = 5;

function emptyResult(options: CliOptions, workspace: string): CliResult {
    return {
        ok: false,
        action: options.action,
        mode: options.executionMode,
        workspace,
        project: null,
        commands: [],
        candidates: [],
        nextActions: [],
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        logFile: null,
        diagnostics: [],
        resolved: null
    };
}

function scanProFiles(root: string): string[] {
    const proFiles: string[] = [];

    function scan(dir: string, depth: number): void {
        if (depth > maxScanDepth) { return; }
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const skip = ['node_modules', '.git', '.work', 'build', 'debug', 'release', 'out'];
                if (entry.isDirectory() && !skip.includes(entry.name.toLowerCase())) {
                    scan(path.join(dir, entry.name), depth + 1);
                } else if (entry.isFile() && entry.name.endsWith('.pro')) {
                    proFiles.push(path.join(dir, entry.name));
                }
            }
        } catch {}
    }

    scan(root, 0);
    return proFiles.map(p => path.relative(root, p).replace(/\\/g, '/'));
}

function resolveWorkspace(input: string | null): string {
    return path.resolve(input || process.cwd());
}

function insideWorkspace(workspace: string, filePath: string): boolean {
    const rel = path.relative(workspace, filePath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveProject(workspace: string, options: CliOptions, config: LocalConfig | null): { project: string | null; error: string | null } {
    const explicitProject = options.project ? path.resolve(options.project) : null;
    if (explicitProject) {
        if (!insideWorkspace(workspace, explicitProject)) {
            return { project: null, error: '.pro 文件必须位于 workspace 内' };
        }
        return { project: explicitProject, error: null };
    }
    if (config?.project && fs.existsSync(config.project)) {
        return { project: config.project, error: null };
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

    if (!['qmake', 'build', 'run'].includes(action)) {
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

    const config = readLocalConfig(workspace);
    const cache = readLocalCache(workspace);

    if (options.action === 'detect' || options.action === 'projects' || options.action === 'status') {
        const detected = await detectAndCache(workspace, options);
        const candidates = detected.detected.projects;
        const project = config?.project && fs.existsSync(config.project)
            ? config.project
            : candidates.length === 1
                ? candidates[0]
                : null;
        const mode = options.mode || config?.mode || 'debug';
        const arch = options.arch || config?.arch || 'x86';
        const qtPath = options.qtPath || config?.qtPath || detected.detected.qt?.path || '';
        const vsDevShell = options.vsDevShell || config?.vsDevShell || detected.detected.vs?.devShellPath || '';
        const qmakeTarget = options.target || config?.qmakeTarget || '';
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

    const projectResult = resolveProject(workspace, options, config);
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
    const projectDir = project ? path.dirname(project) : workspace;
    const proFile = project ? path.basename(project) : '';
    const mode = options.mode || config?.mode || 'debug';
    const arch = options.arch || config?.arch || 'x86';
    const qtPath = options.qtPath || config?.qtPath || cache?.detected.qt?.path || process.env.QT_PILOT_QT_PATH || '';
    const vsDevShell = options.vsDevShell || config?.vsDevShell || cache?.detected.vs?.devShellPath || process.env.QT_PILOT_VS_DEV_SHELL || '';
    const qmakeTarget = options.target || config?.qmakeTarget || '';
    const resolved = buildResolvedConfig(mode, arch, qtPath, vsDevShell, qmakeTarget);

    if (options.action === 'init') {
        if (options.executionMode === 'execute') {
            ensureLocalStateDir(workspace);
            ensureWorkGitignored(workspace);
            const detected = await detectAndCache(workspace, options);
            writeLocalCache(workspace, detected);
            if (project) {
                writeLocalConfig(workspace, {
                    version: 1,
                    workspace,
                    project,
                    mode,
                    arch,
                    qtPath: qtPath || detected.detected.qt?.path || '',
                    vsDevShell: vsDevShell || detected.detected.vs?.devShellPath || '',
                    qmakeTarget
                });
            }
        }
        return { ...result, ok: true, project, diagnostics: [], resolved };
    }

    const shellBuilder = createShellPlanBuilder(process.platform === 'win32' ? winConfig : linuxConfig);
    const buildConfig = { vsDevShell, qtPath, projectDir, proFile, arch, mode, qmakeTarget };
    let commands: string[] = [];

    if (options.action === 'qmake') {
        commands = shellBuilder.qmakeCommands(buildConfig).commands;
    } else if (options.action === 'build' || options.action === 'run') {
        commands = shellBuilder.buildCommands(buildConfig).commands;
    } else if (options.action === 'stop') {
        commands = shellBuilder.stopCommands(path.basename(project || 'app', '.pro'));
    }

    const environmentGuidance = buildEnvironmentGuidance(options.action, qtPath, vsDevShell);

    return {
        ...result,
        ok: true,
        project,
        commands,
        diagnostics: environmentGuidance.diagnostics,
        nextActions: environmentGuidance.nextActions,
        resolved
    };
}
