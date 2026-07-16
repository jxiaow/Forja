/**
 * 构建配置面板所需的模板数据 — 从各个 service 收集当前状态。
 * 抽取为独立模块，供 WebviewPanel 和旧 WebviewViewProvider 共用。
 */
import * as vscode from 'vscode';
import { getState } from '../../vscode/qtState';
import { TemplateData } from './template';
import {
    getVsDevShellPath, getQtPath, getCStandard, getCppStandard,
    getScanExcludeDirs, getPinnedProject, getTarget, getQmakeArgs, getManualProPath,
    getDesignerPath, getQtSourcePath, getFileSyncPromptEnabled,
    getQmakeReminderEnabled, getRccProjectPath, getWorkspaceRoot
} from '../../qt/services/configService';
import { getQtSetting, getCppSetting } from '../../vscode/settingsStore';
import { resolveProjectRoot } from '../../vscode/workspaceResolver';
import { readServers, readProjectSyncConfig } from '../../core/serverStore';
import { loadRemoteSettings } from '../../core/settingsIO';
import { getSyncPendingInfo } from '../../core/syncState';
import type { ServerConfig, ProjectSyncConfig } from '../../core/serverStore';

function buildSyncReadinessIssues(sync: ProjectSyncConfig, remote: { selectedServer: string; remotePaths: Record<string, string> }, servers: ServerConfig[]): string[] {
    const issues: string[] = [];
    const selectedServerExists = !!remote.selectedServer && servers.some(s => s.id === remote.selectedServer);
    if (!sync.enabled) { issues.push('未启用远程同步'); }
    if (servers.length === 0) { issues.push('未添加服务器'); }
    if (!remote.selectedServer) {
        issues.push('未选择同步服务器');
    } else if (!selectedServerExists) {
        issues.push('已选择服务器不存在');
    }
    if (!selectedServerExists || !remote.remotePaths[remote.selectedServer]) {
        issues.push('未设置远程路径');
    }
    return issues;
}

export function buildTemplateData(context: vscode.ExtensionContext): TemplateData {
    const state = getState();
    const env = state.envInfo;
    const project = state.currentProject;
    const wsRoot = getWorkspaceRoot();
    const sync = wsRoot
        ? readProjectSyncConfig(wsRoot)
        : { enabled: false, ignore: ['.git', 'node_modules', 'out', '.forja', 'build', 'debug', 'release'] };
    const remote = wsRoot
        ? loadRemoteSettings(wsRoot)
        : { selectedServer: '', remotePaths: {} as Record<string, string> };
    const servers = readServers();
    const selectedServerExists = !!remote.selectedServer && servers.some(s => s.id === remote.selectedServer);
    const pendingInfo = wsRoot ? getSyncPendingInfo(wsRoot, sync.ignore) : { count: 0, lastTime: '' };

    return {
        env,
        project,
        vsDevShellPath: getVsDevShellPath(),
        pinnedProject: getPinnedProject(),
        mode: getQtSetting('mode'),
        arch: getQtSetting('arch'),
        cStandard: getCStandard(),
        cppStandard: getCppStandard(),
        scanExcludeDirs: getScanExcludeDirs().join(', '),
        target: getTarget(),
        qmakeArgs: getQmakeArgs(),
        isWin: process.platform === 'win32',
        autoDevShell: env?.vs?.devShellPath || '',
        autoQtPath: env?.qt?.path || '',
        qtPath: getQtPath(),
        designerPath: getDesignerPath(),
        qtSourcePath: getQtSourcePath(),
        manualProPath: getManualProPath(),
        fileSyncPromptEnabled: getFileSyncPromptEnabled(),
        qmakeReminderEnabled: getQmakeReminderEnabled(),
        rccProjectPath: getRccProjectPath(),
        version: context.extension.packageJSON.version ?? '',
        syncEnabled: sync.enabled,
        syncSelectedServer: remote.selectedServer,
        syncServers: servers.map(s => ({
            id: s.id, name: s.name, host: s.host, port: s.port,
            username: s.username, authMode: s.authMode,
            privateKeyPath: s.privateKeyPath, password: s.password
        })),
        syncIgnore: sync.ignore.join(', '),
        syncRemotePath: selectedServerExists ? (remote.remotePaths[remote.selectedServer] || '') : '',
        syncPendingCount: pendingInfo.count,
        syncLastTime: pendingInfo.lastTime,
        syncReadinessIssues: buildSyncReadinessIssues(sync, remote, servers),
        // SDK
        cppProjectName: getCppSetting('pinnedProject') || '未选择',
        sdkMode: getCppSetting('mode'),
        sdkArch: getCppSetting('arch'),
        sdkVsInstall: getCppSetting('vsInstall') || '',
        qtActive: !!resolveProjectRoot('qt'),
        sdkActive: !!resolveProjectRoot('cpp'),
    };
}
