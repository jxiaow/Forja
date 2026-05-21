import * as vscode from 'vscode';
import * as path from 'path';
import { getResolvedConfig, ResolvedSyncConfig } from './resolver';
import { readServers, readProjectSyncConfig, ServerConfig } from '../../core/serverStore';
import { syncChangedFiles, askPassword, clearPasswordCache } from './sftpClient';
import { testConnection } from './transport';
import { getWorkspaceRoot } from '../services/configService';
import { createLogger } from '../../vscode/logger';
import { resolveGitRoots } from '../../core/gitRepoResolver';
import { onSettingsChange } from '../../vscode/settingsStore';

const logger = createLogger('SyncManager');

let _statusItem: vscode.StatusBarItem | null = null;
const _hostKeyWarningShown = new Set<string>();

/** 首次连接时提示用户 StrictHostKeyChecking 状态（已禁用） */
function _warnHostKeyCheckingIfNeeded(_server: ServerConfig): void {
    // 内网场景为主，不再弹出提示
}

export function registerSyncWatcher(context: vscode.ExtensionContext): void {
    context.subscriptions.push(onSettingsChange((section) => {
        if (section === 'sync') {
            _refreshStatusBar();
        }
    }));

    // 监听全局 servers.json（位于 ~/.compilot/）
    const os = require('os') as typeof import('os');
    const globalServersDir = path.join(os.homedir(), '.compilot');
    const globalPattern = new vscode.RelativePattern(vscode.Uri.file(globalServersDir), 'servers.json');
    const globalWatcher = vscode.workspace.createFileSystemWatcher(globalPattern);
    globalWatcher.onDidChange(() => _refreshStatusBar());
    globalWatcher.onDidCreate(() => _refreshStatusBar());
    globalWatcher.onDidDelete(() => _refreshStatusBar());
    context.subscriptions.push(globalWatcher);

    context.subscriptions.push(new vscode.Disposable(() => disposeSyncWatcher()));

    _refreshStatusBar();
}

function _refreshStatusBar(): void {
    const wsRoot = getWorkspaceRoot();
    if (!wsRoot) {
        if (_statusItem) { _statusItem.dispose(); _statusItem = null; }
        return;
    }

    const project = readProjectSyncConfig(wsRoot);

    if (!project.enabled) {
        if (_statusItem) { _statusItem.dispose(); _statusItem = null; }
        return;
    }

    if (!_statusItem) {
        _statusItem = vscode.window.createStatusBarItem('compilot.sync', vscode.StatusBarAlignment.Left, 95);
        _statusItem.name = 'Compilot: Sync';
    }

    const resolved = getResolvedConfig(wsRoot);
    if (resolved) {
        _statusItem.text = '$(cloud-upload)';
        _statusItem.tooltip = `Compilot: 同步到 ${resolved.server.name} (${resolved.server.username}@${resolved.server.host})`;
        _statusItem.command = 'compilot.qt.syncChangedFiles';
    } else {
        _statusItem.text = '$(cloud)';
        _statusItem.tooltip = 'Compilot: 同步未就绪，点击配置远程服务器';
        _statusItem.command = 'compilot.qt.showSyncTab';
    }
    _statusItem.show();
}

/** 供外部调用刷新同步状态栏图标（如配置面板切换开关后） */
export function refreshSyncStatusBar(): void {
    _refreshStatusBar();
}

