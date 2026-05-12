import * as vscode from 'vscode';
import { getResolvedConfig, getServers, getSyncConfig, syncChangedFiles, testConnection, askPassword, clearPasswordCache, ServerConfig, writeSyncConfigForCli } from './sftpClient';
import { getWorkspaceRoot } from '../core/configService';
import { createLogger } from '../core/logger';

const logger = createLogger('SyncManager');

let _statusItem: vscode.StatusBarItem | null = null;

export function registerSyncWatcher(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('qtPilot.remoteSync')) {
                _refreshStatusBar();
                // 同步配置变更时写入 CLI 可读的文件
                const wsRoot = getWorkspaceRoot();
                if (wsRoot) { writeSyncConfigForCli(wsRoot); }
            }
        })
    );

    _refreshStatusBar();
    // 启动时也写一次
    const wsRoot = getWorkspaceRoot();
    if (wsRoot) { writeSyncConfigForCli(wsRoot); }
}

function _refreshStatusBar(): void {
    if (_statusItem) {
        _statusItem.dispose();
        _statusItem = null;
    }

    const resolved = getResolvedConfig();
    if (!resolved) { return; }

    _statusItem = vscode.window.createStatusBarItem('qtPilot.sync', vscode.StatusBarAlignment.Left, 110);
    _statusItem.name = 'Qt Pilot: Sync';
    _statusItem.text = '$(cloud-upload)';
    _statusItem.tooltip = `Qt Pilot: 同步到 ${resolved.server.name} (${resolved.server.username}@${resolved.server.host})`;
    _statusItem.command = 'qtPilot.syncChangedFiles';
    _statusItem.show();
}

export async function executeSyncChangedFiles(): Promise<void> {
    const resolved = getResolvedConfig();
    if (!resolved) {
        vscode.window.showWarningMessage('请先在配置面板中选择服务器并设置远程路径');
        return;
    }

    const wsRoot = getWorkspaceRoot();
    if (!wsRoot) {
        vscode.window.showWarningMessage('无工作区');
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
    const sync = getSyncConfig();
    const servers = getServers();

    let server: ServerConfig | undefined;
    if (sync.selectedServer) {
        server = servers.find(s => s.name === sync.selectedServer);
    }
    if (!server) {
        if (servers.length === 0) {
            vscode.window.showWarningMessage('请先添加服务器');
            return;
        }
        // 让用户选一个
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
        password = await askPassword(server.host, server.username, server.name);
        if (!password) { return; }
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在测试连接 ${server.name}...`,
        cancellable: false
    }, async () => {
        const ok = await testConnection(server!, password);
        if (ok) {
            vscode.window.showInformationMessage(`连接成功: ${server!.name} (${server!.username}@${server!.host})`);
        } else {
            clearPasswordCache();
            vscode.window.showErrorMessage(`连接失败: ${server!.name} (${server!.username}@${server!.host}:${server!.port})`);
        }
    });
}

export function disposeSyncWatcher(): void {
    if (_statusItem) {
        _statusItem.dispose();
        _statusItem = null;
    }
}
