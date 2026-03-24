import * as vscode from 'vscode';
import * as path from 'path';
import { getMode, getArch, setBuilding, setRunning } from './statusBar';
import { getCurrentProject } from './projectManager';
import { getEnvInfo } from './envDetector';
import { PlatformBuilder, BuildConfig } from './platform/builder';
import { winBuilder } from './platform/win/builder';
import { linuxBuilder } from './platform/linux/builder';

const builder: PlatformBuilder = process.platform === 'win32' ? winBuilder : linuxBuilder;

function getConfig(): BuildConfig {
    const cfg = vscode.workspace.getConfiguration('xyQt');
    const project = getCurrentProject();
    const env = getEnvInfo();
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
    const projectDir = project?.projectDir ? path.join(root, project.projectDir) : '';
    return {
        vsDevShell: cfg.get<string>('vsDevShellPath', '') || env?.vs?.devShellPath || '',
        qtPath: cfg.get<string>('qtPath', '') || env?.qt?.path || '',
        projectDir,
        proFile: project?.proFile || '',
        exeName: project?.target || 'app',
        arch: getArch(),
        mode: getMode()
    };
}

// Windows 用 Task（需要 VS DevShell），Linux 用 Terminal（输出更可靠）
function runInTerminal(name: string, commands: string[]): void {
    const cmd = commands.join(' && ');
    const terminal = vscode.window.createTerminal({ name });
    terminal.show();
    terminal.sendText(cmd);
}

function runTask(name: string, commands: string[], matcher: string | string[]): Thenable<vscode.TaskExecution> {
    const task = new vscode.Task(
        { type: 'shell', task: name },
        vscode.TaskScope.Workspace, name, 'XY Qt',
        builder.makeExec(commands), matcher
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.New, echo: true, focus: true };
    return vscode.tasks.executeTask(task);
}

const isWin = process.platform === 'win32';

export function qmake(): void | Thenable<vscode.TaskExecution> {
    const cfg = getConfig();
    const { commands, matcher } = builder.qmakeCommands(cfg);
    if (isWin) { return runTask(`QMake ${cfg.mode} ${cfg.arch}`, commands, matcher); }
    runInTerminal(`QMake ${cfg.mode}`, commands);
}

export function build(): void | Thenable<vscode.TaskExecution> {
    const cfg = getConfig();
    const { commands, matcher } = builder.buildCommands(cfg);
    if (isWin) { return runTask(`Build ${cfg.mode} ${cfg.arch}`, commands, matcher); }
    runInTerminal(`Build ${cfg.mode}`, commands);
}

export function clean(): void | Thenable<vscode.TaskExecution> {
    const cfg = getConfig();
    const { commands, matcher } = builder.cleanCommands(cfg);
    if (isWin) { return runTask(`Clean ${cfg.mode} ${cfg.arch}`, commands, matcher); }
    runInTerminal(`Clean ${cfg.mode}`, commands);
}


export async function run(): Promise<void> {
    const cfg = getConfig();
    setBuilding(true);
    setRunning(false);

    if (!isWin) {
        // Linux: terminal 执行，build + run 串联，make 失败则不启动
        const { commands } = builder.buildCommands(cfg);
        const exePath = builder.exePath('', cfg);
        // buildCommands 已含 killApp，直接追加运行
        const runCmds = [...commands, `"${exePath}"`];
        runInTerminal(`Run ${cfg.mode}`, runCmds);
        setBuilding(false);
        setRunning(true);
        return;
    }

    // Windows: Task 方式，可监听退出码
    const { commands, matcher } = builder.buildCommands(cfg);
    const buildTask = new vscode.Task(
        { type: 'shell', task: `Build ${cfg.mode} ${cfg.arch}` },
        vscode.TaskScope.Workspace, `Build ${cfg.mode} ${cfg.arch}`, 'XY Qt',
        builder.makeExec(commands), matcher
    );
    buildTask.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.New, echo: true, focus: true };
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
                        { type: 'shell', task: `Run ${cfg.mode} ${cfg.arch}` },
                        vscode.TaskScope.Workspace, `Run ${cfg.mode} ${cfg.arch}`, 'XY Qt',
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
    if (isWin) {
        runTask('Stop', builder.stopCommands(cfg.exeName), []);
    } else {
        runInTerminal('Stop', builder.stopCommands(cfg.exeName));
    }
    setRunning(false);
}
