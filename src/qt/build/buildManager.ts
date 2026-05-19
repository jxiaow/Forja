import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { setState, getState } from '../../core/qtState';
import { getBuildConfig, getRccProjectPath } from '../services/configService';
import { PlatformBuilder, createBuilder } from '../platform/builder';
import { winConfig, getVsDevCmd } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import { getMakefileInfo, parseLibPaths } from '../project/projectManager';
import { createLogger } from '../../core/logger';
import { resolveProjectRoot } from '../../core/workspaceResolver';
import { resolveRccProjectPath, scanRccTargets, rccNeedsRebuild, buildRccCommands } from '../shared/rccResolver';
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


// 静默 kill（不开新 terminal）
function _killApp(exeName: string): void {
    const cmd = isWin
        ? `taskkill /F /IM ${exeName}.exe`
        : `pkill -x ${exeName}`;
    logger.info(`Kill app: ${cmd}`);
    cp.exec(cmd, (err) => {
        if (err && !err.message.includes('not found') && !err.message.includes('找不到') && !err.message.includes('没有找到')) {
            logger.error(`Kill app failed: ${err.message}`);
        }
    });
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

export function build(): Thenable<vscode.TaskExecution> {
    if (!_ensureEnvReady()) { return Promise.reject(new Error('环境检测未完成')); }
    const cfg = getBuildConfig();
    const { commands, matcher } = builder.buildCommands(cfg);
    return runTask(`Build ${cfg.mode}`, commands, matcher);
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
    const needs = rccNeedsRebuild(targets);
    if (needs) { logger.info('RCC 资源有变更，需要重编'); }
    return needs;
}

export async function run(): Promise<void> {
    if (!_ensureEnvReady()) { return; }
    const cfg = getBuildConfig();
    setState('isBuilding', true);
    setState('buildAction', 'run');
    setState('isRunning', false);

    // 检查 rcc 是否需要重新编译
    if (_rccNeedsRebuild()) {
        logger.info('RCC 资源有变更，先执行 rcc 编译');
        try {
            const rccExecution = await rcc();
            // 等待 rcc 任务完成
            await new Promise<void>((resolve, reject) => {
                const d = vscode.tasks.onDidEndTaskProcess(e => {
                    if (e.execution === rccExecution) {
                        d.dispose();
                        if (e.exitCode === 0) { resolve(); }
                        else { reject(new Error('RCC 编译失败')); }
                    }
                });
            });
        } catch (e) {
            setState('isBuilding', false);
            setState('buildAction', null);
            throw e;
        }
    }

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

            const mfInfo = _resolveMakefileInfo();
            if (!mfInfo) {
                vscode.window.showErrorMessage(`请先运行 QMake (${cfg.mode})`);
                reject(new Error('无法确定可执行文件路径'));
                return;
            }

            // 先静默 kill 旧进程，再用 task 启动（保留 shell 环境变量）
            _killApp(mfInfo.target);

            const runCmds: string[] = [];
            if (!isWin) {
                const libPaths = parseLibPaths(cfg.projectDir);
                if (libPaths.length > 0) {
                    const joined = libPaths.join(':');
                    runCmds.push(`export LD_LIBRARY_PATH="${joined}:$LD_LIBRARY_PATH"`);
                    logger.info(`Run env: LD_LIBRARY_PATH += ${joined}`);
                }
            }
            runCmds.push(`"${mfInfo.exePath}"`);
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
            _runEndDisposable = vscode.tasks.onDidEndTask(e => {
                if (e.execution.task.name === `Run ${cfg.mode}` && e.execution.task.source === TASK_SOURCE_QT) {
                    _runEndDisposable?.dispose();
                    _runEndDisposable = undefined;
                    setState('isRunning', false);
                }
            });

            vscode.tasks.executeTask(runTaskObj).then(() => {
                setState('isRunning', true);
            });

            resolve();
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

export function stop(): void {
    const cfg = getBuildConfig();
    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode, cfg.arch);
    const exeName = mfInfo?.target || 'app';
    logger.info(`Stop current target: ${exeName}`);
    _killApp(exeName);
    setState('isRunning', false);
}

export function stopCurrentTarget(): void {
    stop();
}
