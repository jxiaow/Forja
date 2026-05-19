/**
 * Qt 命令注册 — 从 extension.ts 提取出来，减少入口文件体积。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as buildManager from './build/buildManager';
import { setState } from '../core/stateManager';
import { getWorkspaceRoot, getManualProPath, getDesignerPath, getQtPath } from './services/configService';
import { selectProject, parseProFile } from './project/projectManager';
import { startDebug } from './build/debugger';
import { showActions } from '../ui/statusBar';
import { executeSyncChangedFiles, executeTestConnection } from './sync/syncWatcher';
import { ensureLocalStateDir } from './shared/localState';
import { createLogger } from '../core/logger';
import { ConfigPanel } from '../ui/configPanel/index';

const logger = createLogger('QtCommands');

export function registerQtCommands(context: vscode.ExtensionContext, panel: ConfigPanel): void {
    const resolveDesignerExecutable = (): string => {
        const configured = (getDesignerPath() || '').trim();
        if (configured) { return configured; }
        const qtPath = (getQtPath() || '').trim();
        const candidates: string[] = [];
        if (qtPath) {
            candidates.push(
                path.join(qtPath, 'designer.exe'),
                path.join(qtPath, 'bin', 'designer.exe'),
                path.join(qtPath, 'designer'),
                path.join(qtPath, 'bin', 'designer')
            );
        }
        for (const p of candidates) {
            try { if (fs.existsSync(p)) { return p; } } catch { /* try next */ }
        }
        return 'designer';
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmds: [string, (...args: any[]) => any][] = [
        ['compilot.qt.selectProject', async () => {
            const p = await selectProject(context, true);
            if (p) {
                const wsRoot = getWorkspaceRoot();
                if (wsRoot) { ensureLocalStateDir(wsRoot); }
            }
            setState('currentProject', p);
            panel.refresh();
        }],
        ['compilot.qt.loadManualProject', () => {
            const proPath = getManualProPath();
            if (proPath && fs.existsSync(proPath)) {
                const info = parseProFile(proPath);
                info.projectDir = path.dirname(proPath);
                const wsRoot = getWorkspaceRoot();
                if (wsRoot) { ensureLocalStateDir(wsRoot); }
                setState('currentProject', info);
                panel.refresh();
                logger.info(`手动加载项目: ${proPath}`);
            } else {
                vscode.window.showWarningMessage('.pro 文件不存在: ' + proPath);
            }
        }],
        ['compilot.qt.showActions',   () => showActions()],
        ['compilot.qt.qmake',         () => buildManager.qmake()],
        ['compilot.qt.build',         () => buildManager.build()],
        ['compilot.qt.clean',         () => buildManager.clean()],
        ['compilot.qt.run',           () => buildManager.run().catch((e: Error) => vscode.window.showErrorMessage(e.message))],
        ['compilot.qt.stop',          () => buildManager.stop()],
        ['compilot.qt.debug',         () => startDebug()],
        ['compilot.qt.openWithQtDesigner', (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!target || target.scheme !== 'file') {
                vscode.window.showWarningMessage('请选择一个本地 .ui 文件');
                return;
            }
            const filePath = target.fsPath;
            if (path.extname(filePath).toLowerCase() !== '.ui') {
                vscode.window.showWarningMessage('仅支持 .ui 文件');
                return;
            }
            if (!fs.existsSync(filePath)) {
                vscode.window.showWarningMessage('.ui 文件不存在: ' + filePath);
                return;
            }
            const designerExe = resolveDesignerExecutable();
            const proc = cp.spawn(designerExe, [filePath], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            proc.on('error', () => {
                vscode.window.showErrorMessage('启动 Qt Designer 失败，请在配置面板设置 Qt Designer 路径');
            });
            proc.unref();
        }],
        ['compilot.qt.syncTestConnection', () => executeTestConnection()],
        ['compilot.qt.syncChangedFiles', () => executeSyncChangedFiles()],
        ['compilot.qt.rcc', () => buildManager.rcc()],
        ['compilot.qt.runCustomCommand', (name: string, command: string) => buildManager.runCustomCommand(name, command)]
    ];

    cmds.forEach(([cmd, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
    });
}
