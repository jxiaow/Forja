import * as vscode from 'vscode';
import * as path from 'path';
import { getMode, getArch, setBuilding, setRunning } from './statusBar';
import { getCurrentProject } from './projectManager';
import { getEnvInfo } from './envDetector';
import { PlatformBuilder, BuildConfig } from './platform/builder';
import { winBuilder } from './platform/win/builder';
import { linuxBuilder } from './platform/linux/builder';
import { log } from './logger';

const builder: PlatformBuilder = process.platform === 'win32' ? winBuilder : linuxBuilder;

function getConfig(): BuildConfig {
    const cfg = vscode.workspace.getConfiguration('xyQt');
    const project = getCurrentProject();
    const env = getEnvInfo();
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
    const projectDir = project?.projectDir ? path.join(root, project.projectDir) : '';
    const mode = getMode();
    // {MODE} 是 parseProFile 里对 $$CONFIGURATION 等变量的占位符
    const rawDestDir = project?.destDir || '';
    const destDir = rawDestDir.replace(/\{MODE\}/g, mode);
    return {
        vsDevShell: cfg.get<string>('vsDevShellPath', '') || env?.vs?.devShellPath || '',
        qtPath: cfg.get<string>('qtPath', '') || env?.qt?.path || '',
        projectDir,
        proFile: project?.proFile || '',
        exeName: project?.target || 'app',
        destDir,
        arch: getArch(),
        mode
    };
}

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

export function qmake(): Thenable<vscode.TaskExecution> {
    const cfg = getConfig();
    const { commands, matcher } = builder.qmakeCommands(cfg);
    return runTask(`QMake ${cfg.mode}`, commands, matcher);
}

export function build(): Thenable<vscode.TaskExecution> {
    const cfg = getConfig();
    const { commands, matcher } = builder.buildCommands(cfg);
    return runTask(`Build ${cfg.mode}`, commands, matcher);
}

export function clean(): Thenable<vscode.TaskExecution> {
    const cfg = getConfig();
    const { commands, matcher } = builder.cleanCommands(cfg);
    return runTask(`Clean ${cfg.mode}`, commands, matcher);
}


export async function run(): Promise<void> {
    const cfg = getConfig();
    setBuilding(true);
    setRunning(false);

    const { commands, matcher } = builder.buildCommands(cfg);
    const buildTask = new vscode.Task(
        { type: 'shell' },
        vscode.TaskScope.Workspace, `Build ${cfg.mode}`, 'XY Qt',
        builder.makeExec(commands), matcher
    );
    buildTask.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, echo: true, focus: true, showReuseMessage: false, clear: false };
    const execution = await vscode.tasks.executeTask(buildTask);

    return new Promise<void>((resolve, reject) => {
        const disposable = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) {
                disposable.dispose();
                setBuilding(false);
                if (e.exitCode === 0) {
                    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
                    const exePath = builder.exePath(root, cfg);
                    const runCmds = [builder.killApp(cfg.exeName), `"${exePath}"`];
                    const runTaskObj = new vscode.Task(
                        { type: 'shell' },
                        vscode.TaskScope.Workspace, `Run ${cfg.mode}`, 'XY Qt',
                        builder.makeExec(runCmds), []
                    );
                    vscode.tasks.executeTask(runTaskObj);
                    setRunning(true);
                    resolve();
                } else {
                    reject(new Error('构建失败'));
                }
            }
        });
    });
}

export function stop(): void {
    const cfg = getConfig();
    runTask('Stop', builder.stopCommands(cfg.exeName), []);
    setRunning(false);
}
