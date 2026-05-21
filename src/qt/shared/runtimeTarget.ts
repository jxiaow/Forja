import * as fs from 'fs';
import * as path from 'path';

export interface RuntimeTargetInfo {
    target: string;
    destDir: string;
    exePath: string;
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
export function validateMakefile(projectDir: string, config: { mode: string; arch: string; qtPath: string; proFile: string; target: string }): MakefileValidation {
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
    if (process.platform === 'win32' && !cmd.includes(`CONFIG+=${config.arch}`)) { mismatch.push('arch'); }
    // Qt 路径：命令行中包含完整 qmake 可执行文件路径
    if (config.qtPath) {
        const expectedQmake = path.join(config.qtPath, 'bin', process.platform === 'win32' ? 'qmake.exe' : 'qmake').replace(/\\/g, '/').toLowerCase();
        const cmdNormalized = cmd.replace(/\\/g, '/').toLowerCase();
        if (!cmdNormalized.includes(expectedQmake)) { mismatch.push('qtPath'); }
    }
    // .pro 文件
    if (config.proFile) {
        const proBasename = path.basename(config.proFile);
        if (!cmd.includes(proBasename)) { mismatch.push('project'); }
    }
    // target 覆盖
    if (config.target) {
        if (!cmd.includes(`TARGET=${config.target}`)) { mismatch.push('target'); }
    } else {
        // 当前未指定 target，但 Makefile 里有 TARGET= 覆盖，说明旧的有覆盖新的没有
        if (/TARGET=/.test(cmd)) { mismatch.push('target'); }
    }

    return { exists: true, matches: mismatch.length === 0, mismatch: mismatch.length > 0 ? mismatch : undefined };
}

export function resolveRuntimeTarget(projectDir: string, mode: string, arch: string): RuntimeTargetInfo | null {
    const mainMakefilePath = path.join(projectDir, 'Makefile');
    const mainContent = readFile(mainMakefilePath);
    if (!mainContent) {
        return null;
    }

    if (process.platform === 'win32') {
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
