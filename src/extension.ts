import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setState, loadPersistedState } from './core/qtState';
import { getQtPath, getVsDevShellPath, getWorkspaceRoot, getManualProPath, updateConfig, getJomPath } from './qt/services/configService';
import { createUnifiedStatusBar, setActiveModule, setSdkState } from './ui/unifiedStatusBar';
import { registerPriWatcher } from './qt/project/priWatcher';
import { ConfigNavTreeProvider } from './ui/configPanel/configNavTree';
import { ConfigPageManager } from './ui/configPanel/configPagePanel';
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

import { listProjectConfigs } from './core/settingsIO';
import { listSyncStates } from './core/syncState';

const logger = createLogger('Extension');

/** 启动时后台清理不存在的工作区对应的配置和同步状态 */
function autoCleanupStaleConfigs(): void {
    let removed = 0;
    for (const config of listProjectConfigs()) {
        if (!fs.existsSync(config.workspace)) {
            try { fs.unlinkSync(config.filePath); removed++; } catch { /* ignore */ }
        }
    }
    for (const ss of listSyncStates()) {
        if (!fs.existsSync(ss.workspace)) {
            try { fs.unlinkSync(ss.filePath); removed++; } catch { /* ignore */ }
        }
    }
    if (removed > 0) {
        logger.info(`自动清理了 ${removed} 个残留配置`);
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const channel = initLogger();
    if (channel) { context.subscriptions.push(channel); }
    logger.info('Compilot 扩展激活');

    // 注册 workspace folder 变化监听（多文件夹工作区切换时自动重置缓存）
    registerWorkspaceWatcher(context);

    // 初始化配置存储（必须在其他模块使用配置之前）
    initSettingsStore(context);
    loadPersistedState();

    // 后台清理残留配置（不阻塞启动）
    setTimeout(() => { try { autoCleanupStaleConfigs(); } catch { /* ignore */ } }, 5000);

    createUnifiedStatusBar(context);

    const navTree = new ConfigNavTreeProvider();
    const pageManager = new ConfigPageManager(context);
    const configTreeView = vscode.window.createTreeView(ConfigNavTreeProvider.viewId, { treeDataProvider: navTree });
    configTreeView.title = `配置 v${context.extension.packageJSON.version || ''}`;
    context.subscriptions.push(configTreeView);
    context.subscriptions.push(
        vscode.commands.registerCommand('compilot.config.openPage', (pageId: string) => {
            pageManager.openPage(pageId as 'project' | 'env' | 'sync' | 'advanced');
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('compilot.qt.showSyncTab', () => pageManager.switchTab('remote'))
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
    detectEnv().then(async (env) => {
        setState('envInfo', env);
        logger.info('启动环境检测完成');

        // 自动写入检测结果到配置（如果用户未手动设置过）
        await autoWriteDetectedEnv(env);
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
    registerQtCommands(context, pageManager);

    // 激活 SDK 模块
    await activateSdk(context);

    logger.info('Compilot 扩展激活完成');
}

export function deactivate(): void {
    // 资源清理由 context.subscriptions 自动处理
}

/**
 * 检测到环境后，如果配置中对应字段为空（用户未手动设置），自动写入。
 * 多候选时弹 QuickPick 让用户选择；单候选直接写入。
 */
async function autoWriteDetectedEnv(env: Awaited<ReturnType<typeof detectEnv>>): Promise<void> {
    // Qt 路径
    if (!getQtPath() && env.qtCandidates && env.qtCandidates.length > 0) {
        if (env.qtCandidates.length === 1) {
            updateConfig('qtPath', env.qtCandidates[0].path);
            logger.info(`自动写入 qtPath: ${env.qtCandidates[0].path}`);
        } else {
            const items = env.qtCandidates.map(c => ({
                label: `Qt ${c.version} (${c.compiler})`,
                detail: c.path,
                path: c.path
            }));
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: '检测到多个 Qt 版本，请选择一个作为默认'
            });
            if (picked) {
                updateConfig('qtPath', picked.path);
                logger.info(`用户选择 qtPath: ${picked.path}`);
            }
        }
    }

    // VS 路径
    if (!getVsDevShellPath() && env.vsCandidates && env.vsCandidates.length > 0) {
        const { inferVsInstall } = await import('./core/settingsIO');
        if (env.vsCandidates.length === 1) {
            updateConfig('vsInstall', inferVsInstall(env.vsCandidates[0].devShellPath));
            logger.info(`自动写入 vsInstall: ${env.vsCandidates[0].devShellPath}`);
        } else {
            const items = env.vsCandidates.map(c => ({
                label: `VS ${c.version} ${c.edition}`,
                detail: c.devShellPath,
                devShellPath: c.devShellPath
            }));
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: '检测到多个 Visual Studio 版本，请选择一个作为默认'
            });
            if (picked) {
                updateConfig('vsInstall', inferVsInstall(picked.devShellPath));
                logger.info(`用户选择 vsInstall: ${picked.devShellPath}`);
            }
        }
    }

    // jom 路径
    if (!getJomPath() && env.jom) {
        updateConfig('jomPath', env.jom);
        logger.info(`自动写入 jomPath: ${env.jom}`);
    }
}
