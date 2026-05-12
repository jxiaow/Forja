import * as vscode from 'vscode';
import { getResolvedConfig, readServers, readProjectSyncConfig, syncChangedFiles, testConnection, askPassword, clearPasswordCache, ServerConfig } from './sftpClient';
import { getWorkspaceRoot } from '../core/configService';
import { createLogger } from '../core/logger';

const logger = createLogger('SyncManager');

let _statusItem: vscode.StatusBarItem | null = null;

export function registerSyncWatcher(context: vscode.ExtensionContext): void {
    const wsRoot = getWorkspaceRoot();
    if (wsRoot) {
        // 监听 sync-config.json 和 servers.json 变化来刷新状态栏
        const syncPattern = new vscode.RelativePattern(wsRoot, '.qtpilot/sync-config.json');
        const syncWatcher = vscode.workspace.createFileSystemWatcher(syncPattern);
        syncWatcher.onDidChange(() => _refreshStatusBar());
        syncWatcher.onDidCreate(() => _refreshStatusBar());
        syncWatcher.onDidDelete(() => _refreshStatusBar());
        context.subscriptions.push(syncWatcher);
    }

    // 监听全局 servers.json（位于 ~/.qt-pilot/）
    const os = require('os');
    const path = require('path');
    const globalServersDir = path.join(os.homedir(), '.qt-pilot');
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
        _statusItem = vscode.window.createStatusBarItem('qtPilot.sync', vscode.StatusBarAlignment.Left, 110);
        _statusItem.name = 'Qt Pilot: Sync';
    }

    const resolved = getResolvedConfig(wsRoot);
    if (resolved) {
        _statusItem.text = '$(cloud-upload)';
        _statusItem.tooltip = `Qt Pilot: 同步到 ${resolved.server.name} (${resolved.server.username}@${resolved.server.host})`;
        _statusItem.command = 'qtPilot.syncChangedFiles';
    } else {
        _statusItem.text = '$(cloud-download)';
        _statusItem.tooltip = 'Qt Pilot: 同步未就绪，请选择服务器并设置远程路径';
        _statusItem.command = 'qtPilot.showSyncTab';
    }
    _statusItem.show();
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

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在同步到 ${resolved.server.name}...`,
        cancellable: false
    }, async () => {
        try {
            const result = await syncChangedFiles(resolved, wsRoot);

            if (result.uploaded.length === 0 && result.failed.length === 0 && result.skipped.length === 0) {
                vscode.window.showInformationMessage('没有需要同步的变更文件');
                return;
            }

            if (result.failed.length > 0) {
                const failedList = result.failed.map(f => f.file).join(', ');
                vscode.window.showErrorMessage(`同步完成，${result.uploaded.length} 个成功，${result.failed.length} 个失败: ${failedList}`);
            } else {
                vscode.window.showInformationMessage(`同步完成: ${result.uploaded.length} 个文件已上传${result.skipped.length > 0 ? `，${result.skipped.length} 个已跳过` : ''}`);
            }

            logger.info(`同步结果: 上传=${result.uploaded.length}, 跳过=${result.skipped.length}, 失败=${result.failed.length}`);
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
        server = servers.find(s => s.name === project.selectedServer);
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
