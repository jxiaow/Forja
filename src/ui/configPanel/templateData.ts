/**
 * 构建配置面板所需的模板数据 — 从各个 service 收集当前状态。
 * 抽取为独立模块，供 WebviewPanel 和旧 WebviewViewProvider 共用。
 */
import * as vscode from 'vscode';
import { getState } from '../../core/qtState';
import { TemplateData } from './template';
import {
    getVsDevShellPath, getQtPath, getCStandard, getCppStandard,
    getScanExcludeDirs, getPinnedProject, getTarget, getManualProPath,
    getDesignerPath, getQtSourcePath, getFileSyncPromptEnabled,
    getQmakeReminderEnabled, getRccProjectPath, getWorkspaceRoot
} from '../../qt/services/configService';
import { getQtSetting } from '../../core/settingsStore';
import { readServers, readProjectSyncConfig } from '../../core/serverStore';
import { getSyncPendingInfo } from '../../core/syncState';

export function buildTemplateData(context: vscode.ExtensionContext): TemplateData {
    const state = getState();
    const env = state.envInfo;
    const project = state.currentProject;
    const wsRoot = getWorkspaceRoot();
    const sync = wsRoot
        ? readProjectSyncConfig(wsRoot)
        : { enabled: false, selectedServer: '', ignore: ['.git', 'node_modules', 'out', '.compilot', 'build', 'debug', 'release'], remotePaths: {} };
    const servers = readServers();
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
        syncSelectedServer: sync.selectedServer,
        syncServers: servers.map(s => ({
            id: s.id, name: s.name, host: s.host, port: s.port,
            username: s.username, authMode: s.authMode,
            privateKeyPath: s.privateKeyPath, password: s.password
        })),
        syncIgnore: sync.ignore.join(', '),
        syncRemotePath: sync.remotePaths[sync.selectedServer] || '',
        syncPendingCount: pendingInfo.count,
        syncLastTime: pendingInfo.lastTime
    };
}
