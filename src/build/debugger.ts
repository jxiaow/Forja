import * as vscode from 'vscode';
import * as path from 'path';
import { getState } from '../core/stateManager';
import { getBuildConfig } from '../core/configService';
import { getMakefileInfo } from '../project/projectManager';

const isWin = process.platform === 'win32';

export async function startDebug(): Promise<void> {
    const state = getState();
    const project = state.currentProject;
    if (!project) {
        vscode.window.showErrorMessage('请先选择项目');
        return;
    }

    const cfg = getBuildConfig();
    const mfInfo = getMakefileInfo(cfg.projectDir, state.mode);
    if (!mfInfo) {
        vscode.window.showErrorMessage('无法确定可执行文件路径，请先运行 QMake');
        return;
    }

    const exeName = isWin ? `${mfInfo.target}.exe` : mfInfo.target;
    const exePath = mfInfo.destDir
        ? path.join(cfg.projectDir, mfInfo.destDir, exeName)
        : path.join(cfg.projectDir, exeName);
    const cwd = path.dirname(exePath);

    const config: vscode.DebugConfiguration = {
        name: `Debug ${mfInfo.target}`,
        type: 'cppvsdbg',
        request: 'launch',
        program: exePath,
        args: [],
        stopAtEntry: false,
        cwd: cwd,
        environment: [],
        console: 'integratedTerminal',
        preLaunchTask: `Build ${state.mode} ${state.arch}`
    };

    try {
        await vscode.debug.startDebugging(undefined, config);
    } catch (e) {
        vscode.window.showErrorMessage(`启动调试失败: ${e}`);
    }
}
