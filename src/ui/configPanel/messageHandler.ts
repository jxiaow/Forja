import * as vscode from 'vscode';
import { detectEnv } from '../../env/envDetector';
import { generateCppProperties, updateCppPropertiesStandard } from '../../build/configGenerator';
import { getState, setState } from '../../core/stateManager';
import { updateConfig, getQtPath, getVsDevShellPath, getQmakeTarget, getWorkspaceRoot } from '../../core/configService';
import { createLogger } from '../../core/logger';
import { getEffectiveProjectName } from '../../project/projectDisplay';
import { updateProjectSyncField, addServer, removeServer, updateServer, readServers, ServerConfig } from '../../sync/sftpClient';
import { executeSyncChangedFiles, executeTestConnection } from '../../sync/syncWatcher';

const logger = createLogger('ConfigPanel');

export async function handleMessage(
    msg: any,
    webview: vscode.Webview,
    pushEnvUpdate: () => void,
    updateHtml: () => void
): Promise<void> {
    logger.info(`收到消息: ${msg.command}`);

    switch (msg.command) {
        case 'refreshEnv': {
            const env = await detectEnv(getQtPath(), getVsDevShellPath());
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'selectProject': {
            await vscode.commands.executeCommand('qtPilot.selectProject');
            updateHtml();
            break;
        }
        case 'saveVsPath': {
            logger.info(`保存 VS 路径: "${msg.value}"`);
            await updateConfig('vsDevShellPath', msg.value || '');
            webview.postMessage({ command: 'envDetecting' });
            const qtPath = getQtPath();
            const env = await detectEnv(qtPath, msg.value || '');
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'saveQtPath': {
            logger.info(`保存 Qt 路径: "${msg.value}"`);
            await updateConfig('qtPath', msg.value || '');
            webview.postMessage({ command: 'envDetecting' });
            const vsPath = getVsDevShellPath();
            const env = await detectEnv(msg.value || '', vsPath);
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'saveDesignerPath': {
            logger.info(`保存 Designer 路径: "${msg.value}"`);
            await updateConfig('designerPath', msg.value || '');
            break;
        }
        case 'saveQtSourcePath': {
            logger.info(`保存 Qt 源码路径: "${msg.value}"`);
            await updateConfig('qtSourcePath', msg.value || '');
            break;
        }
        case 'saveStandard': {
            logger.info(`保存标准: C=${msg.cStandard}, C++=${msg.cppStandard}`);
            if (msg.cStandard) { await updateConfig('cStandard', msg.cStandard); }
            if (msg.cppStandard) { await updateConfig('cppStandard', msg.cppStandard); }
            updateCppPropertiesStandard(msg.cStandard || 'c11', msg.cppStandard || 'c++11');
            break;
        }
        case 'browse': {
            logger.info(`浏览: targetId=${msg.targetId}, isDir=${msg.isDir}`);
            if (msg.targetId === 'manualProPath') {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters: { 'Qt Project': ['pro'] } });
                if (uris?.[0]) {
                    logger.info(`选择 .pro: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            } else if (msg.isDir) {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
                if (uris?.[0]) {
                    logger.info(`选择目录: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            } else {
                const filters: { [name: string]: string[] } = msg.targetId === 'designerPath'
                    ? { 'Qt Designer': ['exe'] }
                    : { 'PowerShell': ['ps1'] };
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters });
                if (uris?.[0]) {
                    logger.info(`选择文件: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            }
            break;
        }
        case 'saveExcludeDirs': {
            logger.info(`保存排除目录: ${JSON.stringify(msg.dirs)}`);
            await updateConfig('scanExcludeDirs', msg.dirs);
            break;
        }
        case 'saveQmakeTarget': {
            logger.info(`保存 QMake TARGET: "${msg.value}"`);
            await updateConfig('qmakeTarget', msg.value || '');
            break;
        }
        case 'saveManualProPath': {
            logger.info(`手动指定 .pro: "${msg.value}"`);
            await updateConfig('manualProPath', msg.value || '');
            if (msg.value) {
                await vscode.commands.executeCommand('qtPilot.loadManualProject');
            }
            updateHtml();
            break;
        }
        case 'saveFileSyncPromptEnabled': {
            logger.info(`保存新增/删除文件提醒开关: ${!!msg.value}`);
            await updateConfig('fileSyncPromptEnabled', !!msg.value);
            break;
        }
        case 'saveQmakeReminderEnabled': {
            logger.info(`保存 QMake 提醒开关: ${!!msg.value}`);
            await updateConfig('qmakeReminderEnabled', !!msg.value);
            break;
        }
        case 'generateIntelliSense': {
            logger.info(`生成 IntelliSense: C=${msg.cStandard}, C++=${msg.cppStandard}`);
            if (msg.cStandard) { await updateConfig('cStandard', msg.cStandard); }
            if (msg.cppStandard) { await updateConfig('cppStandard', msg.cppStandard); }
            const project = getState().currentProject;
            if (project) {
                logger.info(`项目: ${getEffectiveProjectName(project, getQmakeTarget(), project.proFile)}`);
                generateCppProperties(project);
            } else {
                logger.warn('无项目，无法生成 IntelliSense');
                vscode.window.showWarningMessage('请先选择项目');
            }
            break;
        }
        case 'saveSyncEnabled': {
            logger.info(`保存远程同步开关: ${!!msg.value}`);
            const ws1 = getWorkspaceRoot();
            if (ws1) { updateProjectSyncField(ws1, 'enabled', !!msg.value); }
            break;
        }
        case 'saveSyncSelectedServer': {
            logger.info(`选择服务器: "${msg.value}"`);
            const ws2 = getWorkspaceRoot();
            if (ws2) { updateProjectSyncField(ws2, 'selectedServer', msg.value || ''); }
            break;
        }
        case 'saveSyncRemotePath': {
            logger.info(`保存远程路径: "${msg.value}"`);
            const ws3 = getWorkspaceRoot();
            if (ws3) { updateProjectSyncField(ws3, 'remotePath', msg.value || ''); }
            break;
        }
        case 'saveSyncIgnore': {
            logger.info(`保存同步忽略列表: ${JSON.stringify(msg.value)}`);
            const ws4 = getWorkspaceRoot();
            if (ws4) { updateProjectSyncField(ws4, 'ignore', msg.value || []); }
            break;
        }
        case 'addServer': {
            logger.info(`添加服务器: ${msg.server?.name}`);
            const newServerData = {
                name: msg.server.name || '',
                host: msg.server.host || '',
                port: msg.server.port || 22,
                username: msg.server.username || '',
                authMode: (msg.server.authMode || 'key') as 'key' | 'password',
                privateKeyPath: msg.server.privateKeyPath || '',
                password: msg.server.password || ''
            };
            if (!newServerData.name || !newServerData.host || !newServerData.username) {
                vscode.window.showWarningMessage('服务器名称、地址和用户名不能为空');
                break;
            }
            const created = addServer(newServerData);
            _pushServerList(webview, created.id);
            break;
        }
        case 'removeServer': {
            logger.info(`删除服务器: "${msg.id}"`);
            removeServer(msg.id);
            _pushServerList(webview);
            break;
        }
        case 'updateServer': {
            logger.info(`修改服务器: id=${msg.server?.id}, name=${msg.server?.name}`);
            const serverId: string = msg.server.id || '';
            const updates = {
                name: msg.server.name || '',
                host: msg.server.host || '',
                port: msg.server.port || 22,
                username: msg.server.username || '',
                authMode: (msg.server.authMode || 'key') as 'key' | 'password',
                privateKeyPath: msg.server.privateKeyPath || '',
                password: msg.server.password || ''
            };
            if (!updates.name || !updates.host || !updates.username) {
                vscode.window.showWarningMessage('服务器名称、地址和用户名不能为空');
                break;
            }
            // 如果密码为空，保留原密码
            if (!updates.password) {
                const existing = readServers().find(s => s.id === serverId);
                if (existing) { updates.password = existing.password; }
            }
            const updated = updateServer(serverId, updates);
            if (!updated) {
                vscode.window.showWarningMessage('服务器不存在');
                break;
            }
            vscode.window.showInformationMessage(`服务器 "${updates.name}" 已更新`);
            _pushServerList(webview, serverId);
            break;
        }
        case 'testSyncConnection': {
            logger.info('测试远程连接');
            await executeTestConnection();
            break;
        }
        case 'viewPassword': {
            logger.info(`查看密码: "${msg.id}"`);
            const servers = readServers();
            const srv = servers.find(s => s.id === msg.id);
            if (srv && srv.password) {
                // 通过 VSCode 原生输入框显示（不发送到 webview）
                const action = await vscode.window.showInformationMessage(
                    `${srv.name} 的密码已复制到剪贴板`,
                    '复制'
                );
                if (action === '复制') {
                    await vscode.env.clipboard.writeText(srv.password);
                }
            } else {
                vscode.window.showInformationMessage('该服务器未保存密码（可能使用密钥认证）');
            }
            break;
        }
        case 'syncChangedFiles': {
            logger.info('面板触发同步变更文件');
            await executeSyncChangedFiles();
            break;
        }
    }
}

function _pushServerList(webview: vscode.Webview, selectId?: string): void {
    const servers = readServers();
    webview.postMessage({
        command: 'serversUpdated',
        servers: servers.map(s => ({
            id: s.id,
            name: s.name,
            host: s.host,
            port: s.port,
            username: s.username,
            authMode: s.authMode,
            privateKeyPath: s.privateKeyPath
        })),
        select: selectId || ''
    });
}
