import * as fs from 'fs';
import * as path from 'path';
import { CliOptions, CliResolvedConfig, CliResult } from '../cli/types';
import { createShellPlanBuilder } from '../platform/shellPlan';
import { winConfig } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import { resolveBuildConfig } from './configResolver';
import { buildRunCommand } from './commandRunner';
import { resolveRuntimeTarget, validateMakefile } from './runtimeTarget';
import { resolveRccProjectPath, scanRccTargets, rccNeedsRebuild, buildRccCommands } from './rccResolver';
import { getDefaultArch } from '../platform/requirements';

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

export async function createActionPlan(options: CliOptions): Promise<CliResult> {
    const workspace = resolveWorkspace(options.workspace);
    const result = emptyResult(options, workspace);

    if (!fs.existsSync(workspace)) {
        result.diagnostics.push({ level: 'error', message: `workspace 不存在: ${workspace}` });
        return result;
    }

    const project = options.project || null;
    const mode = options.mode || 'debug';
    const arch = options.arch || getDefaultArch();
    const qtPath = options.qtPath || '';
    const vsDevShell = options.vsDevShell || '';
    const target = options.target || '';
    const qmakeArgs = options.qmakeArgs || '';
    const jomPath = options.jomPath || '';
    const resolved = buildResolvedConfig(mode, arch, qtPath, vsDevShell, target, undefined, undefined, jomPath || undefined);

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
        jomPath,
        jobs: options.jobs,
    });
    const resolvedProject = project
        ? path.join(buildConfig.projectDir, buildConfig.proFile)
        : null;
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
            const runtimeTarget = resolveRuntimeTarget(buildConfig.projectDir, mode, arch);
            // rcc 在 build 之后编译 — pro 构建步骤会拷贝 rcc，必须在拷贝后再编译
            let rccCmds: string[] = [];
            const rccPath = resolveRccProjectPath(options.rccProjectPath || '', workspace);
            if (rccPath) {
                const targets = scanRccTargets(rccPath);
                let outputDir: string | null = null;
                if (runtimeTarget) { outputDir = path.dirname(runtimeTarget.exePath); }
                if (targets.length > 0 && rccNeedsRebuild(targets, outputDir)) {
                    rccCmds = buildRccCommands(targets, qtPath, outputDir, process.platform === 'win32' ? 'win32' : 'linux');
                    result.diagnostics.push({ level: 'info', message: 'RCC 资源有变更，已插入 rcc 编译命令' });
                }
            }

            const dedupedBuildCmds = qmakeCmds.length > 0 ? buildCmds.slice(shellBuilder.initCommands(buildConfig).length) : buildCmds;
            if (qmakeCmds.length > 0 || rccCmds.length > 0) {
                commands = [...qmakeCmds, ...dedupedBuildCmds, ...rccCmds];
            } else {
                commands = buildCmds;
            }
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

        // Append run command (launch executable) for both dry-run and execute
        if (project) {
            const runCmd = buildRunCommand(resolvedProject!, mode, arch, qtPath);
            // Deduplicate env init when combining qmake + build
            const initLen = shellBuilder.initCommands(buildConfig).length;
            const dedupedBuildCmds = qmakeCmds.length > 0 ? buildCmds.slice(initLen) : buildCmds;

            // rcc 在 build 之后、启动之前编译 — pro 构建步骤会拷贝 rcc，必须在拷贝后再编译
            let rccCmds: string[] = [];
            const rccPath = resolveRccProjectPath(options.rccProjectPath || '', workspace);
            if (rccPath) {
                const targets = scanRccTargets(rccPath);
                let outputDir: string | null = null;
                const rt = resolveRuntimeTarget(buildConfig.projectDir, mode, arch);
                if (rt) { outputDir = path.dirname(rt.exePath); }
                if (targets.length > 0 && rccNeedsRebuild(targets, outputDir)) {
                    rccCmds = buildRccCommands(targets, qtPath, outputDir, process.platform === 'win32' ? 'win32' : 'linux');
                    result.diagnostics.push({ level: 'info', message: 'RCC 资源有变更，已插入 rcc 编译命令' });
                }
            }

            if (runCmd) {
                const runtimeTarget = resolveRuntimeTarget(buildConfig.projectDir, mode, arch);
                commands = [...qmakeCmds, ...dedupedBuildCmds, ...rccCmds, runCmd];
                result.executablePath = runtimeTarget?.exePath;
            } else {
                // Makefile not yet generated or mismatched — return build commands with hint to run status
                const fallbackCmds = [...qmakeCmds, ...dedupedBuildCmds];
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
        const rccPath = resolveRccProjectPath(options.rccProjectPath || '', workspace);
        if (!rccPath) {
            result.diagnostics.push({ level: 'error', message: '未找到 XYRcc 目录，请在配置中设置 rccProjectPath' });
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
            const runtimeTarget = resolveRuntimeTarget(buildConfig.projectDir, mode, arch);
            if (runtimeTarget) { outputDir = path.dirname(runtimeTarget.exePath); }
        }
        // rcc 只需要 Qt bin 在 PATH，不需要 VS 环境
        const rccCmds = buildRccCommands(targets, qtPath, outputDir, process.platform === 'win32' ? 'win32' : 'linux');
        commands = rccCmds;
        if (!outputDir) {
            result.diagnostics.push({ level: 'warning', message: '无法确定输出目录，.rcc 仅生成不复制' });
        }
    } else {
        result.diagnostics.push({ level: 'error', message: `createActionPlan 不支持的 action: ${options.action}` });
        return result;
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
