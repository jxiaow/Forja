/**
 * SDK Module extension entry point.
 * Called by the unified Compilot extension.ts when SDK projects are detected.
 */
import * as vscode from 'vscode';
import { StateManager } from './modules/stateManager';
import { ConfigService } from './modules/configService';
import { ProjectScanner } from './modules/projectScanner';
import { StatusBar } from './modules/statusBar';
import { SdkBuilder } from './modules/sdkBuilder';
import { ShowActions } from './modules/showActions';
import { CMD_BUILD, CMD_REBUILD, CMD_CLEAN, CMD_SHOW_ACTIONS, CTX_ACTIVATED, TASK_SOURCE, CFG_SECTION } from './constants';
import { isWindows } from './platform';
import { initLogger, log, logError } from './utils/logger';

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

    // 2. 从工作区配置恢复状态
    await stateManager.restoreFromConfig();
    log(`恢复配置: mode=${stateManager.mode}, arch=${stateManager.arch}, project=${stateManager.currentProject?.path ?? 'null'}`);

    // 3. 扫描工作区项目
    log('开始扫描工作区项目...');
    const projects = await projectScanner.scan();
    log(`扫描完成，找到 ${projects.length} 个项目:`);
    projects.forEach(p => log(`  - ${p.name} (${p.type}): ${p.path}`));

    // 4. 解析当前项目
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

    // 6. 初始化 UI 组件
    const statusBar = new StatusBar(stateManager);
    statusBar.show();
    log('状态栏已初始化');

    // 7. 初始化 Builder
    const sdkBuilder = new SdkBuilder(stateManager, configService);

    // 8. 注册命令
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
        vscode.commands.registerCommand(CMD_SHOW_ACTIONS, () => {
            const showActions = new ShowActions(stateManager, projectScanner);
            return showActions.show();
        })
    );
    log('命令已注册: build, rebuild, clean, showActions');

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

    // 10. 监听配置变更
    const configListener = configService.onConfigChanged(async (e) => {
        if (e.affectsConfiguration(`${CFG_SECTION}.pinnedProject`)) {
            const config = vscode.workspace.getConfiguration(CFG_SECTION);
            const newPath = config.get<string>('pinnedProject');
            log(`配置变更: pinnedProject = ${newPath || '(空)'}`);
            if (newPath) {
                const project = projectScanner.projects.find(p => p.path === newPath);
                if (project) {
                    stateManager.currentProject = project;
                } else {
                    log(`配置的项目路径不在扫描结果中: ${newPath}`);
                    stateManager.currentProject = null;
                }
            } else {
                stateManager.currentProject = null;
            }
        }

        if (e.affectsConfiguration(`${CFG_SECTION}.mode`)) {
            const config = vscode.workspace.getConfiguration(CFG_SECTION);
            const mode = config.get<string>('mode');
            log(`配置变更: mode = ${mode}`);
            if (mode === 'debug' || mode === 'release') {
                stateManager.mode = mode;
            }
        }

        if (e.affectsConfiguration(`${CFG_SECTION}.arch`)) {
            const config = vscode.workspace.getConfiguration(CFG_SECTION);
            const arch = config.get<string>('arch');
            log(`配置变更: arch = ${arch}`);
            if (arch === 'x86' || arch === 'x64') {
                stateManager.arch = arch;
            }
        }

        if (e.affectsConfiguration(`${CFG_SECTION}.vsDevCmdPath`)) {
            if (isWindows) {
                log('配置变更: vsDevCmdPath，重新检测 VS 环境...');
                await configService.getVsDevCmdPath();
            }
        }
    });
    context.subscriptions.push(configListener);

    // 11. 设置激活上下文
    await vscode.commands.executeCommand('setContext', CTX_ACTIVATED, true);

    // 12. 注册 Disposables
    context.subscriptions.push(statusBar, stateManager, configService);

    log('Compilot SDK 模块激活完成!');
}
