import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { setState, getState } from '../../vscode/qtState';
import { getBuildConfig, getRccProjectPath } from '../services/configService';
import { PlatformBuilder, createBuilder } from '../platform/builder';
import { winConfig, getVsDevCmd } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import { getMakefileInfo, parseLibPaths } from '../project/projectManager';
import { createLogger } from '../../vscode/logger';
import { resolveProjectRoot } from '../../vscode/workspaceResolver';
import { resolveRccProjectPath, scanRccTargets, rccNeedsRebuild, buildRccCommands } from '../shared/rccResolver';
import { validateMakefile, resolveRuntimeTarget, resolveDesiredExePath } from '../shared/runtimeTarget';
import { clearRunState, findExecutablePids, runLogPath, waitForNewExecutablePid, writeRunState } from '../shared/localState';
import { TASK_SOURCE_QT } from '../constants';

const builder: PlatformBuilder = createBuilder(process.platform === 'win32' ? winConfig : linuxConfig);
const isWin = process.platform === 'win32';
const logger = createLogger('Build');

/** Guard: 环境检测未完成时阻止构建操作 */
function _ensureEnvReady(): boolean {
    const env = getState().envInfo;
    if (!env) {
        vscode.window.showWarningMessage('环境检测尚未完成，请稍后再试');
        logger.warn('操作被阻止：envInfo 为 null（环境检测未完成）');
        return false;
    }
    return true;
}

/**
 * 检查 Makefile 是否与当前配置匹配。
 * 不匹配或不存在时自动执行 qmake 并等待完成。
 * 返回 true 表示 Makefile 已就绪可以继续 build；返回 false 表示 qmake 失败。
 */
async function _ensureMakefileFresh(cfg: ReturnType<typeof getBuildConfig>): Promise<boolean> {
    if (!cfg.projectDir) { return true; }
    const validation = validateMakefile(cfg.projectDir, {
        mode: cfg.mode,
        arch: cfg.arch,
        qtPath: cfg.qtPath,
        proFile: cfg.proFile,
        target: cfg.target,
        qmakeArgs: cfg.qmakeArgs
    });
    if (validation.exists && validation.matches) { return true; }

    // Makefile 不存在或与当前配置不匹配，自动执行 qmake
    const reason = !validation.exists
        ? '未找到 Makefile'
        : `Makefile 与当前配置不匹配（${validation.mismatch!.join(', ')}）`;
    logger.info(`自动 QMake：${reason}`);

    const { commands, matcher } = builder.qmakeCommands(cfg);
    const execution = await runTask(`QMake ${cfg.mode}`, commands, matcher);

    // 等待 qmake 任务完成（带超时保护）
    const exitCode = await new Promise<number | undefined>(resolve => {
        const timeout = setTimeout(() => {
            d.dispose();
            resolve(undefined);
        }, 120_000); // 2 minute timeout
        const d = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) {
                clearTimeout(timeout);
                d.dispose();
                resolve(e.exitCode);
            }
        });
    });

    if (exitCode !== 0) {
        vscode.window.showErrorMessage('QMake 失败，无法继续构建');
        return false;
    }
    return true;
}

/** Module-level disposable for Run task end listener (cleaned up on next run or extension deactivate) */
let _runEndDisposable: vscode.Disposable | undefined;

function _getTaskFolder(): vscode.WorkspaceFolder | vscode.TaskScope {
    const root = resolveProjectRoot();
    if (root) {
        const folder = vscode.workspace.workspaceFolders?.find(f => f.uri.fsPath === root);
        if (folder) { return folder; }
    }
    return vscode.TaskScope.Workspace;
}

// QMake/Build/Clean 共用一个 Shared terminal（保留 problem matcher）
function runTask(name: string, commands: string[], matcher: string | string[]): Thenable<vscode.TaskExecution> {
    logger.info(`Task ${name}: ${commands.join(' && ')}`);
    const task = new vscode.Task(
        { type: 'shell' },
        _getTaskFolder(), name, TASK_SOURCE_QT,
        builder.makeExec(commands), matcher
    );
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Shared,
        echo: true,
        focus: true,
        showReuseMessage: false,
        clear: false
    };
    return vscode.tasks.executeTask(task);
}


// 从 Makefile 解析 MakefileInfo，失败返回 null 并记录日志
function _resolveMakefileInfo(): ReturnType<typeof getMakefileInfo> {
    const cfg = getBuildConfig();
    logger.info(`Resolve MakefileInfo: projectDir="${cfg.projectDir}", mode="${cfg.mode}", arch="${cfg.arch}"`);
    if (!cfg.projectDir) { return null; }
    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode, cfg.arch);
    if (!mfInfo) {
        logger.warn('Resolve MakefileInfo failed');
        return null;
    }
    logger.info(`Resolved executable: exePath="${mfInfo.exePath}", exists=${fs.existsSync(mfInfo.exePath)}`);
    return mfInfo;
}

