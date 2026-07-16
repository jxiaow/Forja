/**
 * C++ CLI 配置读写 — 基于 ~/.forja/projects/ 的 cpp 配置。
 * 不依赖 vscode，供 CLI 使用。
 */
import { loadCppSettings as _loadCpp, saveCppSettings as _saveCpp, projectConfigPath, CppSettings, resolveVsDevCmdPath, inferVsInstall } from '../../core/settingsIO';

export type { CppSettings } from '../../core/settingsIO';

export interface CppCliSettings extends CppSettings {
    /** 推导出的 VsDevCmd.bat 路径（只读，不存储） */
    vsDevCmdPath: string;
}

export function cppSettingsFilePath(workspace: string): string {
    return projectConfigPath(workspace, 'cpp');
}

export function loadCppSettings(workspace: string): CppCliSettings {
    const cpp = _loadCpp(workspace);
    return {
        ...cpp,
        vsDevCmdPath: resolveVsDevCmdPath(cpp.vsInstall)
    };
}

export function saveCppSettings(workspace: string, settings: { mode: string; arch: string; vsDevCmdPath: string; pinnedProject: string | null; scanDepth?: number }): void {
    const current = _loadCpp(workspace);
    const updated: CppSettings = {
        mode: (settings.mode === 'debug' || settings.mode === 'release') ? settings.mode : 'debug',
        arch: (settings.arch === 'x86' || settings.arch === 'x64') ? settings.arch : 'x86',
        vsInstall: settings.vsDevCmdPath ? inferVsInstall(settings.vsDevCmdPath) : current.vsInstall,
        pinnedProject: settings.pinnedProject,
        ...(settings.scanDepth ? { scanDepth: settings.scanDepth } : {})
    };
    _saveCpp(workspace, updated);
}
