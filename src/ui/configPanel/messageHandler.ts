import * as vscode from 'vscode';
import { detectEnv } from '../../env/envDetector';
import { generateCppProperties, updateCppPropertiesStandard } from '../../build/configGenerator';
import { getState, setState } from '../../core/stateManager';
import { updateConfig, getQtPath, getVsDevShellPath, getQmakeTarget } from '../../core/configService';
import { createLogger } from '../../core/logger';
import { getEffectiveProjectName } from '../../core/projectDisplay';
import { updateProjectSyncField, addServer, removeServer, readServers, ServerConfig } from '../../sync/sftpClient';
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
            const { getWorkspaceRoot: getWsRoot } = require('../../core/configService');
            const ws1 = getWsRoot();
            if (ws1) { updateProjectSyncField(ws1, 'enabled', !!msg.value); }
            break;
        }
        case 'saveSyncSelectedServer': {
            logger.info(`选择服务器: "${msg.value}"`);
            const { getWorkspaceRoot: getWsRoot2 } = require('../../core/configService');
            const ws2 = getWsRoot2();
            if (ws2) { updateProjectSyncField(ws2, 'selectedServer', msg.value || ''); }
            break;
        }
        case 'saveSyncRemotePath': {
            logger.info(`保存远程路径: "${msg.value}"`);
            const { getWorkspaceRoot: getWsRoot3 } = require('../../core/configService');
            const ws3 = getWsRoot3();
            if (ws3) { updateProjectSyncField(ws3, 'remotePath', msg.value || ''); }
            break;
        }
        case 'saveSyncIgnore': {
            logger.info(`保存同步忽略列表: ${JSON.stringify(msg.value)}`);
            const { getWorkspaceRoot: getWsRoot4 } = require('../../core/configService');
            const ws4 = getWsRoot4();
            if (ws4) { updateProjectSyncField(ws4, 'ignore', msg.value || []); }
            break;
        }
        case 'addServer': {
            logger.info(`添加服务器: ${msg.server?.name}`);
            const newServer: ServerConfig = {
                name: msg.server.name || '',
                host: msg.server.host || '',
                port: msg.server.port || 22,
                username: msg.server.username || '',
                authMode: msg.server.authMode || 'key',
                privateKeyPath: msg.server.privateKeyPath || '',
                password: msg.server.password || ''
            };
            if (!newServer.name || !newServer.host || !newServer.username) {
                vscode.window.showWarningMessage('服务器名称、地址和用户名不能为空');
                break;
            }
            const added = addServer(newServer);
            if (!added) {
                vscode.window.showWarningMessage(`服务器 "${newServer.name}" 已存在`);
            }
            updateHtml();
            break;
        }
        case 'removeServer': {
            logger.info(`删除服务器: "${msg.name}"`);
            removeServer(msg.name);
            updateHtml();
            break;
        }
        case 'testSyncConnection': {
            logger.info('测试远程连接');
            await executeTestConnection();
            break;
        }
        case 'viewPassword': {
            logger.info(`查看密码: "${msg.name}"`);
            const servers = readServers();
            const srv = servers.find(s => s.name === msg.name);
            if (srv && srv.password) {
                webview.postMessage({ command: 'showPassword', password: srv.password });
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
