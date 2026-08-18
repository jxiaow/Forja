import * as vscode from 'vscode';
import { detectEnv } from '../../qt/env/envDetector';
import { generateCppProperties, generateCppPropertiesFromSln, updateCppPropertiesStandard } from '../../qt/build/configGenerator';
import { getState, setState } from '../../vscode/qtState';
import { updateConfig, getTarget, getWorkspaceRoot, getQtPath, getVsDevShellPath } from '../../qt/services/configService';
import { createLogger } from '../../vscode/logger';
import { getEffectiveProjectName } from '../../qt/project/projectDisplay';
import { updateProjectSyncField, addServer, removeServer, updateServer, readServers, updateRemoteSelectedServer, updateRemotePath } from '../../core/serverStore';
import { loadRemoteSettings, saveRemoteSettings, loadSyncSettings, saveSyncSettings } from '../../core/settingsIO';
import { executeTestConnection, refreshSyncStatusBar } from '../../vscode/syncWatcher';
import { inferVsInstall } from '../../core/settingsIO';
import { setCppSetting } from '../../vscode/settingsStore';
import { getDefaultArch, isWindows } from '../../cpp/platform';

const logger = createLogger('ConfigPanel');

/** Webview 面板消息类型 */
interface PanelMessage {
    command: string;
    value?: unknown;
    targetId?: string;
    isDir?: boolean;
    dirs?: string[];
    cStandard?: string;
    cppStandard?: string;
    id?: string;
    remotePath?: string;
    server?: {
        id?: string;
        name?: string;
        host?: string;
        port?: number;
        username?: string;
        authMode?: string;
        privateKeyPath?: string;
        password?: string;
    };
}