export function qmake(): Thenable<vscode.TaskExecution> {
    if (!_ensureEnvReady()) { return Promise.reject(new Error('环境检测未完成')); }
    const cfg = getBuildConfig();
    const { commands, matcher } = builder.qmakeCommands(cfg);
    return runTask(`QMake ${cfg.mode}`, commands, matcher);
}

export function qmakeForDebug(): Thenable<vscode.TaskExecution> {
    if (!_ensureEnvReady()) { return Promise.reject(new Error('环境检测未完成')); }
    const cfg = getBuildConfig();
    const extraConfigs = cfg.mode === 'release'
        ? ['CONFIG+=force_debug_info']
        : [];
    const { commands, matcher } = builder.qmakeCommands(cfg, extraConfigs);
    const taskName = cfg.mode === 'release'
        ? 'QMake release (debug info)'
        : `QMake ${cfg.mode}`;
    return runTask(taskName, commands, matcher);
}

export async function build(): Promise<vscode.TaskExecution> {
    if (!_ensureEnvReady()) { return Promise.reject(new Error('环境检测未完成')); }
    const cfg = getBuildConfig();
    if (!await _ensureMakefileFresh(cfg)) { return Promise.reject(new Error('需要先运行 QMake')); }

    // rcc 在 build 之后编译 — pro 构建步骤会拷贝 rcc，必须在拷贝后再编译
    const { commands, matcher } = builder.buildCommands(cfg);
    const execution = await runTask(`Build ${cfg.mode}`, commands, matcher);

    // 监听 build 任务完成，成功后执行重命名（如需要）再编译 rcc
    const disposable = vscode.tasks.onDidEndTaskProcess(e => {
        if (e.execution === execution && e.exitCode === 0) {
            disposable.dispose();
            // 构建后重命名
            const renameCmd = _renameExecutableIfNeeded(cfg);
            if (renameCmd) {
                logger.info(`重命名可执行文件: ${renameCmd}`);
                void _runRenameCommand(renameCmd).then(() => {
                    if (_rccNeedsRebuild()) { void _awaitRcc().catch(_handleRccError); }
                }).catch(err => {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error(`重命名失败: ${msg}`);
                    vscode.window.showWarningMessage(`重命名失败: ${msg}`);
                });
            } else if (_rccNeedsRebuild()) {
                void _awaitRcc().catch(_handleRccError);
            }
        }
    });

    return execution;
}

export function clean(): Thenable<vscode.TaskExecution> {
    if (!_ensureEnvReady()) { return Promise.reject(new Error('环境检测未完成')); }
    const cfg = getBuildConfig();
    const { commands, matcher } = builder.cleanCommands(cfg);
    return runTask(`Clean ${cfg.mode}`, commands, matcher);
}

// 检查 rcc 是否需要重新编译（使用共享模块）
function _rccNeedsRebuild(): boolean {
    const wsRoot = resolveProjectRoot();
    const rccPath = resolveRccProjectPath(getRccProjectPath(), wsRoot);
    if (!rccPath) { return false; }
    const targets = scanRccTargets(rccPath);
    if (targets.length === 0) { return false; }
    const mfInfo = _resolveMakefileInfo();
    const outputDir = mfInfo ? path.dirname(mfInfo.exePath) : null;
    const needs = rccNeedsRebuild(targets, outputDir);
    if (needs) { logger.info('RCC 资源有变更，需要重编'); }
    return needs;
}

async function _awaitRcc(): Promise<void> {
    logger.info('RCC 资源有变更，先执行 rcc 编译');
    const rccExecution = await rcc();
    await new Promise<void>((resolve, reject) => {
        const d = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === rccExecution) {
                d.dispose();
                if (e.exitCode === 0) { resolve(); }
                else { reject(new Error('RCC 编译失败')); }
            }
        });
    });
}

/**
 * 构建后重命名可执行文件（如果配置了 executableName）。
 * 返回重命名命令字符串，null 表示无需重命名。
 */
