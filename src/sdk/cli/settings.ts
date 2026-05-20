/**
 * SDK CLI 配置读写 — 基于 ~/.compilot/projects/ 的 sdk 配置。
 * 不依赖 vscode，供 CLI 使用。
 */
import { loadSdkSettings as _loadSdk, saveSdkSettings as _saveSdk, projectConfigPath, SdkSettings, resolveVsDevCmdPath, inferVsInstall } from '../../core/settingsIO';

export type { SdkSettings } from '../../core/settingsIO';

export interface SdkCliSettings extends SdkSettings {
    /** 推导出的 VsDevCmd.bat 路径（只读，不存储） */
    vsDevCmdPath: string;
}

export function sdkSettingsFilePath(workspace: string): string {
    return projectConfigPath(workspace, 'sdk');
}

export function loadSdkSettings(workspace: string): SdkCliSettings {
    const sdk = _loadSdk(workspace);
    return {
        ...sdk,
        vsDevCmdPath: resolveVsDevCmdPath(sdk.vsInstall)
    };
}

export function saveSdkSettings(workspace: string, settings: { mode: string; arch: string; vsDevCmdPath: string; pinnedProject: string | null; scanDepth?: number }): void {
    const current = _loadSdk(workspace);
    const updated: SdkSettings = {
        mode: (settings.mode === 'debug' || settings.mode === 'release') ? settings.mode : 'debug',
        arch: (settings.arch === 'x86' || settings.arch === 'x64') ? settings.arch : 'x86',
        vsInstall: settings.vsDevCmdPath ? inferVsInstall(settings.vsDevCmdPath) : current.vsInstall,
        pinnedProject: settings.pinnedProject,
        ...(settings.scanDepth ? { scanDepth: settings.scanDepth } : {})
    };
    _saveSdk(workspace, updated);
}
