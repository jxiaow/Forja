import * as fs from 'fs';
import * as path from 'path';
import { CliOptions, CliResult } from '../cli/types';
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
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        logFile: null,
        diagnostics: []
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

    if (options.action === 'detect' || options.action === 'projects') {
        const detected = await detectAndCache(workspace, options);
        if (options.saveLocal) {
            ensureLocalStateDir(workspace);
            writeLocalCache(workspace, detected);
        }
        return { ...result, ok: true, diagnostics: [], commands: [] };
    }

    const projectResult = resolveProject(workspace, options, config);
    if (projectResult.error && options.action !== 'init') {
        result.diagnostics.push({ level: 'error', message: projectResult.error });
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
        return { ...result, ok: true, project, diagnostics: [] };
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

    return {
        ...result,
        ok: true,
        project,
        commands,
        diagnostics: []
    };
}
