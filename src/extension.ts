import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as buildManager from './build/buildManager';
import { setState } from './core/stateManager';
import { getQtPath, getVsDevShellPath, getWorkspaceRoot } from './core/configService';
import { createStatusBar, showActions } from './ui/statusBar';
import { registerPriWatcher } from './project/priWatcher';
import { ConfigPanel } from './ui/configPanel/index';
import { selectProject } from './project/projectManager';
import { startDebug } from './build/debugger';
import { generateCppProperties } from './build/configGenerator';
import { initLogger, log } from './core/logger';
import { detectEnv } from './env/envDetector';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const channel = initLogger();
    context.subscriptions.push(channel);
    log('扩展激活');

    createStatusBar(context);

    const panel = new ConfigPanel();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, panel)
    );

    registerPriWatcher(context);

    // 全局任务结束监听：兜底重置 isBuilding / isRunning（防止关闭终端后状态卡住）
    context.subscriptions.push(
        vscode.tasks.onDidEndTask(e => {
            const name = e.execution.task.name;
            if (name.startsWith('Build ') || name.startsWith('QMake ') || name.startsWith('Clean ')) {
                setState('isBuilding', false);
            }
            if (name.startsWith('Run ')) {
                setState('isRunning', false);
            }
        })
    );

    // 环境检测（一次）
    detectEnv(getQtPath(), getVsDevShellPath()).then((env) => {
        setState('envInfo', env);
        log('启动环境检测完成');
    }).catch((e: Error) => log(`启动环境检测失败: ${e.message}`));

    // 自动选择项目
    const project = await selectProject(context);
    setState('currentProject', project);

    // 自动生成 c_cpp_properties.json
    if (project) {
        const root = getWorkspaceRoot();
        if (root) {
            const cppPropsPath = path.join(root, '.vscode', 'c_cpp_properties.json');
            if (!fs.existsSync(cppPropsPath)) {
                log('c_cpp_properties.json 不存在，自动生成');
                generateCppProperties(project);
            }
        }
    }

    const err = (e: Error) => vscode.window.showErrorMessage(e.message);

    const cmds: [string, () => void][] = [
        ['xyQt.selectProject', async () => {
            const p = await selectProject(context, true);
            setState('currentProject', p);
            panel.refresh();
        }],
        ['xyQt.showActions',   () => showActions()],
        ['xyQt.qmake',         () => buildManager.qmake()],
        ['xyQt.build',         () => buildManager.build()],
        ['xyQt.clean',         () => buildManager.clean()],
        ['xyQt.run',           () => buildManager.run().catch(err)],
        ['xyQt.stop',          () => buildManager.stop()],
        ['xyQt.debug',         () => startDebug()]
    ];

    cmds.forEach(([cmd, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
    });
}
