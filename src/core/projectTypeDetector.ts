/**
 * Project type detector — analyzes project files to determine build system and Qt dependency.
 * No vscode dependency.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectTypeInfo {
    buildSystem: 'qmake' | 'cmake' | 'msbuild' | 'make';
    usesQt: boolean;
}

/**
 * Detect project type by analyzing file content.
 */
export function detectProjectType(projectPath: string): ProjectTypeInfo {
    const fileName = path.basename(projectPath).toLowerCase();
    const ext = path.extname(fileName);

    // .pro files are always Qt + qmake
    if (ext === '.pro') {
        return { buildSystem: 'qmake', usesQt: true };
    }

    // CMakeLists.txt - check for Qt dependency
    if (fileName === 'cmakelists.txt') {
        return detectCMakeProjectType(projectPath);
    }

    // .sln files - check for Qt dependency in referenced projects
    if (ext === '.sln') {
        return detectSlnProjectType(projectPath);
    }

    // Makefile - check for Qt references
    if (fileName === 'makefile' || fileName === 'gnumakefile') {
        return detectMakeProjectType(projectPath);
    }

    // Default fallback
    return { buildSystem: 'make', usesQt: false };
}

function detectCMakeProjectType(cmakePath: string): ProjectTypeInfo {
    try {
        const content = fs.readFileSync(cmakePath, 'utf-8');
        // Comprehensive Qt detection: find_package, Qt5Core/Qt6Core, QT_VERSION, etc.
        const usesQt = /find_package\s*\(\s*(Qt5\w*|Qt6\w*|QT\w*)\b/i.test(content)
            || /\bQt5?Core\b/i.test(content)
            || /\bQT_VERSION\b/i.test(content)
            || /\bQT5?_INSTALL\b/i.test(content);
        return { buildSystem: 'cmake', usesQt };
    } catch {
        return { buildSystem: 'cmake', usesQt: false };
    }
}

function detectSlnProjectType(slnPath: string): ProjectTypeInfo {
    try {
        const slnDir = path.dirname(slnPath);
        const content = fs.readFileSync(slnPath, 'utf-8');

        // Extract project paths from .sln file
        const projectMatches = content.match(/Project\([^)]+\)\s*=\s*"[^"]+",\s*"([^"]+\.vcxproj)"/g);
        if (!projectMatches) {
            return { buildSystem: 'msbuild', usesQt: false };
        }

        // Check each .vcxproj for Qt references
        for (const match of projectMatches) {
            const vcxprojMatch = match.match(/"([^"]+\.vcxproj)"/);
            if (!vcxprojMatch) continue;

            const vcxprojPath = path.join(slnDir, vcxprojMatch[1]);
            if (fs.existsSync(vcxprojPath)) {
                const vcxprojContent = fs.readFileSync(vcxprojPath, 'utf-8');
                // Comprehensive Qt detection: Qt libraries, Qt paths, Qt macros, Qt targets
                if (/Qt5Core|Qt6Core|Qt\d+Core|Qt5Gui|Qt6Gui|Qt5Widgets|Qt6Widgets/i.test(vcxprojContent)
                    || /\\qt\\|\/qt\/|\\Qt\\|\/Qt\//i.test(vcxprojContent)
                    || /QT_VERSION|QTDIR|QMAKE/i.test(vcxprojContent)
                    || /Qt5::|Qt6::/i.test(vcxprojContent)) {
                    return { buildSystem: 'msbuild', usesQt: true };
                }
            }
        }

        return { buildSystem: 'msbuild', usesQt: false };
    } catch {
        return { buildSystem: 'msbuild', usesQt: false };
    }
}

function detectMakeProjectType(makefilePath: string): ProjectTypeInfo {
    try {
        const content = fs.readFileSync(makefilePath, 'utf-8');
        // Comprehensive Qt detection: Qt variables, Qt paths, Qt commands
        const usesQt = /\$\((QTDIR|QT_PATH|QMAKE|QT_LIBS|QT_CFLAGS)\)|\$\{(?:QTDIR|QT_PATH|QMAKE|QT_LIBS|QT_CFLAGS)\}/i.test(content)
            || /\/qt\/|\\qt\\/i.test(content)
            || /\bqmake\b/i.test(content)
            || /\bQT\s*[:=]/i.test(content);
        return { buildSystem: 'make', usesQt };
    } catch {
        return { buildSystem: 'make', usesQt: false };
    }
}
