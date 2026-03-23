import * as vscode from 'vscode';
import * as path from 'path';
import { getCurrentProject } from './projectManager';
import { getMode, getArch } from './statusBar';

export async function startDebug(): Promise<void> {
    const project = getCurrentProject();
    if (!project) {
        vscode.window.showErrorMessage('请先选择项目');
        return;
    }

    const mode = getMode();
    const arch = getArch();
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';

    const exePath = path.join(root, project.projectDir, mode, arch, `${project.target}.exe`);
    const cwd = path.join(root, project.projectDir, mode, arch);

    const config: vscode.DebugConfiguration = {
        name: `Debug ${project.target}`,
        type: 'cppvsdbg',
        request: 'launch',
        program: exePath,
        args: [],
        stopAtEntry: false,
        cwd: cwd,
        environment: [],
        console: 'integratedTerminal',
        preLaunchTask: `Build ${mode} ${arch}`
    };

    try {
        await vscode.debug.startDebugging(undefined, config);
    } catch (e) {
        vscode.window.showErrorMessage(`启动调试失败: ${e}`);
    }
}
