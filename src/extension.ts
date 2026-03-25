import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as buildManager from './buildManager';
import { createStatusBar, setBuilding, setProject, setRunning, showActions } from './statusBar';
import { registerPriWatcher } from './priWatcher';
import { ConfigPanel } from './configPanel';
import { selectProject } from './projectManager';
import { startDebug } from './debugger';
import { generateCppProperties } from './configGenerator';
import { initLogger, log } from './logger';
import { detectEnv } from './envDetector';

export async function activate(context: vscode.ExtensionContext) {
    const channel = initLogger();
    context.subscriptions.push(channel);
    log('扩展激活');
    createStatusBar(context);

    const panel = new ConfigPanel();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, panel)
    );

    registerPriWatcher(context);

    // 启动时主动检测环境，确保 buildManager 能拿到 Qt 路径
    const cfg0 = vscode.workspace.getConfiguration('xyQt');
    detectEnv(cfg0.get<string>('qtPath', ''), cfg0.get<string>('vsDevShellPath', '')).then(() => {
        log('启动环境检测完成');
    }).catch((e: Error) => log(`启动环境检测失败: ${e.message}`));

    // 自动选择项目
    const project = await selectProject(context);
    setProject(project);

    // 自动生成 c_cpp_properties.json
    if (project) {
        const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
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
        ['xyQt.selectProject', async () => { const p = await selectProject(context, true); setProject(p); panel.refresh(); }],
        ['xyQt.showActions',   () => showActions()],
        ['xyQt.qmake',         () => buildManager.qmake()],
        ['xyQt.build',         () => buildManager.build()],
        ['xyQt.clean',         () => buildManager.clean()],
        ['xyQt.run',           () => buildManager.run().catch(err)],
        ['xyQt.stop',          () => buildManager.stop()],
        ['xyQt.debug',         () => startDebug()],
    ];

    cmds.forEach(([cmd, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
    });
}

export function deactivate() {}