function _renameExecutableIfNeeded(cfg: ReturnType<typeof getBuildConfig>): string | null {
    if (!cfg.executableName || !cfg.projectDir) { return null; }
    const rt = resolveRuntimeTarget(cfg.projectDir, cfg.mode, cfg.arch);
    if (!rt) { return null; }
    const isWin = process.platform === 'win32';
    const actualBase = rt.target;
    const desiredBase = isWin ? cfg.executableName.replace(/\.exe$/i, '') : cfg.executableName;
    if (actualBase === desiredBase) { return null; }
    const exePath = rt.exePath;
    const desiredPath = resolveDesiredExePath(path.dirname(exePath), cfg.executableName);
    if (isWin) {
        return `(if exist "${exePath}" ren "${exePath}" "${desiredBase}.exe")`;
    } else {
        return `mv -f "${exePath}" "${desiredPath}"`;
    }
}

/** 执行重命名命令 */
async function _runRenameCommand(cmd: string): Promise<void> {
    const { exec } = await import('child_process');
    await new Promise<void>((resolve, reject) => {
        exec(cmd, (error) => {
            if (error) { reject(error); } else { resolve(); }
        });
    });
}

/** RCC 错误处理 */
function _handleRccError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`RCC 编译失败: ${msg}`);
    vscode.window.showWarningMessage(`RCC 编译失败: ${msg}`);
}

export async function run(): Promise<void> {
    if (!_ensureEnvReady()) { return; }
    const cfg = getBuildConfig();
    if (!await _ensureMakefileFresh(cfg)) { return; }
    setState('isBuilding', true);
    setState('buildAction', 'run');
    setState('isRunning', false);

    // rcc 在 build 之后、启动之前编译 — pro 构建步骤会拷贝 rcc，必须在拷贝后再编译

    const mfInfo = _resolveMakefileInfo();
    if (!mfInfo) {
        setState('isBuilding', false);
        setState('buildAction', null);
        vscode.window.showErrorMessage(`请先运行 QMake (${cfg.mode})`);
        throw new Error('无法确定可执行文件路径');
    }

    // Kill previous instance by executable path (PID-based, precise)
    const { terminateExecutable } = await import('../shared/commandRunner');
    terminateExecutable(mfInfo.exePath);

    const { commands, matcher } = builder.buildCommands(cfg);
    // Build task: 不清屏，失败时保留编译错误
    const buildTask = new vscode.Task(
        { type: 'shell' },
        _getTaskFolder(), `Build ${cfg.mode}`, TASK_SOURCE_QT,
        builder.makeExec(commands), matcher
    );
    buildTask.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Shared,
        echo: true,
        focus: true,
        showReuseMessage: false,
        clear: false
    };
    const execution = await vscode.tasks.executeTask(buildTask);

    return new Promise<void>((resolve, reject) => {
        let settled = false;
        let processEnded = false;

        const finish = (exitCode: number | undefined) => {
            if (settled) { return; }
            settled = true;
            d1.dispose();
            d2.dispose();
            setState('isBuilding', false);

            if (exitCode === undefined) {
                reject(new Error('任务已终止'));
                return;
            }
            if (exitCode !== 0) {
                reject(new Error('构建失败'));
                return;
            }

            // Build 成功，先重命名再编译 rcc、启动程序
            void (async (): Promise<void> => {
                // 构建后重命名（与 build() 一致）
                let launchExePath = mfInfo.exePath;
                const renameCmd = _renameExecutableIfNeeded(cfg);
                if (renameCmd) {
                    try {
                        logger.info(`重命名可执行文件: ${renameCmd}`);
                        await _runRenameCommand(renameCmd);
                        const rt = resolveRuntimeTarget(cfg.projectDir!, cfg.mode, cfg.arch);
                        if (rt && cfg.executableName) {
                            launchExePath = resolveDesiredExePath(path.dirname(rt.exePath), cfg.executableName);
                        }
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        logger.error(`重命名失败: ${msg}`);
                        vscode.window.showWarningMessage(`重命名失败: ${msg}`);
                    }
                }

                if (_rccNeedsRebuild()) {
                    try {
                        await _awaitRcc();
                    } catch (e) {
                        reject(e instanceof Error ? e : new Error('RCC 编译失败'));
                        return;
                    }
                }

                const runCmds: string[] = [];
                if (!isWin) {
                    const libPaths = parseLibPaths(cfg.projectDir);
                    if (libPaths.length > 0) {
                        const joined = libPaths.join(':');
                        runCmds.push(`export LD_LIBRARY_PATH="${joined}:$LD_LIBRARY_PATH"`);
                        logger.info(`Run env: LD_LIBRARY_PATH += ${joined}`);
                    }
                }
                runCmds.push(`"${launchExePath}"`);
                const runTaskObj = new vscode.Task(
                    { type: 'shell' },
                    _getTaskFolder(), `Run ${cfg.mode}`, TASK_SOURCE_QT,
                    builder.makeExec(runCmds), []
                );
                // 编译成功，Run task 清屏再启动
                runTaskObj.presentationOptions = {
                    reveal: vscode.TaskRevealKind.Always,
                    panel: vscode.TaskPanelKind.Shared,
                    echo: false,
                    focus: false,
                    showReuseMessage: false,
                    clear: true
                };

                // 先注册 Run task 结束监听，再执行（避免竞态漏掉事件）
                // 清理上一次的 disposable（如果还在）
                _runEndDisposable?.dispose();
                const runWorkspace = resolveProjectRoot();
                const previousPids = findExecutablePids(launchExePath);
                let runTaskEnded = false;
                clearRunState(runWorkspace);
                _runEndDisposable = vscode.tasks.onDidEndTask(e => {
                    if (e.execution.task.name === `Run ${cfg.mode}` && e.execution.task.source === TASK_SOURCE_QT) {
                        runTaskEnded = true;
                        _runEndDisposable?.dispose();
                        _runEndDisposable = undefined;
                        clearRunState(runWorkspace);
                        setState('isRunning', false);
                    }
                });

                void (async (): Promise<void> => {
                    try {
                        await vscode.tasks.executeTask(runTaskObj);
                        if (runTaskEnded) { return; }
                        setState('isRunning', true);
                        const pid = await waitForNewExecutablePid(launchExePath, previousPids);
                        if (runTaskEnded) { return; }
                        if (pid) {
                            writeRunState(runWorkspace, {
                                pid,
                                exePath: launchExePath,
                                executablePath: launchExePath,
                                logFile: runLogPath(runWorkspace),
                                startedAt: new Date().toISOString()
                            });
                        }
                    } catch (error) {
                        logger.error(`启动运行任务失败: ${error instanceof Error ? error.message : String(error)}`);
                        setState('isRunning', false);
                    }
                })();

                resolve();
            })();
        };

        // onDidEndTaskProcess gives us the exit code — preferred signal
        const d1 = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) {
                processEnded = true;
                finish(e.exitCode);
            }
        });
        // onDidEndTask is a fallback only when the process event never fires
        // (e.g., terminal manually closed). Use a short delay to let process event arrive first.
        const d2 = vscode.tasks.onDidEndTask(e => {
            if (e.execution === execution && !processEnded) {
                setTimeout(() => {
                    if (!settled && !processEnded) { finish(undefined); }
                }, 100);
            }
        });
    });
}

