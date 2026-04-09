import * as vscode from 'vscode';
import { getBuildConfig } from '../core/configService';
import { setState } from '../core/stateManager';
import { getMakefileInfo } from '../project/projectManager';
import { build } from './buildManager';

const isWin = process.platform === 'win32';

export async function startDebug(): Promise<void> {
    const cfg = getBuildConfig();
    if (!cfg.projectDir) {
        vscode.window.showErrorMessage('请先选择项目');
        return;
    }

    // 先 Build
    setState('isBuilding', true);
    setState('buildAction', 'debug');
    try {
        const execution = await build();
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (exitCode: number | undefined) => {
                if (settled) { return; }
                settled = true;
                d1.dispose(); d2.dispose();
                if (exitCode === 0) { resolve(); }
                else { reject(new Error(exitCode === undefined ? '任务已终止' : '构建失败')); }
            };
            const d1 = vscode.tasks.onDidEndTaskProcess(e => {
                if (e.execution === execution) { finish(e.exitCode); }
            });
            const d2 = vscode.tasks.onDidEndTask(e => {
                if (e.execution === execution) { finish(undefined); }
            });
        });
    } catch (e: any) {
        vscode.window.showErrorMessage(e.message);
        return;
    } finally {
        setState('isBuilding', false);
        setState('buildAction', null);
    }

    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode, cfg.arch);
    if (!mfInfo) {
        vscode.window.showErrorMessage(`请先运行 QMake (${cfg.mode})`);
        return;
    }

    const config: vscode.DebugConfiguration = {
        name: `Debug ${mfInfo.target}`,
        type: isWin ? 'cppvsdbg' : 'cppdbg',
        request: 'launch',
        program: mfInfo.exePath,
        args: [],
        stopAtEntry: false,
        cwd: cfg.projectDir,
        environment: [],
        console: 'integratedTerminal'
    };

    try {
        await vscode.debug.startDebugging(undefined, config);
    } catch (e) {
        vscode.window.showErrorMessage(`启动调试失败: ${e}`);
    }
}
