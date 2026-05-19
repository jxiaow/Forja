import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setState, loadPersistedState } from './core/qtState';
import { getQtPath, getVsDevShellPath, getWorkspaceRoot, getManualProPath } from './qt/services/configService';
import { createUnifiedStatusBar, setActiveModule, setSdkState } from './ui/unifiedStatusBar';
import { registerPriWatcher } from './qt/project/priWatcher';
import { ConfigPanel } from './ui/configPanel/index';
import { selectProject, parseProFile } from './qt/project/projectManager';
import { registerDebugSessionWatcher } from './qt/build/debugger';
import { generateCppProperties } from './qt/build/configGenerator';
import { createLogger, initLogger } from './core/logger';
import { detectEnv } from './qt/env/envDetector';
import { ensureLocalStateDir } from './qt/shared/localState';
import { registerSyncWatcher } from './qt/sync/syncWatcher';
import { initSettingsStore } from './core/settingsStore';
import { registerWorkspaceWatcher } from './core/workspaceResolver';
import { activateSdk } from './sdk/sdkExtension';
import { registerQtCommands } from './qt/commands';
import { TASK_SOURCE_QT } from './qt/constants';

const logger = createLogger('Extension');

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const channel = initLogger();
    if (channel) { context.subscriptions.push(channel); }
    logger.info('Compilot 扩展激活');

    // 注册 workspace folder 变化监听（多文件夹工作区切换时自动重置缓存）
    registerWorkspaceWatcher(context);

    // 初始化配置存储（必须在其他模块使用配置之前）
    initSettingsStore(context);
    loadPersistedState();

    createUnifiedStatusBar(context);

    const panel = new ConfigPanel(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, panel)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('compilot.qt.showSyncTab', () => panel.switchTab('remote'))
    );

    registerPriWatcher(context);
    registerDebugSessionWatcher(context);
    registerSyncWatcher(context);

    // 全局任务结束监听：兜底重置 isBuilding / isRunning（防止关闭终端后状态卡住）
    context.subscriptions.push(
        vscode.tasks.onDidEndTask(e => {
            const task = e.execution.task;
            if (task.source !== TASK_SOURCE_QT) { return; }
            const name = task.name;
            if (name.startsWith('Build ') || name.startsWith('QMake ') || name.startsWith('Clean ') || name === 'RCC Compile') {
                setState('isBuilding', false);
                setState('buildAction', null);
            }
            if (name.startsWith('Run ')) {
                setState('isRunning', false);
            }
        })
    );

    // 环境检测（一次，全量扫描获取完整候选列表）
    detectEnv().then((env) => {
        setState('envInfo', env);
        logger.info('启动环境检测完成');
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

    // 有项目时确保 .compilot/ 目录存在
    if (project) {
        const wsRoot = getWorkspaceRoot();
        if (wsRoot) {
            ensureLocalStateDir(wsRoot);
        }
    }

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

    // Qt 命令注册（提取到 qt/commands.ts）
    registerQtCommands(context, panel);

    // 激活 SDK 模块
    await activateSdk(context);

    logger.info('Compilot 扩展激活完成');
}

export function deactivate(): void {
    // 资源清理由 context.subscriptions 自动处理
}
