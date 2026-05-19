/**
 * 平台工具链需求检测。
 * 根据当前平台返回必需的工具链项目及其检测状态。
 */
import type { QtPilotSettings } from '../../core/settingsIO';

export interface PlatformRequirement {
    key: string;
    label: string;
    cliFlag?: string;
    missingHint?: string;
    check: (settings: QtPilotSettings) => boolean;
}

const isWin = process.platform === 'win32';

const windowsRequirements: PlatformRequirement[] = [
    {
        key: 'qtPath',
        label: 'Qt',
        cliFlag: '--qt-path <path>',
        missingHint: '使用 --qt-path 指定 Qt 安装路径',
        check: (s) => !!s.qtPath
    },
    {
        key: 'vsDevShellPath',
        label: 'Visual Studio',
        cliFlag: '--vs-dev-shell <path>',
        missingHint: '使用 --vs-dev-shell 指定 Launch-VsDevShell.ps1 路径',
        check: (s) => !!s.vsDevShellPath
    },
    {
        key: 'jom',
        label: 'jom',
        missingHint: '通常随 Qt Creator 安装',
        check: (s) => !!s.jomPath
    }
];

const linuxRequirements: PlatformRequirement[] = [
    {
        key: 'qtPath',
        label: 'Qt',
        cliFlag: '--qt-path <path>',
        missingHint: '使用 --qt-path 指定 Qt 安装路径',
        check: (s) => !!s.qtPath
    }
];

export function getPlatformRequirements(): PlatformRequirement[] {
    return isWin ? windowsRequirements : linuxRequirements;
}

/**
 * 检查所有必需工具是否就绪。
 */
export function checkToolsReady(settings: QtPilotSettings): { allReady: boolean; checks: Record<string, boolean> } {
    const reqs = getPlatformRequirements();
    const checks: Record<string, boolean> = {};
    let allReady = true;
    for (const req of reqs) {
        const ok = req.check(settings);
        checks[req.key] = ok;
        if (!ok) { allReady = false; }
    }
    return { allReady, checks };
}

/**
 * 返回缺失的工具列表。
 */
export function getMissingTools(settings: QtPilotSettings): PlatformRequirement[] {
    return getPlatformRequirements().filter(r => !r.check(settings));
}

/**
 * 获取当前平台可用的架构列表。
 */
export function getAvailableArch(): Array<'x86' | 'x64'> {
    if (isWin) { return ['x86', 'x64']; }
    // Linux 通常只用 x64
    return ['x64'];
}

/**
 * 获取当前平台的默认架构。
 */
export function getDefaultArch(): 'x86' | 'x64' {
    return isWin ? 'x86' : 'x64';
}
