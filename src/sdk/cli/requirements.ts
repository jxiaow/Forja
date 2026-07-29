/**
 * SDK 平台需求：架构检测。
 */

const isWin = process.platform === 'win32';

export function getSdkDefaultArch(): 'x86' | 'x64' {
    return isWin ? 'x86' : 'x64';
}

export function getSdkAvailableArch(): Array<'x86' | 'x64'> {
    if (isWin) { return ['x86', 'x64']; }
    return ['x64'];
}
