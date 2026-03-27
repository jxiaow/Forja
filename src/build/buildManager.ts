import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { setState } from '../core/stateManager';
import { getBuildConfig } from '../core/configService';
import { PlatformBuilder, createBuilder } from '../platform/builder';
import { winConfig } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import { getMakefileInfo, parseLibPaths } from '../project/projectManager';
import { log } from '../core/logger';

const builder: PlatformBuilder = createBuilder(process.platform === 'win32' ? winConfig : linuxConfig);
const isWin = process.platform === 'win32';

// QMake/Build/Clean 共用一个 Shared terminal（保留 problem matcher）
function runTask(name: string, commands: string[], matcher: string | string[]): Thenable<vscode.TaskExecution> {
    log(`[Task] ${name}: ${commands.join(' && ')}`);
    const task = new vscode.Task(
        { type: 'shell' },
        vscode.TaskScope.Workspace, name, 'XYQt',
        builder.makeExec(commands), matcher
    );
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Shared,
        echo: true,
        focus: true,
        showReuseMessage: false,
        clear: true
    };
    return vscode.tasks.executeTask(task);
}

// Run 用持久 terminal，与 build terminal 分开，程序输出不干扰编译错误
let _runTerminal: vscode.Terminal | undefined;

function _getRunTerminal(): vscode.Terminal {
    if (!_runTerminal || _runTerminal.exitStatus !== undefined) {
        _runTerminal = vscode.window.createTerminal({ name: 'XYQt - Run' });
    }
    return _runTerminal;
}

// 静默 kill（不开新 terminal）
function _killApp(exeName: string): void {
    const cmd = isWin
        ? `taskkill /F /IM ${exeName}.exe`
        : `pkill -x ${exeName}`;
    log(`[killApp] ${cmd}`);
    cp.exec(cmd, (err) => {
        if (err) { log(`[killApp] ${err.message}`); }
    });
}

// 从 Makefile 解析 MakefileInfo，失败返回 null 并记录日志
function _resolveMakefileInfo(): ReturnType<typeof getMakefileInfo> {
    const cfg = getBuildConfig();
    log(`[resolveMakefileInfo] projectDir="${cfg.projectDir}", mode="${cfg.mode}", arch="${cfg.arch}"`);
    if (!cfg.projectDir) { return null; }
    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode, cfg.arch);
    if (!mfInfo) {
        log('[resolveMakefileInfo] 解析失败');
        return null;
    }
    log(`[resolveMakefileInfo] exePath="${mfInfo.exePath}", exists=${fs.existsSync(mfInfo.exePath)}`);
    return mfInfo;
}

export function qmake(): Thenable<vscode.TaskExecution> {
    const cfg = getBuildConfig();
    const { commands, matcher } = builder.qmakeCommands(cfg);
    return runTask(`QMake ${cfg.mode}`, commands, matcher);
}

export function build(): Thenable<vscode.TaskExecution> {
    const cfg = getBuildConfig();
    const { commands, matcher } = builder.buildCommands(cfg);
    return runTask(`Build ${cfg.mode}`, commands, matcher);
}

export function clean(): Thenable<vscode.TaskExecution> {
    const cfg = getBuildConfig();
    const { commands, matcher } = builder.cleanCommands(cfg);
    return runTask(`Clean ${cfg.mode}`, commands, matcher);
}

export async function run(): Promise<void> {
    const cfg = getBuildConfig();
    setState('isBuilding', true);
    setState('isRunning', false);

    const { commands, matcher } = builder.buildCommands(cfg);
    const buildTask = new vscode.Task(
        { type: 'shell' },
        vscode.TaskScope.Workspace, `Build ${cfg.mode}`, 'XYQt',
        builder.makeExec(commands), matcher
    );
    buildTask.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Shared,
        echo: true,
        focus: true,
        showReuseMessage: false,
        clear: true
    };
    const execution = await vscode.tasks.executeTask(buildTask);

    return new Promise<void>((resolve, reject) => {
        let settled = false;

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

            // 先静默 kill 旧进程，再用持久 terminal 启动
            _killApp(mfInfo.target);

            // Linux: 设置 LD_LIBRARY_PATH
            const term = _getRunTerminal();
            if (!isWin) {
                const libPaths = parseLibPaths(cfg.projectDir);
                if (libPaths.length > 0) {
                    const joined = libPaths.join(':');
                    term.sendText(`export LD_LIBRARY_PATH="${joined}:$LD_LIBRARY_PATH"`);
                    log(`[Run] LD_LIBRARY_PATH += ${joined}`);
                }
            }
            term.sendText(`"${mfInfo.exePath}"`);
            term.show(false); // false = 不抢焦点
            setState('isRunning', true);

            // 监听 run terminal 关闭
            const dTerm = vscode.window.onDidCloseTerminal(t => {
                if (t === _runTerminal) {
                    dTerm.dispose();
                    setState('isRunning', false);
                }
            });

            resolve();
        };

        const d1 = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) { finish(e.exitCode); }
        });
        const d2 = vscode.tasks.onDidEndTask(e => {
            if (e.execution === execution) { finish(undefined); }
        });
    });
}

export function stop(): void {
    const cfg = getBuildConfig();
    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode, cfg.arch);
    const exeName = mfInfo?.target || 'app';
    _killApp(exeName);
    setState('isRunning', false);
}
