import * as fs from 'fs';
import * as path from 'path';

export interface RuntimeTargetInfo {
    target: string;
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

        return {
            target: path.basename(destDirTarget.replace(/\.exe$/i, '')),
            exePath: path.join(projectDir, destDirTarget.replace(/\\/g, path.sep))
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
