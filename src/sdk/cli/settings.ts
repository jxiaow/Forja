/**
 * SDK CLI 本地配置读写。
 * 存储在 .compilot/sdk-settings.json。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface SdkSettings {
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    vsDevCmdPath: string;
    pinnedProject: string | null;
}

const DEFAULT_SDK_SETTINGS: SdkSettings = {
    mode: 'debug',
    arch: 'x86',
    vsDevCmdPath: '',
    pinnedProject: null
};

export function sdkSettingsFilePath(workspace: string): string {
    return path.join(workspace, '.compilot', 'sdk-settings.json');
}

export function loadSdkSettings(workspace: string): SdkSettings {
    const filePath = sdkSettingsFilePath(workspace);
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return {
                mode: (raw.mode === 'debug' || raw.mode === 'release') ? raw.mode : DEFAULT_SDK_SETTINGS.mode,
                arch: (raw.arch === 'x86' || raw.arch === 'x64') ? raw.arch : DEFAULT_SDK_SETTINGS.arch,
                vsDevCmdPath: typeof raw.vsDevCmdPath === 'string' ? raw.vsDevCmdPath : '',
                pinnedProject: typeof raw.pinnedProject === 'string' ? raw.pinnedProject : null
            };
        }
    } catch { /* file missing or malformed */ }
    return { ...DEFAULT_SDK_SETTINGS };
}

export function saveSdkSettings(workspace: string, settings: SdkSettings): void {
    const filePath = sdkSettingsFilePath(workspace);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 4) + '\n', 'utf-8');
}