export function rcc(): Thenable<vscode.TaskExecution> {
    if (!_ensureEnvReady()) { return Promise.reject(new Error('环境检测未完成')); }
    const cfg = getBuildConfig();
    const wsRoot = resolveProjectRoot();

    const rccPath = resolveRccProjectPath(getRccProjectPath(), wsRoot);
    if (!rccPath) {
        vscode.window.showErrorMessage('未找到 XYRcc 目录，请在 settings.json 中配置 rccProjectPath');
        return Promise.reject(new Error('XYRcc 目录未找到'));
    }

    const targets = scanRccTargets(rccPath);
    if (targets.length === 0) {
        vscode.window.showErrorMessage('XYRcc 目录下未找到 .qrc 文件');
        return Promise.reject(new Error('未找到 .qrc 文件'));
    }

    // 解析当前项目的可执行文件输出目录
    const mfInfo = _resolveMakefileInfo();
    let outputDir: string | null = null;
    if (mfInfo) {
        outputDir = path.dirname(mfInfo.exePath);
    }
    if (!outputDir || !fs.existsSync(outputDir)) {
        vscode.window.showWarningMessage('无法确定可执行文件输出目录，.rcc 将仅生成不复制。请先运行 QMake + Build');
        outputDir = null;
    }

    logger.info(`RCC targets: ${targets.map(t => t.name).join(', ')}, outputDir: ${outputDir || 'none'}`);

    // 环境初始化 + rcc 编译命令
    const commands: string[] = [];
    if (isWin && cfg.vsDevShell) {
        commands.push(`call "${getVsDevCmd(cfg.vsDevShell)}" -arch=${cfg.arch} -no_logo`);
    }
    const rccCmds = buildRccCommands(targets, cfg.qtPath, outputDir, isWin ? 'win32' : 'linux');
    commands.push(...rccCmds);

    return runTask('RCC Compile', commands, isWin ? '$msCompile' : []);
}

export function runCustomCommand(name: string, command: string): Thenable<vscode.TaskExecution> {
    logger.info(`Custom command "${name}": ${command}`);
    return runTask(name, [command], []);
}
