import * as fs from 'fs';
import * as path from 'path';
import { isWindows, qmakeBinName, normalizeExeName, exeBaseName, renameOutputCommand } from '../platform/executable';

/**
 * 根据平台计算重命名后的可执行文件完整路径。
 * Windows 上自动处理 .exe 后缀。路径语义跟随 isWindows()，与宿主 OS 无关。
 */
export function resolveDesiredExePath(exeDir: string, executableName: string): string {
    const desiredName = normalizeExeName(executableName);
    return (isWindows() ? path.win32 : path.posix).join(exeDir, desiredName);
}

/**
 * 生成构建后重命名命令。actualTarget 为 qmake TARGET 名，与 executableName 不同时重命名。
 * 平台命令差异（move /Y 与 mv -f）见 platform/executable.renameOutputCommand。
 */
export function buildRenameCommand(exePath: string, actualTarget: string, executableName: string | undefined): string[] {
    if (!executableName) { return []; }
    const desiredBase = exeBaseName(executableName);
    if (actualTarget === desiredBase) { return []; }
    const p = isWindows() ? path.win32 : path.posix;
    const desiredPath = resolveDesiredExePath(p.dirname(exePath), executableName);
    return renameOutputCommand(exePath, desiredPath);
}

export interface RuntimeTargetInfo {
    target: string;
    destDir: string;
    exePath: string;
}

/**
 * 校验 qtPath 下 qmake 可执行文件是否存在。
 * 有效返回 null；无效返回预期的 qmake 完整路径（用于诊断消息）。
 * CLI（createActionPlan）与 VSCode（buildManager）共用同一校验口径。
 */
export function missingQmakeBin(qtPath: string): string | null {
    if (!qtPath) { return null; }
    const qmakeBin = path.join(qtPath, 'bin', qmakeBinName());
    return fs.existsSync(qmakeBin) ? null : qmakeBin;
}

function readFile(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function parseMakefileVar(content: string, varName: string): string | null {
    const match = content.match(new RegExp(`^${varName}[ \\t]+=[ \\t]*(.+)$`, 'm'));
    if (!match) {
        return null;
    }
    return match[1].replace(/#.*$/, '').trim();
}

function parseMakefileMode(content: string): string | null {
    const match = content.match(/^#\s*Command:.*CONFIG\+=(\w+)/m);
    if (!match) {
        return null;
    }
    if (match[1] === 'release') {
        return 'release';
    }
    if (match[1] === 'debug') {
        return 'debug';
    }
    return null;
}

function validateWindowsMakefile(content: string, mode: string, arch: string): boolean {
    const match = content.match(/^#\s*Command:.*$/m);
    if (!match) {
        return false;
    }
    const cmd = match[0];
    return cmd.includes(`CONFIG+=${mode}`) && cmd.includes(`CONFIG+=${arch}`);
}

export interface MakefileValidation {
    exists: boolean;
    matches: boolean;
    mismatch?: string[];
}

/**
 * 校验 Makefile 是否和当前配置匹配。
 * 检查 qmake 命令行注释中的 mode、arch、Qt 路径、.pro 文件、target。
 */
export function validateMakefile(projectDir: string, config: { mode: string; arch: string; qtPath: string; proFile: string; target: string; qmakeArgs?: string }): MakefileValidation {
    const makefilePath = path.join(projectDir, 'Makefile');
    const content = readFile(makefilePath);
    if (!content) {
        return { exists: false, matches: false };
    }

    const cmdMatch = content.match(/^#\s*Command:\s*(.+)$/m);
    if (!cmdMatch) {
        // Makefile 存在但没有 qmake 命令头，无法校验，保守认为匹配
        return { exists: true, matches: true };
    }

    const cmd = cmdMatch[1];
    const mismatch: string[] = [];

    // mode
    if (!cmd.includes(`CONFIG+=${config.mode}`)) { mismatch.push('mode'); }
    // arch (Windows only)
    if (isWindows() && !cmd.includes(`CONFIG+=${config.arch}`)) { mismatch.push('arch'); }
    // Qt 路径：命令行中包含完整 qmake 可执行文件路径
    if (config.qtPath) {
        const expectedQmake = path.join(config.qtPath, 'bin', qmakeBinName()).replace(/\\/g, '/').toLowerCase();
        const cmdNormalized = cmd.replace(/\\/g, '/').toLowerCase();
        if (!cmdNormalized.includes(expectedQmake)) { mismatch.push('qtPath'); }
    }
    // .pro 文件
    if (config.proFile) {
        const proBasename = path.basename(config.proFile);
        if (!cmd.includes(proBasename)) { mismatch.push('project'); }
    }
    // target 覆盖已改为构建后重命名，不再校验 Makefile 中的 TARGET
    if (config.qmakeArgs && !cmd.includes(config.qmakeArgs)) {
        mismatch.push('qmakeArgs');
    }

    return { exists: true, matches: mismatch.length === 0, mismatch: mismatch.length > 0 ? mismatch : undefined };
}

export function resolveRuntimeTarget(projectDir: string, mode: string, arch: string): RuntimeTargetInfo | null {
    const mainMakefilePath = path.join(projectDir, 'Makefile');
    const mainContent = readFile(mainMakefilePath);
    if (!mainContent) {
        return null;
    }

    if (isWindows()) {
        if (!validateWindowsMakefile(mainContent, mode, arch)) {
            return null;
        }

        const subMakefilePath = path.join(projectDir, `Makefile.${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
        const subContent = readFile(subMakefilePath);
        if (!subContent) {
            return null;
        }

        const destDirTarget = parseMakefileVar(subContent, 'DESTDIR_TARGET');
        if (!destDirTarget) {
            return null;
        }

        const exePath = destDirTarget.replace(/\\/g, path.sep);
        return {
            target: path.win32.basename(destDirTarget.replace(/\.exe$/i, '')),
            destDir: path.win32.dirname(destDirTarget).replace(/\\/g, '/'),
            exePath: path.join(projectDir, exePath)
        };
    }

    const makefileMode = parseMakefileMode(mainContent);
    if (makefileMode && makefileMode !== mode) {
        return null;
    }

    const target = parseMakefileVar(mainContent, 'TARGET');
    if (!target) {
        return null;
    }

    return {
        target: path.basename(target),
        destDir: path.dirname(target) !== '.' ? path.dirname(target) : '',
        exePath: path.join(projectDir, target)
    };
}

export function parseRuntimeLibPaths(projectDir: string): string[] {
    const mainMakefilePath = path.join(projectDir, 'Makefile');
    const content = readFile(mainMakefilePath);
    if (!content) {
        return [];
    }

    const libs = parseMakefileVar(content, 'LIBS');
    if (!libs) {
        return [];
    }

    const paths: string[] = [];
    const matches = libs.matchAll(/-L(\S+)/g);
    for (const match of matches) {
        const libraryPath = match[1];
        const absolutePath = path.isAbsolute(libraryPath)
            ? path.normalize(libraryPath)
            : path.resolve(projectDir, libraryPath);
        if (fs.existsSync(absolutePath)) {
            paths.push(absolutePath);
        }
    }
    return paths;
}
