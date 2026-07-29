import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setState, loadPersistedState } from './vscode/qtState';
import { getWorkspaceRoot, getManualProPath } from './qt/services/configService';
import { createStatusBar } from './ui/statusBar';
import { registerPriWatcher } from './qt/project/priWatcher';
import { ConfigNavTreeProvider } from './ui/configPanel/configNavTree';
import { selectProject, parseProFile } from './qt/project/projectManager';
import { registerDebugSessionWatcher } from './qt/build/debugger';
import { generateCppProperties } from './qt/build/configGenerator';
import { createLogger, initLogger } from './vscode/logger';
import { detectEnv } from './qt/env/envDetector';
import { ensureLocalStateDir } from './qt/shared/localState';
import { registerSyncWatcher } from './vscode/syncWatcher';
import { registerCommands } from './vscode/commands';
import { initSettingsStore } from './vscode/settingsStore';
import { registerWorkspaceWatcher } from './vscode/workspaceResolver';
import { ConfigPageManager } from './ui/configPanel/configPagePanel';
import { activateCpp } from './cpp/cppExtension';
import { TASK_SOURCE_QT } from './qt/constants';
import { resolveWorkroot } from './core/workspaceStore';

import { listProjectConfigs } from './core/settingsIO';
import { listSyncStates } from './core/syncState';

const logger = createLogger('Extension');

/** 启动时后台检测不存在的工作区对应的配置和同步状态（只记录日志，不自动删除） */
function auditStaleConfigs(): void {
    const stale: string[] = [];
    for (const config of listProjectConfigs()) {
        if (!fs.existsSync(config.workspace)) {
            stale.push(config.workspace);
        }
    }
    for (const ss of listSyncStates()) {
        if (!fs.existsSync(ss.workspace)) {
            stale.push(ss.workspace);
        }
    }
    if (stale.length > 0) {
        logger.info(`检测到 ${stale.length} 个工作区不可访问的配置（未自动删除）: ${stale.join(', ')}`);
    }
}

/** 检查当前 workspace folders 是否有匹配的 workroot，未注册时提示用户 */
function checkWorkrootRegistration(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }

    let hasMatch = false;
    try {
        hasMatch = folders.some(f => resolveWorkroot(f.uri.fsPath) !== null);
    } catch {
        // workspaces.json 损坏 — 跳过检查，用户会在命令执行时看到错误
        return;
    }
    if (hasMatch) { return; }

    const action = '运行 forja init';
    vscode.window.showInformationMessage(
        '当前工作区尚未初始化 Forja 配置。运行 forja init 以注册工作区并配置构建目标。',
        action
    ).then(selected => {
        if (selected === action) {
            vscode.commands.executeCommand('forja.init');
        }
    });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const channel = initLogger();
    if (channel) { context.subscriptions.push(channel); }
    logger.info('Forja 扩展激活');

    // 注册 workspace folder 变化监听（多文件夹工作区切换时自动重置缓存）
    registerWorkspaceWatcher(context);

    // 初始化配置存储（必须在其他模块使用配置之前）
    initSettingsStore(context);
    loadPersistedState();

    // 检查 workroot 是否已注册，未注册时提示用户初始化
    checkWorkrootRegistration();

    // 后台检测残留配置（不阻塞启动，不自动删除）
    setTimeout(() => { try { auditStaleConfigs(); } catch { /* ignore */ } }, 5000);

    createStatusBar(context);

    const navTree = new ConfigNavTreeProvider();
    const configTreeView = vscode.window.createTreeView(ConfigNavTreeProvider.viewId, { treeDataProvider: navTree });
    configTreeView.title = `配置 v${context.extension.packageJSON.version || ''}`;
    context.subscriptions.push(configTreeView);

    // 配置面板管理器
    const pageManager = new ConfigPageManager(context);
    pageManager.setNavTree(navTree);
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.config.openPage', (pageId?: string) => {
            const { normalizeConfigPageId } = require('./ui/configPanel/pageIds');
            const id = normalizeConfigPageId(pageId || 'project');
            pageManager.openPage(id);
        })
    );

    registerPriWatcher(context);
    registerDebugSessionWatcher(context);
    registerSyncWatcher(context);
    registerCommands(context);

    // Qt 任务结束监听：重置 isBuilding / isRunning（防止状态卡住）
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

    // 启动时优先恢复手动指定项目，其次再走工作区扫描/记忆选择
    // 必须在 C++ 激活之前完成，否则 C++ 扫描完成时 qtState.currentProject 还没设置，
    // 会导致混合 workspace 中状态栏错误切到 C++ 模块
    let project: import('./core/types').ProjectInfo | null = null;
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

    // C++ 模块激活（异步，不阻塞 Qt 启动；在 Qt 项目恢复之后，避免竞态）
    activateCpp(context).catch((e: Error) => logger.error(`C++ 模块激活失败: ${e.message}`));

    // 环境检测（一次，全量扫描获取完整候选列表）
    detectEnv().then(async (env) => {
        setState('envInfo', env);
        logger.info('启动环境检测完成');

        // 启动时不弹工具链选择，等用户选了项目后再按项目类型提示
    }).catch((e: Error) => logger.error(`启动环境检测失败: ${e.message}`));

    // 有项目时确保 .forja/ 目录存在
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

    logger.info('Forja 扩展激活完成');
}

export function deactivate(): void {
    // 资源清理由 context.subscriptions 自动处理
}