export async function executeSyncChangedFiles(): Promise<void> {
    const wsRoot = getWorkspaceRoot();
    if (!wsRoot) {
        vscode.window.showWarningMessage('无工作区');
        return;
    }

    const resolved = getResolvedConfig(wsRoot);
    if (!resolved) {
        vscode.window.showWarningMessage('请先在配置面板中选择服务器并设置远程路径');
        return;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('无工作区文件夹');
        return;
    }

    // 收集所有 git 仓库
    const allGitRoots: { dir: string; name: string }[] = [];
    for (const folder of folders) {
        const gitRoots = resolveGitRoots(folder.uri.fsPath);
        allGitRoots.push(...gitRoots);
    }

    if (allGitRoots.length === 0) {
        vscode.window.showWarningMessage('未找到 git 仓库');
        return;
    }

    // 多个仓库时让用户选择
    let selectedRoots = allGitRoots;
    if (allGitRoots.length > 1) {
        const ALL_LABEL = '$(sync) 全部同步';
        const items = [
            { label: ALL_LABEL, description: `${allGitRoots.length} 个仓库`, _all: true },
            ...allGitRoots.map(r => ({ label: r.name, description: r.dir, _all: false }))
        ];
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: '选择要同步的仓库',
            canPickMany: false
        });
        if (!picked) { return; }
        if (!picked._all) {
            selectedRoots = allGitRoots.filter(r => r.name === picked.label && r.dir === picked.description);
        }
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在同步到 ${resolved.server.name}...`,
        cancellable: true
    }, async (_progress, token) => {
        _warnHostKeyCheckingIfNeeded(resolved.server);
        try {
            let totalUploaded = 0;
            let totalSkipped = 0;
            const totalFailed: { file: string; error: string }[] = [];

            for (const { dir: gitDir, name: gitName } of selectedRoots) {
                if (token.isCancellationRequested) { break; }
                const repoResolved: ResolvedSyncConfig = {
                    ...resolved,
                    remotePath: resolved.remotePath.replace(/\/$/, '') + '/' + gitName
                };
                const result = await syncChangedFiles(repoResolved, gitDir, token);
                totalUploaded += result.uploaded.length;
                totalSkipped += result.skipped.length;
                totalFailed.push(...result.failed.map(f => ({ file: `${gitName}/${f.file}`, error: f.error })));
            }

            if (totalUploaded === 0 && totalFailed.length === 0 && totalSkipped === 0) {
                vscode.window.showInformationMessage('没有需要同步的变更文件');
                return;
            }

            if (totalFailed.length > 0) {
                const failedList = totalFailed.map(f => f.file).join(', ');
                vscode.window.showErrorMessage(`同步完成，${totalUploaded} 个成功，${totalFailed.length} 个失败: ${failedList}`);
            } else {
                vscode.window.showInformationMessage(`同步完成: ${totalUploaded} 个文件已上传${totalSkipped > 0 ? `，${totalSkipped} 个已跳过` : ''}`);
            }

            logger.info(`同步结果: 上传=${totalUploaded}, 跳过=${totalSkipped}, 失败=${totalFailed.length}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(`同步失败: ${msg}`);
            logger.error(`同步失败: ${msg}`);
        }
    });
}

export async function executeTestConnection(): Promise<void> {
    const wsRoot = getWorkspaceRoot();
    const project = wsRoot ? readProjectSyncConfig(wsRoot) : null;
    const servers = readServers();

    let server: ServerConfig | undefined;
    if (project?.selectedServer) {
        server = servers.find(s => s.id === project.selectedServer) || servers.find(s => s.name === project.selectedServer);
    }
    if (!server) {
        if (servers.length === 0) {
            vscode.window.showWarningMessage('请先添加服务器');
            return;
        }
        const pick = await vscode.window.showQuickPick(
            servers.map(s => ({ label: s.name, description: `${s.username}@${s.host}:${s.port}` })),
            { placeHolder: '选择要测试的服务器' }
        );
        if (!pick) { return; }
        server = servers.find(s => s.name === pick.label);
        if (!server) { return; }
    }

    let password: string | null = null;
    if (server.authMode === 'password') {
        password = await askPassword(server);
        if (!password) { return; }
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在测试连接 ${server.name}...`,
        cancellable: false
    }, async () => {
        _warnHostKeyCheckingIfNeeded(server!);
        const result = await testConnection(server!, password);
        if (result.ok) {
            logger.info(`连接成功: ${server!.name} (${server!.username}@${server!.host})`);
            vscode.window.showInformationMessage(`连接成功: ${server!.name} (${server!.username}@${server!.host})`);
        } else {
            clearPasswordCache();
            logger.error(`连接失败: ${server!.name} (${server!.username}@${server!.host}:${server!.port}) - ${result.error}`);
            vscode.window.showErrorMessage(`连接失败: ${server!.name} — ${result.error || '未知错误'}`);
        }
    });
}

export function disposeSyncWatcher(): void {
    if (_statusItem) {
        _statusItem.dispose();
        _statusItem = null;
    }
}
