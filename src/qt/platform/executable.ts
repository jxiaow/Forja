/**
 * 平台可执行文件与命名约定 — shared/ 代码经此层获取平台差异，不再就地判断
 * process.platform。所有判断在调用时读取 process.platform，与原调用点语义一致
 * （契约测试可在调用窗口内临时替换平台）。
 */
import type { PlatformConfig } from './platformConfig';
import { winConfig } from './win/builder';
import { linuxConfig } from './linux/builder';
import { posixQuote } from '../../core/shellQuote';

export function isWindows(): boolean {
    return process.platform === 'win32';
}

/** buildRccCommands 接受的平台标识（'win32' | 'linux'） */
export function platformName(): 'win32' | 'linux' {
    return isWindows() ? 'win32' : 'linux';
}

/** 当前平台的命令组合配置（cmd /c 与 bash、qmake.exe 与 qmake 等） */
export function currentPlatformConfig(): PlatformConfig {
    return isWindows() ? winConfig : linuxConfig;
}

/** 可执行文件后缀：Windows 为 '.exe'，其余平台为空串 */
export function exeSuffix(): string {
    return isWindows() ? '.exe' : '';
}

/** qmake 二进制文件名（与 PlatformConfig.qmakeBin 一致） */
export function qmakeBinName(): string {
    return isWindows() ? 'qmake.exe' : 'qmake';
}

/** 按平台约定补齐后缀的可执行文件名（Windows 强制 .exe） */
export function normalizeExeName(name: string): string {
    return isWindows() ? name.replace(/\.exe$/i, '') + '.exe' : name;
}

/** 去掉平台后缀得到裸 TARGET 名（Windows 剥离 .exe） */
export function exeBaseName(name: string): string {
    return isWindows() ? name.replace(/\.exe$/i, '') : name;
}

/**
 * 构建后产物重命名命令。Windows 用 move /Y：ren 在目标已存在（上一轮构建产物）时
 * 静默失败且无法覆盖，move /Y 与 POSIX mv -f 语义一致 —— 覆盖旧产物，真实错误
 * （文件被占用等）以非零退出码上报。
 */
export function renameOutputCommand(fromPath: string, toPath: string): string[] {
    if (isWindows()) {
        return [`(if exist "${fromPath}" move /Y "${fromPath}" "${toPath}")`];
    }
    return [`mv -f ${posixQuote(fromPath)} ${posixQuote(toPath)}`];
}
