/**
 * Unified project scanner — combines Qt (.pro) and C++ (.sln/Makefile/CMakeLists.txt) scanning.
 * No vscode dependency. Used by both CLI and VSCode extension.
 */
import * as path from 'path';
import * as os from 'os';
import { UnifiedProject, ProjectGroup } from './types';
import { scanProFiles, parseProFile } from '../qt/shared/projectScanner';
import { scanCppProjects } from './cppProjectScanner';

export interface UnifiedScanOptions {
    workspace: string;
    maxDepth?: number;
}

/**
 * Scan all projects (Qt + C++) in a workspace.
 * Returns a unified list with kind auto-detected from file extension.
 */
export function scanAllProjects(options: UnifiedScanOptions): UnifiedProject[] {
    const { workspace, maxDepth = 8 } = options;
    const results: UnifiedProject[] = [];
    const isWindows = os.platform() === 'win32';

    // 1. Scan Qt projects (.pro)
    const proFiles = scanProFiles(workspace);
    for (const relPath of proFiles) {
        const absPath = path.join(workspace, relPath);
        const info = parseProFile(absPath);
        const name = info?.target || path.basename(relPath, '.pro');
        results.push({
            name,
            path: absPath,
            projectDir: path.dirname(absPath),
            kind: 'qt',
            qtInfo: info || undefined,
        });
    }

    // 2. Scan C++ projects (.sln / Makefile / CMakeLists.txt)
    const cppFiles = scanCppProjects({
        workspace,
        maxDepth,
        skipQtProjectDirs: true,  // skip dirs with .pro files
        relativePaths: true,
    });
    for (const relPath of cppFiles) {
        const absPath = path.join(workspace, relPath);
        const fileName = path.basename(relPath);
        const name = path.basename(relPath, path.extname(relPath)) || fileName;

        let cppType: 'sln' | 'makefile' | 'cmake';
        if (fileName.toLowerCase().endsWith('.sln')) {
            cppType = 'sln';
        } else if (fileName.toLowerCase() === 'cmakelists.txt') {
            cppType = 'cmake';
        } else {
            cppType = 'makefile';
        }

        // Use directory name as display name for C++ projects
        const dirName = path.basename(path.dirname(absPath));
        const displayName = cppType === 'cmake' ? `${dirName} (cmake)` :
                           cppType === 'makefile' ? `${dirName} (makefile)` :
                           name;

        results.push({
            name: displayName,
            path: absPath,
            projectDir: path.dirname(absPath),
            kind: 'cpp',
            cppType,
        });
    }

    return results;
}

/**
 * Group projects by top-level directory under workspace root.
 * e.g., "xyplat/build/cmake" → group "xyplat/"
 */
export function groupProjectsByTopDir(projects: UnifiedProject[], workspaceRoot: string): ProjectGroup[] {
    const groups = new Map<string, UnifiedProject[]>();

    for (const proj of projects) {
        const rel = path.relative(workspaceRoot, proj.projectDir).replace(/\\/g, '/');
        const parts = rel.split('/');
        const topDir = parts[0] || '.';

        if (!groups.has(topDir)) {
            groups.set(topDir, []);
        }
        groups.get(topDir)!.push(proj);
    }

    return Array.from(groups.entries())
        .map(([dir, projs]) => ({
            label: dir === '.' ? '(根目录)' : `${dir}/`,
            relativePath: dir,
            projects: projs,
        }))
        .sort((a, b) => {
            // Root dir first, then alphabetical
            if (a.relativePath === '.') { return -1; }
            if (b.relativePath === '.') { return 1; }
            return a.label.localeCompare(b.label);
        });
}
