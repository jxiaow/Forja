/**
 * SDK CLI 配置读写 — 基于统一 .compilot/settings.json 的 sdk 部分。
 * 不依赖 vscode，供 CLI 使用。
 */
import { loadSettings, saveSettings, settingsFilePath, SdkSettings, resolveVsDevCmdPath, inferVsInstall } from '../../core/settingsIO';

export type { SdkSettings } from '../../core/settingsIO';

export interface SdkCliSettings extends SdkSettings {
    /** 推导出的 VsDevCmd.bat 路径（只读，不存储） */
    vsDevCmdPath: string;
}

export function sdkSettingsFilePath(workspace: string): string {
    return settingsFilePath(workspace);
}

export function loadSdkSettings(workspace: string): SdkCliSettings {
    const all = loadSettings(workspace);
    const sdk = all.sdk;
    return {
        ...sdk,
        vsDevCmdPath: resolveVsDevCmdPath(sdk.vsInstall)
    };
}

export function saveSdkSettings(workspace: string, settings: { mode: string; arch: string; vsDevCmdPath: string; pinnedProject: string | null; scanDepth?: number }): void {
    const all = loadSettings(workspace);
    all.sdk = {
        mode: (settings.mode === 'debug' || settings.mode === 'release') ? settings.mode : 'debug',
        arch: (settings.arch === 'x86' || settings.arch === 'x64') ? settings.arch : 'x86',
        vsInstall: settings.vsDevCmdPath ? inferVsInstall(settings.vsDevCmdPath) : all.sdk.vsInstall,
        pinnedProject: settings.pinnedProject,
        ...(settings.scanDepth ? { scanDepth: settings.scanDepth } : {})
    };
    saveSettings(workspace, all);
}
