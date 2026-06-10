/**
 * SDK 平台需求：架构检测、环境字段。
 */

const isWin = process.platform === 'win32';

export function getSdkDefaultArch(): 'x86' | 'x64' {
    return isWin ? 'x86' : 'x64';
}

export function getSdkAvailableArch(): Array<'x86' | 'x64'> {
    if (isWin) { return ['x86', 'x64']; }
    return ['x64'];
}

// ── 环境输出（env 命令，按平台决定包含哪些字段） ──

/** 构建 env current 对象（只包含当前平台有关的字段） */
export function buildSdkEnvCurrent(opts: {
    mode: string; arch: string; vsDevCmd: string | null; make: string | null;
}): Record<string, unknown> {
    const base: Record<string, unknown> = {
        mode: opts.mode,
        arch: opts.arch,
    };
    if (isWin) {
        base.vsDevCmd = opts.vsDevCmd;
    } else {
        base.make = opts.make;
    }
    return base;
}

/** 获取当前平台额外可用信息 */
export function getSdkPlatformAvailable(detected: {
    vsInstallations: Array<{ vsDevCmdPath: string; version: string; edition: string }>;
    makePath: string | null;
}): Record<string, unknown> {
    if (isWin) {
        return { vs: detected.vsInstallations.map(v => ({ path: v.vsDevCmdPath, version: v.version, edition: v.edition })) };
    }
    return { make: detected.makePath ? [detected.makePath] : [] };
}

/** 获取当前平台额外的 configHints */
export function getSdkPlatformConfigHints(): Record<string, string> {
    return isWin ? { vsDevCmd: '--vs-dev-cmd <path>' } : {};
}
