/**
 * 平台工具链需求检测。
 * 根据当前平台返回必需的工具链项目及其检测状态。
 */
import type { QtSettings } from '../../core/settingsIO';

export interface PlatformRequirement {
    key: string;
    label: string;
    cliFlag?: string;
    missingHint?: string;
    check: (settings: QtSettings) => boolean;
}

const isWin = process.platform === 'win32';

const windowsRequirements: PlatformRequirement[] = [
    {
        key: 'qtPath',
        label: 'Qt',
        cliFlag: '--qt-path <path>',
        missingHint: '使用 forja qt use --qt-path <path> 保存 Qt 安装路径',
        check: (s) => !!s.qtPath
    },
    {
        key: 'vsInstall',
        label: 'Visual Studio',
        cliFlag: '--vs-dev-shell <path>',
        missingHint: '使用 forja qt use --vs-dev-shell <path> 保存 Launch-VsDevShell.ps1 路径',
        check: (s) => !!s.vsInstall
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
        missingHint: '使用 forja qt use --qt-path <path> 保存 Qt 安装路径',
        check: (s) => !!s.qtPath
    }
];

export function getPlatformRequirements(): PlatformRequirement[] {
    return isWin ? windowsRequirements : linuxRequirements;
}

/**
 * 检查所有必需工具是否就绪。
 */
export function checkToolsReady(settings: QtSettings): { allReady: boolean; checks: Record<string, boolean> } {
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
export function getMissingTools(settings: QtSettings): PlatformRequirement[] {
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

// ── 环境字段（env 命令显示的字段列表，按平台决定） ──

export interface EnvField {
    key: string;
    label: string;
    /** 从 current 对象取值的渲染函数。返回 null 跳过该行 */
    render: (current: Record<string, unknown>) => string | null;
}

const windowsEnvFields: EnvField[] = [
    { key: 'mode', label: 'mode', render: (c) => String(c.mode) },
    { key: 'arch', label: 'arch', render: (c) => String(c.arch) },
    { key: 'qtPath', label: 'Qt', render: (c) => {
        const v = c.qtVersion;
        return (c.qtPath || '未检测到') + (v ? ` (v${v})` : '');
    }},
    { key: 'vsDevShell', label: 'VS DevShell', render: (c) => {
        return (c.vsDevShell || '未检测到') + (c.vsVersion ? ` (${c.vsVersion})` : '');
    }},
    { key: 'jomPath', label: '构建工具', render: (c) => String(c.jomPath || '未检测到') },
];

const linuxEnvFields: EnvField[] = [
    { key: 'mode', label: 'mode', render: (c) => String(c.mode) },
    { key: 'arch', label: 'arch', render: (c) => String(c.arch) },
    { key: 'qtPath', label: 'Qt', render: (c) => {
        const v = c.qtVersion;
        return (c.qtPath || '未检测到') + (v ? ` (v${v})` : '');
    }},
    { key: 'jomPath', label: '构建工具', render: (c) => String(c.jomPath || '未检测到') },
];

/** 获取当前平台的 env 字段定义列表 */
export function getPlatformEnvFields(): EnvField[] {
    return isWin ? windowsEnvFields : linuxEnvFields;
}

/** 构建 env current 对象（只包含当前平台有关的字段） */
export function buildEnvCurrent(resolved: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const base: Record<string, unknown> = {
        mode: resolved?.mode || 'debug',
        arch: resolved?.arch || 'x86',
        qtPath: resolved?.qtPath || null,
        qtVersion: resolved?.qtVersion || null,
        jomPath: resolved?.jomPath || null,
    };
    if (isWin) {
        base.vsDevShell = resolved?.vsDevShell || null;
        base.vsVersion = resolved?.vsVersion || null;
    }
    return base;
}
