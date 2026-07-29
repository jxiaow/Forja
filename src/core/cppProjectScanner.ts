/**
 * Shared C++ project scanner — finds .sln (Windows) / Makefile (POSIX) files.
 * No vscode dependency. Used by both CLI (candidates.ts) and C++ module (ProjectScanner).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CPP_EXCLUDE_DIRS = [
    'node_modules', 'out', 'dist', '.git', '.work', '.forja',
    'debug', 'release',
];

export const CPP_EXCLUDE_PATH_SEGMENTS = ['build/output'];

export const DEFAULT_CPP_SCAN_DEPTH = 8;

export interface CppScanOptions {
    workspace: string;
    maxDepth?: number;
    excludeDirs?: string[];
    excludePathSegments?: string[];
    /** Skip directories that contain .pro files (Qt project dirs) */
    skipQtProjectDirs?: boolean;
    /** Return relative paths instead of absolute */
    relativePaths?: boolean;
}

export function scanCppProjects(options: CppScanOptions): string[] {
    const {
        workspace,
        maxDepth = DEFAULT_CPP_SCAN_DEPTH,
        excludeDirs = CPP_EXCLUDE_DIRS,
        excludePathSegments = CPP_EXCLUDE_PATH_SEGMENTS,
        skipQtProjectDirs = false,
        relativePaths = true,
    } = options;

    const isWindows = os.platform() === 'win32';
    const pattern = isWindows
        ? /\.sln$/i
        : /^(Makefile|makefile|GNUmakefile)$/;
    const isCMake = (name: string) => name.toLowerCase() === 'cmakelists.txt';
    const results: string[] = [];

    function walk(dir: string, currentDepth: number): void {
        if (currentDepth > maxDepth) { return; }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (excludeDirs.includes(entry.name)) { continue; }
                const subDir = path.join(dir, entry.name);
                const rel = path.relative(workspace, subDir).replace(/\\/g, '/');
                if (excludePathSegments.some(seg => rel.includes(seg))) { continue; }
                walk(subDir, currentDepth + 1);
            } else if (entry.isFile() && (pattern.test(entry.name) || isCMake(entry.name))) {
                if (skipQtProjectDirs && isQtProjectDir(dir)) { continue; }
                const abs = path.join(dir, entry.name);
                results.push(relativePaths ? path.relative(workspace, abs).replace(/\\/g, '/') : abs);
            }
        }
    }

    walk(workspace, 0);
    return results;
}

function isQtProjectDir(dir: string): boolean {
    if (hasProFile(dir)) { return true; }
    const parent = path.dirname(dir);
    if (parent !== dir && hasProFile(parent)) { return true; }
    return false;
}

function hasProFile(dir: string): boolean {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.some(e => e.isFile() && e.name.endsWith('.pro'));
    } catch {
        return false;
    }
}