export async function handleMessage(
    msg: PanelMessage,
    webview: vscode.Webview,
    pushEnvUpdate: () => void,
    updateHtml: () => void
): Promise<void> {
    logger.info(`收到消息: ${msg.command}`);

    switch (msg.command) {
        case 'saveMode': {
            const modeVal = String(msg.value || '');
            if (modeVal !== '' && modeVal !== 'debug' && modeVal !== 'release') {
                logger.warn(`无效的构建模式值: "${modeVal}"`);
                break;
            }
            logger.info(`保存构建模式: "${modeVal}"`);
            await updateConfig('mode', modeVal as '' | 'debug' | 'release');
            // Sync to activeTarget so CLI build/run use the updated value
            const ws = getWorkspaceRoot();
            if (ws) {
                const { getActiveTarget, setActiveTarget } = await import('../../cli/commands/activeTarget');
                const target = getActiveTarget(ws);
                if (target && target.kind === 'qt') {
                    setActiveTarget(ws, { ...target, mode: modeVal as 'debug' | 'release' });
                }
            }
            break;
        }
        case 'saveArch': {
            const archVal = String(msg.value || '');
            if (archVal !== '' && archVal !== 'x86' && archVal !== 'x64') {
                logger.warn(`无效的目标架构值: "${archVal}"`);
                break;
            }
            logger.info(`保存目标架构: "${archVal}"`);
            await updateConfig('arch', archVal as '' | 'x86' | 'x64');
            // Sync to activeTarget so CLI build/run use the updated value
            const wsArch = getWorkspaceRoot();
            if (wsArch) {
                const { getActiveTarget: gat, setActiveTarget: sat } = await import('../../cli/commands/activeTarget');
                const at = gat(wsArch);
                if (at && at.kind === 'qt') {
                    sat(wsArch, { ...at, arch: archVal as 'x86' | 'x64' });
                }
            }
            break;
        }
        case 'refreshEnv': {
            logger.info('开始检测环境...');
            const env = await detectEnv(getQtPath() || undefined, getVsDevShellPath() || undefined);
            logger.info('环境检测完成');
            setState('envInfo', env);
            updateHtml();
            pushEnvUpdate();
            break;
        }
        case 'selectProject': {
            // 使用统一项目选择器（分组显示）
            const { showUnifiedProjectPicker } = await import('../statusBar');
            await showUnifiedProjectPicker();
            break;
        }
        case 'saveVsPath': {
            logger.info(`保存 VS 路径: "${msg.value}"`);
            await updateConfig('vsInstall', inferVsInstall(String(msg.value || '')));
            const env = await detectEnv(getQtPath() || undefined, getVsDevShellPath() || undefined);
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'saveQtPath': {
            logger.info(`保存 Qt 路径: "${msg.value}"`);
            await updateConfig('qtPath', String(msg.value || ''));
            const env2 = await detectEnv(getQtPath() || undefined, getVsDevShellPath() || undefined);
            setState('envInfo', env2);
            pushEnvUpdate();
            break;
        }
        case 'saveDesignerPath': {
            logger.info(`保存 Designer 路径: "${msg.value}"`);
            await updateConfig('designerPath', String(msg.value || ''));
            break;
        }
        case 'saveQtSourcePath': {
            logger.info(`保存 Qt 源码路径: "${msg.value}"`);
            await updateConfig('qtSourcePath', String(msg.value || ''));
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
            await updateConfig('scanExcludeDirs', msg.dirs || []);
            break;
        }
        case 'saveQmakeTarget': {
            logger.info(`保存 QMake TARGET: "${msg.value}"`);
            await updateConfig('target', String(msg.value || ''));
            break;
        }
        case 'saveQmakeArgs': {
            logger.info(`保存 QMake 自定义参数: "${msg.value}"`);
            await updateConfig('qmakeArgs', String(msg.value || '').trim());
            break;
        }
        case 'saveManualProPath': {
            logger.info(`手动指定 .pro: "${msg.value}"`);
            if (msg.value) {
                const { runUseTarget } = await import('../../cli/commands/use');
                const { getWorkspaceRoot } = await import('../../qt/services/configService');
                const { applyManualProjectSelection } = await import('../../qt/project/projectManager');
                const workspace = getWorkspaceRoot() || '';
                const result = await runUseTarget(workspace, { project: String(msg.value), interactive: true });
                if (!result.ok) {
                    const errorMsg = result.diagnostics?.[0]?.message || '项目选择失败';
                    vscode.window.showErrorMessage(errorMsg);
                    break;
                }
                // 同步更新 currentProject 内存状态（状态栏依赖此值）
                applyManualProjectSelection(workspace, String(msg.value));
            } else {
                setState('currentProject', null);
                // Also clear activeTarget in workspaceStore so CLI doesn't build old target
                const { getWorkspaceRoot: gwr } = await import('../../qt/services/configService');
                const ws = gwr();
                if (ws) {
                    const { resolveWorkroot, loadWorkspaceConfig, saveWorkspaceConfig } = await import('../../core/workspaceStore');
                    const workroot = resolveWorkroot(ws);
                    if (workroot) {
                        const config = loadWorkspaceConfig(workroot);
                        config.activeTarget = null;
                        try { saveWorkspaceConfig(config); } catch (e) {
                            logger.error(`Failed to clear activeTarget: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                }
            }
            await updateConfig('manualProPath', String(msg.value || ''));
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
        case 'saveRccProjectPath': {
            logger.info(`保存 RCC 项目路径: "${msg.value}"`);
            await updateConfig('rccProjectPath', String(msg.value || ''));
            break;
        }
        case 'generateIntelliSense': {
            logger.info(`生成 IntelliSense: C=${msg.cStandard}, C++=${msg.cppStandard}`);
            if (msg.cStandard) { await updateConfig('cStandard', msg.cStandard); }
            if (msg.cppStandard) { await updateConfig('cppStandard', msg.cppStandard); }

            // 判断当前活跃的项目类型
            const { getActiveTarget } = await import('../../cli/commands/activeTarget');
            const { resolveProjectRoot } = await import('../../vscode/workspaceResolver');
            const cppWs = resolveProjectRoot('cpp') || '';
            const qtWs = resolveProjectRoot('qt') || getWorkspaceRoot() || '';
            const activeTarget = getActiveTarget(cppWs) || getActiveTarget(qtWs) || getActiveTarget(getWorkspaceRoot() || '');

            if (activeTarget?.kind === 'cpp') {
                // C++ 项目：从 .sln 解析 .vcxproj 生成
                const slnAbsPath = require('path').isAbsolute(activeTarget.project)
                    ? activeTarget.project
                    : require('path').join(cppWs, activeTarget.project);
                const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || cppWs;
                generateCppPropertiesFromSln(slnAbsPath, wsRoot);
            } else {
                // Qt 项目：从 .pro / Makefile 生成
                const project = getState().currentProject;
                if (project) {
                    logger.info(`项目: ${getEffectiveProjectName(project, getTarget(), project.proFile)}`);
                    generateCppProperties(project);
                } else {
                    logger.warn('无项目，无法生成 IntelliSense');
                    vscode.window.showWarningMessage('请先选择项目');
                }
            }
            break;
        }
        case 'saveSyncEnabled': {
            logger.info(`保存远程同步开关: ${!!msg.value}`);
            const ws1 = getWorkspaceRoot();
            if (ws1) { updateProjectSyncField(ws1, 'enabled', !!msg.value); }
            refreshSyncStatusBar();
            break;
        }
        case 'saveSyncSelectedServer': {
            logger.info(`选择服务器: "${msg.value}"`);
            const ws2 = getWorkspaceRoot();
            if (ws2) {
                updateRemoteSelectedServer(ws2, String(msg.value || ''));
                // 选中服务器时自动启用同步
                if (msg.value) { updateProjectSyncField(ws2, 'enabled', true); }
            }
            refreshSyncStatusBar();
            updateHtml();
            break;
        }
        case 'saveSyncRemotePath': {
            logger.info(`保存项目远程路径: "${msg.value}"`);
            const ws3 = getWorkspaceRoot();
            if (ws3) {
                const remoteCfg = loadRemoteSettings(ws3);
                const serverId = remoteCfg.selectedServer;
                if (serverId) {
                    const newVal = String(msg.value || '');
                    // 不用空值覆盖已有路径（防止页面重渲染时 onblur 误触发）
                    if (newVal || !remoteCfg.remotePaths[serverId]) {
                        updateRemotePath(ws3, serverId, newVal);
                    }
                }
            }
            refreshSyncStatusBar();
            updateHtml();
            break;
        }
        case 'saveSyncIgnore': {
            logger.info(`保存同步忽略列表: ${JSON.stringify(msg.value)}`);
            const ws4 = getWorkspaceRoot();
            if (ws4) { updateProjectSyncField(ws4, 'ignore', Array.isArray(msg.value) ? msg.value as string[] : []); }
            break;
        }
        case 'addServer': {
            logger.info(`添加服务器: ${msg.server?.name}`);
            if (!msg.server) { break; }
            const newServerData = {
                name: msg.server.name || '',
                host: msg.server.host || '',
                port: msg.server.port ?? 22,
                username: msg.server.username || '',
                authMode: (msg.server.authMode || 'key') as 'key' | 'password',
                privateKeyPath: msg.server.privateKeyPath || '',
                password: msg.server.password || ''
            };
            logger.info(`服务器认证: ${newServerData.authMode}`);
            if (!newServerData.name.trim() || !newServerData.host.trim() || !newServerData.username.trim()) {
                vscode.window.showWarningMessage('服务器名称、地址和用户名不能为空');
                break;
            }
            if (!Number.isInteger(newServerData.port) || newServerData.port < 1 || newServerData.port > 65535) {
                vscode.window.showWarningMessage('端口必须是 1 到 65535 之间的整数');
                break;
            }
            if (newServerData.authMode === 'key' && !newServerData.privateKeyPath.trim()) {
                vscode.window.showWarningMessage('密钥认证需要私钥路径');
                break;
            }
            if (newServerData.authMode === 'password' && !newServerData.password) {
                vscode.window.showWarningMessage('密码认证需要密码');
                break;
            }
            if (newServerData.authMode === 'key') {
                newServerData.password = '';
            } else {
                newServerData.privateKeyPath = '';
            }
            // Check for duplicate name
            const existing = readServers().find(s => s.name === newServerData.name);
            if (existing) {
                vscode.window.showWarningMessage(`服务器名称 "${newServerData.name}" 已存在 (ID: ${existing.id})`);
                break;
            }
            const created = addServer(newServerData);
            // 保存远程路径和选中服务器到项目配置
            const wsAdd = getWorkspaceRoot();
            if (wsAdd) {
                updateRemoteSelectedServer(wsAdd, created.id);
                updateProjectSyncField(wsAdd, 'enabled', true);
                if (msg.remotePath) {
                    updateRemotePath(wsAdd, created.id, String(msg.remotePath));
                }
            }
            refreshSyncStatusBar();
            updateHtml();
            break;
        }
        case 'removeServer': {
            logger.info(`删除服务器: "${msg.id}"`);
            if (msg.id) {
                removeServer(msg.id);
                // Cascade cleanup: clear references in remote and sync settings
                const wsRm = getWorkspaceRoot();
                if (wsRm) {
                    const remoteCfgRm = loadRemoteSettings(wsRm);
                    const wasSelected = remoteCfgRm.selectedServer === msg.id;
                    let remoteChanged = false;
                    if (remoteCfgRm.remotePaths[msg.id]) {
                        delete remoteCfgRm.remotePaths[msg.id];
                        remoteChanged = true;
                    }
                    if (remoteCfgRm.transfer?.deployServer === msg.id) {
                        remoteCfgRm.transfer = null;
                        remoteChanged = true;
                    }
                    // Compute final selectedServer before writing (avoid intermediate empty state)
                    if (wasSelected) {
                        const remaining = readServers();
                        remoteCfgRm.selectedServer = remaining.length > 0 ? remaining[0].id : '';
                        remoteChanged = true;
                    }
                    if (remoteChanged) {
                        saveRemoteSettings(wsRm, remoteCfgRm);
                    }
                    // Disable sync if the removed server was the sync target
                    if (wasSelected) {
                        try {
                            const sync = loadSyncSettings(wsRm);
                            if (sync.enabled) {
                                sync.enabled = false;
                                saveSyncSettings(wsRm, sync);
                            }
                        } catch { /* sync file may not exist */ }
                    }
                }
            }
            refreshSyncStatusBar();
            updateHtml();
            break;
        }
        case 'updateServer': {
            logger.info(`修改服务器: id=${msg.server?.id}, name=${msg.server?.name}`);
            if (!msg.server) { break; }
            const serverId: string = msg.server.id || '';
            const updates = {
                name: msg.server.name || '',
                host: msg.server.host || '',
                port: msg.server.port ?? 22,
                username: msg.server.username || '',
                authMode: (msg.server.authMode || 'key') as 'key' | 'password',
                privateKeyPath: msg.server.privateKeyPath || '',
                password: msg.server.password || ''
            };
            if (!updates.name.trim() || !updates.host.trim() || !updates.username.trim()) {
                vscode.window.showWarningMessage('服务器名称、地址和用户名不能为空');
                break;
            }
            if (!Number.isInteger(updates.port) || updates.port < 1 || updates.port > 65535) {
                vscode.window.showWarningMessage('端口必须是 1 到 65535 之间的整数');
                break;
            }
            // 如果密码为空或为遮蔽占位符，保留原密码
            if (!updates.password || updates.password === '••••••••') {
                const existing = readServers().find(s => s.id === serverId);
                if (existing) { updates.password = existing.password; }
            }
            if (updates.authMode === 'key' && !updates.privateKeyPath.trim()) {
                vscode.window.showWarningMessage('密钥认证需要私钥路径');
                break;
            }
            if (updates.authMode === 'password' && !updates.password) {
                vscode.window.showWarningMessage('密码认证需要密码');
                break;
            }
            const duplicate = readServers().find(s => s.id !== serverId && s.name === updates.name);
            if (duplicate) {
                vscode.window.showWarningMessage(`服务器名称 "${updates.name}" 已存在 (ID: ${duplicate.id})`);
                break;
            }
            if (updates.authMode === 'key') {
                updates.password = '';
            } else {
                updates.privateKeyPath = '';
            }
            const updated = updateServer(serverId, updates);
            if (!updated) {
                vscode.window.showWarningMessage('服务器不存在');
                break;
            }
            vscode.window.showInformationMessage(`服务器 "${updates.name}" 已更新`);
            // 保存远程路径到项目配置，并确保选中的是当前编辑的服务器
            const wsUpd = getWorkspaceRoot();
            if (wsUpd) {
                updateRemoteSelectedServer(wsUpd, serverId);
                if (msg.remotePath !== undefined) {
                    updateRemotePath(wsUpd, serverId, String(msg.remotePath || ''));
                }
            }
            _pushServerList(webview, serverId);
            refreshSyncStatusBar();
            updateHtml();
            break;
        }
        case 'syncNow': {
            logger.info('手动触发同步');
            await vscode.commands.executeCommand('forja.sync');
            break;
        }
        case 'testSyncConnection': {
            logger.info('测试远程连接');
            await executeTestConnection();
            break;
        }
        case 'testFormConnection': {
            logger.info('测试表单中的连接');
            if (!msg.server) { break; }
            const testServer = {
                host: msg.server.host || '',
                port: msg.server.port ?? 22,
                username: msg.server.username || '',
                authMode: (msg.server.authMode || 'key') as 'key' | 'password',
                privateKeyPath: msg.server.privateKeyPath || '',
                password: msg.server.password || ''
            };
            if (!Number.isInteger(testServer.port) || testServer.port < 1 || testServer.port > 65535) {
                vscode.window.showWarningMessage('端口必须是 1 到 65535 之间的整数');
                break;
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在测试连接 ${testServer.host}...`,
                cancellable: false
            }, async () => {
                try {
                    const { testConnection } = await import('../../sync/transport');
                    const tempServerConfig = {
                        id: '', name: 'test', ...testServer, strictHostKeyChecking: false
                    };
                    const pwd = testServer.authMode === 'password' ? testServer.password : null;
                    const result = await testConnection(tempServerConfig as import('../../core/serverStore').ServerConfig, pwd);
                    if (result.ok) {
                        vscode.window.showInformationMessage(`连接成功: ${testServer.username}@${testServer.host}:${testServer.port}`);
                    } else {
                        vscode.window.showErrorMessage(`连接失败: ${result.error || '未知错误'}`);
                    }
                } catch (e) {
                    vscode.window.showErrorMessage(`连接失败: ${e instanceof Error ? e.message : e}`);
                }
            });
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
        // ── C++ 配置消息 ──
        case 'saveCppMode': {
            const val = String(msg.value || '');
            if (val !== 'debug' && val !== 'release') { break; }
            logger.info(`保存 C++ 构建模式: "${val}"`);
            setCppSetting('mode', val);
            // Sync to activeTarget so CLI build/run use the updated value
            const ws = getWorkspaceRoot();
            if (ws) {
                const { getActiveTarget, setActiveTarget } = await import('../../cli/commands/activeTarget');
                const target = getActiveTarget(ws);
                if (target && target.kind === 'cpp') {
                    setActiveTarget(ws, { ...target, mode: val });
                }
            }
            break;
        }
        case 'saveCppArch': {
            const val = String(msg.value || '');
            if (!isWindows) {
                setCppSetting('arch', getDefaultArch());
                break;
            }
            if (val !== 'x86' && val !== 'x64') { break; }
            logger.info(`保存 C++ 目标架构: "${val}"`);
            setCppSetting('arch', val);
            // Sync to activeTarget so CLI build/run use the updated value
            const wsArch = getWorkspaceRoot();
            if (wsArch) {
                const { getActiveTarget: gat, setActiveTarget: sat } = await import('../../cli/commands/activeTarget');
                const at = gat(wsArch);
                if (at && at.kind === 'cpp') {
                    sat(wsArch, { ...at, arch: val });
                }
            }
            break;
        }
        case 'saveCppVsInstall': {
            logger.info(`保存 C++ VS 路径: "${msg.value}"`);
            const cppVsInstall = inferVsInstall(String(msg.value || '')) || String(msg.value || '');
            setCppSetting('vsInstall', cppVsInstall);
            break;
        }
        case 'selectCppProject': {
            // 使用统一项目选择器（分组显示）
            const { showUnifiedProjectPicker } = await import('../statusBar');
            await showUnifiedProjectPicker();
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
            privateKeyPath: s.privateKeyPath,
            password: s.password ? '••••••••' : ''
        })),
        select: selectId || ''
    });
}
