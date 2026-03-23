import * as vscode from 'vscode';
import * as path from 'path';
import { getMode, getArch, setBuilding, setRunning } from './statusBar';
import { getCurrentProject } from './projectManager';
import { getEnvInfo } from './envDetector';

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('xyQt');
    const project = getCurrentProject();
    const env = getEnvInfo();
    // 手动配置优先，自动检测兜底
    const manualDevShell = cfg.get<string>('vsDevShellPath', '');
    const autoDevShell = env?.vs?.devShellPath || '';
    return {
        vsDevShell: manualDevShell || autoDevShell,
        projectDir: project?.projectDir || '',
        proFile: project?.proFile || '',
        exeName: project?.target || 'app',
        arch: getArch(),
        mode: getMode()
    };
}

// 将 Launch-VsDevShell.ps1 路径转换为同目录的 VsDevCmd.bat
function getVsDevCmd(vsDevShell: string): string {
    return vsDevShell.replace(/Launch-VsDevShell\.ps1$/i, 'VsDevCmd.bat');
}

// 用 PowerShell 执行命令序列，通过 cmd /c 调用 bat 初始化环境
// PowerShell 的 & 操作符可以正确处理带空格的路径
function makeCmdExec(commands: string[]): vscode.ShellExecution {
    const joined = commands.join(' && ');
    return new vscode.ShellExecution(joined, { executable: 'cmd.exe', shellArgs: ['/c'] });
}

function initShell(vsDevShell: string, arch: string): string {
    const vsDevCmd = getVsDevCmd(vsDevShell);
    return `call "${vsDevCmd}" -arch=${arch} -no_logo`;
}

function killApp(exeName: string): string {
    return `taskkill /F /IM ${exeName}.exe 2>nul & timeout /t 1 /nobreak >nul`;
}

function runTask(name: string, commands: string[], problemMatcher: string | string[] = '$msCompile') {
    const task = new vscode.Task(
        { type: 'shell', task: name },
        vscode.TaskScope.Workspace,
        name,
        'XY Qt',
        makeCmdExec(commands),
        problemMatcher
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared };
    return vscode.tasks.executeTask(task);
}

export function qmake() {
    const { vsDevShell, projectDir, proFile, arch, mode } = getConfig();
    const modeConfig = mode === 'debug' ? 'CONFIG+=debug CONFIG+=console' : 'CONFIG+=release';
    return runTask(`QMake ${mode} ${arch}`, [
        initShell(vsDevShell, arch),
        `cd /d "${projectDir}"`,
        `qmake ${proFile} -spec win32-msvc ${modeConfig} CONFIG+=${arch}`
    ]);
}

export function build() {
    const { vsDevShell, projectDir, exeName, arch, mode } = getConfig();
    return runTask(`Build ${mode} ${arch}`, [
        killApp(exeName),
        initShell(vsDevShell, arch),
        `cd /d "${projectDir}"`,
        'jom'
    ]);
}


export function clean() {
    const { vsDevShell, projectDir, arch, mode } = getConfig();
    return runTask(`Clean ${mode} ${arch}`, [
        initShell(vsDevShell, arch),
        `cd /d "${projectDir}"`,
        'jom clean'
    ]);
}

export async function run() {
    const { vsDevShell, projectDir, exeName, arch, mode } = getConfig();

    setBuilding(true);
    setRunning(false);

    const buildTask = new vscode.Task(
        { type: 'shell', task: `Build ${mode} ${arch}` },
        vscode.TaskScope.Workspace, `Build ${mode} ${arch}`, 'XY Qt',
        makeCmdExec([
            killApp(exeName),
            initShell(vsDevShell, arch),
            `cd /d "${projectDir}"`,
            'jom'
        ]), '$msCompile'
    );
    buildTask.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared };

    const execution = await vscode.tasks.executeTask(buildTask);

    return new Promise<void>((resolve, reject) => {
        const disposable = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) {
                disposable.dispose();
                setBuilding(false);

                if (e.exitCode === 0) {
                    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
                    const exePath = path.join(root, projectDir, mode, arch, `${exeName}.exe`);
                    const runTaskObj = new vscode.Task(
                        { type: 'shell', task: `Run ${mode} ${arch}` },
                        vscode.TaskScope.Workspace, `Run ${mode} ${arch}`, 'XY Qt',
                        makeCmdExec([killApp(exeName), `"${exePath}"`]), []
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

export function stop() {
    const { exeName } = getConfig();
    runTask('Stop', [`taskkill /F /IM ${exeName}.exe`], []);
    setRunning(false);
}
