import { detectEnvWin } from './envDetectorWin';
import { detectEnvLinux } from './envDetectorLinux';

export interface EnvInfo {
    vs: VSInfo | null;
    qt: QtInfo | null;
    jom: boolean;
}

export interface VSInfo {
    version: string;
    edition: string;
    installPath: string;
    devShellPath: string;
}

export interface QtInfo {
    version: string;
    compiler: string;
    path: string;
}

let _envInfo: EnvInfo | null = null;

export function getEnvInfo(): EnvInfo | null {
    return _envInfo;
}

export async function detectEnv(manualQtPath?: string, manualVsPath?: string): Promise<EnvInfo> {
    if (process.platform === 'win32') {
        _envInfo = await detectEnvWin(manualQtPath, manualVsPath);
    } else {
        _envInfo = await detectEnvLinux(manualQtPath);
    }
    return _envInfo;
}
