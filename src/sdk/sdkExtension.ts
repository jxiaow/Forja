/**
 * SDK Module extension entry point.
 * Called by the unified Compilot extension.ts when SDK projects are detected.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { StateManager } from './modules/stateManager';
import { ConfigService } from './modules/configService';
import { ProjectScanner } from './modules/projectScanner';
import { SdkBuilder } from './modules/sdkBuilder';
import { CMD_BUILD, CMD_REBUILD, CMD_CLEAN, CMD_SHOW_ACTIONS, CMD_SELECT_PROJECT, CTX_ACTIVATED, TASK_SOURCE } from './constants';
import { isWindows } from './platform';
import { initLogger, log, logError } from './utils/logger';
import { setSdkState, setActiveModule, onSdkUpdate } from '../ui/unifiedStatusBar';
import { setSdkProjectRoot } from '../core/workspaceResolver';

export async function activateSdk(context: vscode.ExtensionContext): Promise<void> {
    // 0. 初始化日志
    const outputChannel = initLogger();
    context.subscriptions.push(outputChannel);
    log('Compilot SDK 模块开始激活...');
    log(`平台: ${isWindows ? 'Windows' : 'Linux'}`);
    log(`工作区: ${vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ') ?? '无'}`);

    // 1. 初始化基础服务
    const configService = new ConfigService();
    const stateManager = new StateManager();
    const projectScanner = new ProjectScanner();

    // 2. 扫描工作区项目，确定 SDK workspace root
    log('开始扫描工作区项目...');
    const projects = await projectScanner.scan();
    log(`扫描完成，找到 ${projects.length} 个项目:`);
    projects.forEach(p => log(`  - ${p.name} (${p.type}): ${p.path}`));

    const sdkWorkspaceRoot = resolveSdkWorkspaceRoot(projects);
    if (sdkWorkspaceRoot) {
        setSdkProjectRoot(sdkWorkspaceRoot);
        log(`SDK workspace root: ${sdkWorkspaceRoot}`);
    }

    // 3. 无 SDK 项目时，跳过项目初始化
    if (projects.length === 0) {
        log('未找到 SDK 项目');
        stateManager.currentProject = null;
    } else {
        // 4. 从配置恢复状态（在 workspace root 确定之后，确保读取正确的配置文件）
        await stateManager.restoreFromConfig();
        log(`恢复配置: mode=${stateManager.mode}, arch=${stateManager.arch}, project=${stateManager.currentProject?.path ?? 'null'}`);

        // 5. 解析当前项目
        if (stateManager.currentProject) {
            const exists = projects.find(p => p.path === stateManager.currentProject?.path);
            if (!exists) {
                log(`持久化的项目不存在: ${stateManager.currentProject.path}，重新选择...`);
                stateManager.currentProject = null;
                await stateManager.persistToConfig();
                stateManager.currentProject = await projectScanner.resolveCurrentProject(projects);
                if (stateManager.currentProject) {
                    await stateManager.persistToConfig();
                }
            } else {
                log(`已恢复项目: ${stateManager.currentProject.name}`);
            }
        } else {
            log('无持久化项目，尝试自动选择...');
            stateManager.currentProject = await projectScanner.resolveCurrentProject(projects);
            if (stateManager.currentProject) {
                log(`自动选择项目: ${stateManager.currentProject.name}`);
                await stateManager.persistToConfig();
            } else {
                log('未选择任何项目');
            }
        }
    }

    // 5. Windows: 检测 VS 环境
    if (isWindows) {
        log('检测 Visual Studio 环境...');
        const vsPath = await configService.getVsDevCmdPath();
        if (vsPath) {
            log(`VS 环境: ${vsPath}`);
        } else {
            log('未检测到 Visual Studio 环境');
        }
    }

    // 6. 初始化 UI 组件（使用统一状态栏）
    const updateSdkStatusBar = () => {
        const project = stateManager.currentProject;
        setSdkState({
            projectName: project?.name || '',
            mode: stateManager.mode,
            arch: stateManager.arch,
            isBuilding: stateManager.isBuilding
        });
    };
    stateManager.onStateChanged(() => updateSdkStatusBar());
    updateSdkStatusBar();
    // 状态栏切换 SDK mode/arch 时，通过 stateManager 持久化到正确的 workspace 配置
    onSdkUpdate(({ mode, arch }) => {
        stateManager.mode = mode as import('./types').BuildMode;
        stateManager.arch = arch as import('./types').Arch;
        stateManager.persistToConfig();
    });
    // 有 SDK 项目时激活 SDK 模块
    if (stateManager.currentProject) {
        setActiveModule('sdk');
    }
    log('状态栏已初始化（统一模式）');

    // 7. 初始化 Builder
    const sdkBuilder = new SdkBuilder(stateManager, configService);

    // 8. 注册命令
    const selectProjectHandler = async () => {
        log('执行命令: Select Project');
        const projects = projectScanner.projects;
        if (projects.length === 0) {
            vscode.window.showInformationMessage('SDK Pilot: 未找到可用的 SDK 项目');
            return;
        }
        const currentPath = stateManager.currentProject?.path;
        const items = projects.map(p => ({
            label: p.name,
            description: p.path === currentPath ? '（当前）' : p.path,
            project: p
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择 SDK 项目'
        });
        if (selected) {
            stateManager.currentProject = (selected as typeof items[0]).project;
            await stateManager.persistToConfig();
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_BUILD, () => {
            log('执行命令: Build');
            return sdkBuilder.build();
        }),
        vscode.commands.registerCommand(CMD_REBUILD, () => {
            log('执行命令: Rebuild');
            return sdkBuilder.rebuild();
        }),
        vscode.commands.registerCommand(CMD_CLEAN, () => {
            log('执行命令: Clean');
            return sdkBuilder.clean();
        }),
        vscode.commands.registerCommand(CMD_SELECT_PROJECT, selectProjectHandler),
        // 保留旧命令 ID 作为别名，避免用户快捷键绑定失效
        vscode.commands.registerCommand(CMD_SHOW_ACTIONS, selectProjectHandler)
    );
    log('命令已注册: build, rebuild, clean, selectProject, showActions(alias)');

    // 9. 监听 Task 结束事件
    const taskEndListener = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution.task.source === TASK_SOURCE) {
            stateManager.isBuilding = false;
            if (e.exitCode !== undefined && e.exitCode !== 0) {
                logError(`编译失败，退出码: ${e.exitCode}`);
                vscode.window.showWarningMessage(
                    `Compilot SDK: 编译失败，退出码 ${e.exitCode}`
                );
            } else {
                log('编译任务完成，退出码: 0');
            }
        }
    });
    context.subscriptions.push(taskEndListener);

    // 10. 监听配置文件变化（外部编辑或 CLI 写入时重新加载）
    configService.onSettingsFileChanged(context, async () => {
        log('settings.json 变更，重新加载...');
        await stateManager.restoreFromConfig();
        if (isWindows) {
            await configService.getVsDevCmdPath();
        }
    });

    // 11. 设置激活上下文
    await vscode.commands.executeCommand('setContext', CTX_ACTIVATED, true);

    // 12. 注册 Disposables
    context.subscriptions.push(stateManager, configService);

    log('Compilot SDK 模块激活完成!');
}

/**
 * 根据扫描到的 SDK 项目，确定 SDK 项目所在的 workspace folder。
 * 优先选择包含最多 SDK 项目的 folder。
 */
function resolveSdkWorkspaceRoot(projects: import('./types').SdkProjectInfo[]): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return ''; }
    if (projects.length === 0) { return ''; }
    if (folders.length === 1) { return folders[0].uri.fsPath; }

    // 统计每个 folder 包含的 SDK 项目数
    const counts = new Map<string, number>();
    for (const folder of folders) {
        counts.set(folder.uri.fsPath, 0);
    }
    for (const project of projects) {
        // normalize 路径分隔符后再比较，避免 / 和 \ 混用导致匹配失败
        const projNorm = project.path.replace(/\\/g, '/').toLowerCase();
        for (const folder of folders) {
            const folderPath = folder.uri.fsPath;
            const folderNorm = folderPath.replace(/\\/g, '/').toLowerCase();
            if (projNorm.startsWith(folderNorm + '/') ||
                projNorm === folderNorm) {
                counts.set(folderPath, (counts.get(folderPath) || 0) + 1);
                break;
            }
        }
    }

    // 返回包含最多 SDK 项目的 folder
    let best = folders[0].uri.fsPath;
    let bestCount = 0;
    for (const [folderPath, count] of counts) {
        if (count > bestCount) {
            best = folderPath;
            bestCount = count;
        }
    }
    return best;
}
