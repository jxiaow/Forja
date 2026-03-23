import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as buildManager from './buildManager';
import { createStatusBar, setBuilding, setProject, setRunning, showActions } from './statusBar';
import { registerPriWatcher } from './priWatcher';
import { ConfigPanel } from './configPanel';
import { selectProject } from './projectManager';
import { detectEnv } from './envDetector';
import { startDebug } from './debugger';
import { generateCppProperties } from './configGenerator';

const LOG_PREFIX = '[XY Qt]';
function log(message: string): void {
    console.log(`${LOG_PREFIX} ${message}`);
}

export async function activate(context: vscode.ExtensionContext) {
    log('扩展激活');
    createStatusBar(context);

    const panel = new ConfigPanel();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, panel)
    );

    registerPriWatcher(context);

    // 检测环境（后台，不阻塞激活）
    const cfg = vscode.workspace.getConfiguration('xyQt');
    detectEnv(cfg.get<string>('qtPath', ''), cfg.get<string>('vsDevShellPath', '')).catch(() => {});

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

    // 构建状态同步
    vscode.tasks.onDidStartTask(e => {
        if (e.execution.task.name.startsWith('Build ')) {
            setBuilding(true);
        }
    });
    vscode.tasks.onDidEndTask(e => {
        if (e.execution.task.name.startsWith('Build ')) {
            setBuilding(false);
        }
    });
    vscode.tasks.onDidEndTaskProcess(e => {
        if (e.execution.task.name.startsWith('Run ')) {
            setRunning(false);
        }
    });

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
