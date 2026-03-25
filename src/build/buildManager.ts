import * as vscode from 'vscode';
import * as path from 'path';
import { setState } from '../core/stateManager';
import { getBuildConfig, getWorkspaceRoot } from '../core/configService';
import { PlatformBuilder, createBuilder } from '../platform/builder';
import { winConfig } from '../platform/win/builder';
import { linuxConfig } from '../platform/linux/builder';
import { getMakefileInfo } from '../project/projectManager';
import { log } from '../core/logger';

const builder: PlatformBuilder = createBuilder(process.platform === 'win32' ? winConfig : linuxConfig);
const isWin = process.platform === 'win32';

function runTask(name: string, commands: string[], matcher: string | string[]): Thenable<vscode.TaskExecution> {
    log(`[Task] ${name}: ${commands.join(' && ')}`);
    const task = new vscode.Task(
        { type: 'shell' },
        vscode.TaskScope.Workspace, name, 'XY Qt',
        builder.makeExec(commands), matcher
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, echo: true, focus: true, showReuseMessage: false, clear: false };
    return vscode.tasks.executeTask(task);
}

// 从 Makefile 解析 exe 完整路径，失败返回 null
function _resolveExePath(): string | null {
    const cfg = getBuildConfig();
    log(`[resolveExePath] projectDir="${cfg.projectDir}", mode="${cfg.mode}"`);
    if (!cfg.projectDir) { return null; }
    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode);
    log(`[resolveExePath] mfInfo=${JSON.stringify(mfInfo)}`);
    if (!mfInfo) { return null; }
    const exeName = isWin ? `${mfInfo.target}.exe` : mfInfo.target;
    if (mfInfo.destDir) {
        return path.join(cfg.projectDir, mfInfo.destDir, exeName);
    }
    return path.join(cfg.projectDir, exeName);
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
        vscode.TaskScope.Workspace, `Build ${cfg.mode}`, 'XY Qt',
        builder.makeExec(commands), matcher
    );
    buildTask.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, echo: true, focus: true, showReuseMessage: false, clear: false };
    const execution = await vscode.tasks.executeTask(buildTask);

    return new Promise<void>((resolve, reject) => {
        let settled = false;

        const finish = (exitCode: number | undefined) => {
            if (settled) { return; }
            settled = true;
            d1.dispose();
            d2.dispose();
            setState('isBuilding', false);

            // 终端被关闭（exitCode undefined）或构建失败
            if (exitCode === undefined) {
                reject(new Error('任务已终止'));
                return;
            }
            if (exitCode !== 0) {
                reject(new Error('构建失败'));
                return;
            }

            const exePath = _resolveExePath();
            if (!exePath) {
                vscode.window.showErrorMessage(`请先运行 QMake (${cfg.mode})`);
                reject(new Error('无法确定可执行文件路径'));
                return;
            }
            const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode)!;
            const runCmds = [builder.killApp(mfInfo.target), `"${exePath}"`];
            const runTaskObj = new vscode.Task(
                { type: 'shell' },
                vscode.TaskScope.Workspace, `Run ${cfg.mode}`, 'XY Qt',
                builder.makeExec(runCmds), []
            );
            vscode.tasks.executeTask(runTaskObj);
            setState('isRunning', true);
            resolve();
        };

        // 正常结束（有 exitCode）
        const d1 = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) { finish(e.exitCode); }
        });
        // 兜底：终端关闭或任务被取消（exitCode 为 undefined）
        const d2 = vscode.tasks.onDidEndTask(e => {
            if (e.execution === execution) { finish(undefined); }
        });
    });
}

export function stop(): void {
    const cfg = getBuildConfig();
    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode);
    const exeName = mfInfo?.target || 'app';
    runTask('Stop', builder.stopCommands(exeName), []);
    setState('isRunning', false);
}
