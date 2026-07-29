/**
 * SDK Module extension entry point.
 * Called by the Forja extension.ts when SDK projects are detected.
 */
import * as vscode from 'vscode';
import { StateManager } from './modules/stateManager';
import { ConfigService } from './modules/configService';
import { ProjectScanner } from './modules/projectScanner';
import { SdkBuilder } from './modules/sdkBuilder';
import { CTX_ACTIVATED, TASK_SOURCE } from './constants';
import { isWindows } from './platform';
import { initLogger, log, logError } from './utils/logger';
import { setSdkState, activateSdkModuleIfNoQtProject, onSdkUpdate } from '../ui/statusBar';
import { setSdkProjectRoot } from '../vscode/workspaceResolver';
import { onSettingsChange } from '../vscode/settingsStore';

// SDK 模块级实例（激活后初始化）
let sdkBuilder: SdkBuilder | null = null;
let stateManager: StateManager | null = null;
let projectScanner: ProjectScanner | null = null;

// 激活完成信号 — 防止在 activateSdk 完成前调用 buildSdk 等函数
let _sdkReadyResolve: (() => void) | null = null;
const sdkReady = new Promise<void>(resolve => { _sdkReadyResolve = resolve; });

/**
 * SDK 构建操作（供 vscode/commands.ts 调用）
 */
export async function buildSdk(): Promise<void> {
    await sdkReady;
    if (!sdkBuilder) {
        vscode.window.showErrorMessage('SDK 模块未激活');
        return;
    }
    log('执行 SDK Build');
    await sdkBuilder.build();
}

export async function rebuildSdk(): Promise<void> {
    await sdkReady;
    if (!sdkBuilder) {
        vscode.window.showErrorMessage('SDK 模块未激活');
        return;
    }
    log('执行 SDK Rebuild');
    await sdkBuilder.rebuild();
}

export async function cleanSdk(): Promise<void> {
    await sdkReady;
    if (!sdkBuilder) {
        vscode.window.showErrorMessage('SDK 模块未激活');
        return;
    }
    log('执行 SDK Clean');
    await sdkBuilder.clean();
}

export async function selectSdkProject(): Promise<void> {
    await sdkReady;
    if (!projectScanner || !stateManager) {
        vscode.window.showErrorMessage('SDK 模块未激活');
        return;
    }
    log('执行 SDK Select Project');
    const projects = projectScanner.projects;
    if (projects.length === 0) {
        vscode.window.showInformationMessage('Forja SDK: 未找到可用的 SDK 项目');
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
}

export async function activateSdk(context: vscode.ExtensionContext): Promise<void> {
    try {
    // 0. 初始化日志
    const outputChannel = initLogger();
    context.subscriptions.push(outputChannel);
    log('Forja SDK 模块开始激活...');
    log(`平台: ${isWindows ? 'Windows' : 'Linux'}`);
    log(`工作区: ${vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ') ?? '无'}`);

    // 1. 初始化基础服务
    const configService = new ConfigService();
    const sm = new StateManager();
    const ps = new ProjectScanner();

    // 2. 扫描工作区项目，确定 SDK workspace root
    log('开始扫描工作区项目...');
    const projects = await ps.scan();
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
        sm.currentProject = null;
    } else {
        // 4. 从配置恢复状态（在 workspace root 确定之后，确保读取正确的配置文件）
        await sm.restoreFromConfig();
        log(`恢复配置: mode=${sm.mode}, arch=${sm.arch}, project=${sm.currentProject?.path ?? 'null'}`);

        // 5. 解析当前项目
        if (sm.currentProject) {
            const exists = projects.find(p => p.path === sm.currentProject?.path);
            if (!exists) {
                log(`持久化的项目不存在: ${sm.currentProject.path}，重新选择...`);
                sm.currentProject = null;
                await sm.persistToConfig();
                sm.currentProject = await ps.resolveCurrentProject(projects);
                if (sm.currentProject) {
                    await sm.persistToConfig();
                }
            } else {
                log(`已恢复项目: ${sm.currentProject.name}`);
            }
        } else {
            log('无持久化项目，尝试自动选择...');
            sm.currentProject = await ps.resolveCurrentProject(projects);
            if (sm.currentProject) {
                log(`自动选择项目: ${sm.currentProject.name}`);
                await sm.persistToConfig();
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
        const project = sm.currentProject;
        setSdkState({
            projectName: project?.name || '',
            mode: sm.mode,
            arch: sm.arch,
            isBuilding: sm.isBuilding
        });
    };
    sm.onStateChanged(() => updateSdkStatusBar());
    updateSdkStatusBar();
    // 状态栏切换 SDK mode/arch 时，通过 stateManager 持久化到正确的 workspace 配置
    onSdkUpdate(({ mode, arch }) => {
        sm.mode = mode as import('./types').BuildMode;
        sm.arch = arch as import('./types').Arch;
        sm.persistToConfig()
            .catch((e: Error) => logError('状态栏更新后保存 SDK 配置失败', e));
    });
    let sdkSettingsDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(onSettingsChange((section) => {
        if (section !== 'sdk') { return; }
        // 防抖：连续多次 SDK settings 变更只触发一次 VS 检测
        if (sdkSettingsDebounceTimer) { clearTimeout(sdkSettingsDebounceTimer); }
        sdkSettingsDebounceTimer = setTimeout(() => {
            sdkSettingsDebounceTimer = undefined;
            sm.restoreFromConfig()
                .then(async () => {
                    if (isWindows) {
                        await configService.getVsDevCmdPath();
                    }
                    updateSdkStatusBar();
                })
                .catch((e: Error) => logError('settingsStore 变更后重新加载 SDK 配置失败', e));
        }, 300);
    }));
    // 有 SDK 项目时激活 SDK 模块
    if (sm.currentProject) {
        const wsRoot = sdkWorkspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        activateSdkModuleIfNoQtProject(wsRoot);
    }
    log('状态栏已初始化（统一模式）');

    // 7. 初始化 Builder 并赋值给模块级变量
    sdkBuilder = new SdkBuilder(sm, configService);
    stateManager = sm;
    projectScanner = ps;

    // 8. 监听 Task 结束事件
    const taskEndListener = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution.task.source === TASK_SOURCE) {
            sm.isBuilding = false;
            if (e.exitCode !== undefined && e.exitCode !== 0) {
                logError(`编译失败，退出码: ${e.exitCode}`);
                vscode.window.showWarningMessage(
                    `Forja SDK: 编译失败，退出码 ${e.exitCode}`
                );
            } else {
                log('编译任务完成，退出码: 0');
            }
        }
    });
    context.subscriptions.push(taskEndListener);

    // 10. 设置激活上下文
    await vscode.commands.executeCommand('setContext', CTX_ACTIVATED, true);

    // 11. 注册 Disposables
    context.subscriptions.push(sm, configService);

    log('Forja SDK 模块激活完成!');
    } finally {
        _sdkReadyResolve!();
    }
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
