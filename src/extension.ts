import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as buildManager from './build/buildManager';
import { setState, loadPersistedState } from './core/stateManager';
import { getQtPath, getVsDevShellPath, getWorkspaceRoot, getManualProPath, getDesignerPath } from './core/configService';
import { createStatusBar, showActions } from './ui/statusBar';
import { registerPriWatcher } from './project/priWatcher';
import { ConfigPanel } from './ui/configPanel/index';
import { selectProject, parseProFile } from './project/projectManager';
import { registerDebugSessionWatcher, startDebug } from './build/debugger';
import { generateCppProperties } from './build/configGenerator';
import { createLogger, initLogger } from './core/logger';
import { detectEnv } from './env/envDetector';
import { writeLocalCache, ensureLocalStateDir, LocalCache } from './coreCli/localState';
import { scanProFiles } from './coreCli/projectScanner';
import { registerSyncWatcher, executeSyncChangedFiles, executeTestConnection } from './sync/syncWatcher';
import { initSettingsStore } from './core/settingsStore';

const logger = createLogger('Extension');

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const channel = initLogger();
    context.subscriptions.push(channel);
    logger.info('扩展激活');

    // 初始化配置存储（必须在其他模块使用配置之前）
    initSettingsStore(context);
    loadPersistedState();

    createStatusBar(context);

    const panel = new ConfigPanel(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, panel)
    );

    registerPriWatcher(context);
    registerDebugSessionWatcher(context);
    registerSyncWatcher(context);

    // 全局任务结束监听：兜底重置 isBuilding / isRunning（防止关闭终端后状态卡住）
    context.subscriptions.push(
        vscode.tasks.onDidEndTask(e => {
            const name = e.execution.task.name;
            if (name.startsWith('Build ') || name.startsWith('QMake ') || name.startsWith('Clean ')) {
                setState('isBuilding', false);
                setState('buildAction', null);
            }
            if (name.startsWith('Run ')) {
                setState('isRunning', false);
            }
        })
    );

    // 环境检测（一次）
    detectEnv(getQtPath(), getVsDevShellPath()).then((env) => {
        setState('envInfo', env);
        logger.info('启动环境检测完成');

        // 写入 .qtpilot/cache.json 供 CLI 读取
        const wsRoot = getWorkspaceRoot();
        if (wsRoot) {
            try {
                const qtPath = env.qt?.path || '';
                const cache: LocalCache = {
                    version: 1,
                    updatedAt: new Date().toISOString(),
                    detected: {
                        qt: qtPath ? {
                            path: qtPath,
                            qmake: path.join(qtPath, 'bin', process.platform === 'win32' ? 'qmake.exe' : 'qmake')
                        } : null,
                        vs: env.vs?.devShellPath ? { devShellPath: env.vs.devShellPath } : null,
                        projects: scanProFiles(wsRoot).map(rel => path.join(wsRoot, rel))
                    }
                };
                ensureLocalStateDir(wsRoot);
                writeLocalCache(wsRoot, cache);
                logger.info('cache.json 已更新');
            } catch (e) {
                logger.warn(`写入 cache.json 失败: ${e instanceof Error ? e.message : e}`);
            }
        }
    }).catch((e: Error) => logger.error(`启动环境检测失败: ${e.message}`));

    // 启动时优先恢复手动指定项目，其次再走工作区扫描/记忆选择
    let project = null;
    const manualProPath = getManualProPath();
    if (manualProPath && fs.existsSync(manualProPath)) {
        const info = parseProFile(manualProPath);
        info.projectDir = path.dirname(manualProPath);
        project = info;
        logger.info(`启动恢复手动项目: ${manualProPath}`);
    } else {
        project = await selectProject(context);
    }
    setState('currentProject', project);

    // 自动生成 c_cpp_properties.json
    if (project) {
        const wsRoot = getWorkspaceRoot();
        if (wsRoot) {
            const cppPropsPath = path.join(wsRoot, '.vscode', 'c_cpp_properties.json');
            if (!fs.existsSync(cppPropsPath)) {
                logger.info('c_cpp_properties.json 不存在，自动生成');
                generateCppProperties(project);
            }
        }
    }

    const err = (e: Error) => vscode.window.showErrorMessage(e.message);
    const resolveDesignerExecutable = (): string => {
        const configured = (getDesignerPath() || '').trim();
        if (configured) {
            return configured;
        }
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
            try {
                if (fs.existsSync(p)) {
                    return p;
                }
            } catch {}
        }
        return 'designer';
    };

    const cmds: [string, (...args: any[]) => void][] = [
        ['qtPilot.selectProject', async () => {
            const p = await selectProject(context, true);
            setState('currentProject', p);
            panel.refresh();
        }],
        ['qtPilot.loadManualProject', () => {
            const proPath = getManualProPath();
            if (proPath && fs.existsSync(proPath)) {
                const info = parseProFile(proPath);
                info.projectDir = path.dirname(proPath);
                setState('currentProject', info);
                panel.refresh();
                logger.info(`手动加载项目: ${proPath}`);
            } else {
                vscode.window.showWarningMessage('.pro 文件不存在: ' + proPath);
            }
        }],
        ['qtPilot.showActions',   () => showActions()],
        ['qtPilot.qmake',         () => buildManager.qmake()],
        ['qtPilot.build',         () => buildManager.build()],
        ['qtPilot.clean',         () => buildManager.clean()],
        ['qtPilot.run',           () => buildManager.run().catch(err)],
        ['qtPilot.stop',          () => buildManager.stop()],
        ['qtPilot.debug',         () => startDebug()],
        ['qtPilot.openWithQtDesigner', (uri?: vscode.Uri) => {
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
                vscode.window.showErrorMessage('启动 Qt Designer 失败，请在 Qt Pilot 配置面板设置 Qt Designer 路径');
            });
            proc.unref();
        }],
        ['qtPilot.syncTestConnection', () => executeTestConnection()],
        ['qtPilot.syncChangedFiles', () => executeSyncChangedFiles()]
    ];

    cmds.forEach(([cmd, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
    });
}
