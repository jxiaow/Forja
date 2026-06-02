import * as fs from 'fs';
import * as path from 'path';

const maxScanDepth = 5;
const defaultSkipDirs = ['node_modules', '.git', '.forja', '.worktrees', 'build', 'debug', 'release', 'out'];

/**
 * Scan for .pro files under a root directory.
 * Returns relative paths (forward-slash normalized) from root.
 * Shared between the VSCode extension and the CLI.
 */
export function scanProFiles(root: string, extraSkipDirs: string[] = []): string[] {
    const skipSet = new Set([...defaultSkipDirs, ...extraSkipDirs.map(d => d.toLowerCase())]);
    const proFiles: string[] = [];

    function scan(dir: string, depth: number): void {
        if (depth > maxScanDepth) { return; }
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !skipSet.has(entry.name.toLowerCase())) {
                    scan(path.join(dir, entry.name), depth + 1);
                } else if (entry.isFile() && entry.name.endsWith('.pro')) {
                    proFiles.push(path.join(dir, entry.name));
                }
            }
        } catch { /* readdir permission error tolerated */ }
    }

    scan(root, 0);
    return proFiles.map(p => path.relative(root, p).replace(/\\/g, '/'));
}

/**
 * Parse basic info from a .pro file without any VSCode dependency.
 * Returns null if the file cannot be read.
 */
export interface ProFileInfo {
    proPath: string;
    projectDir: string;
    proFile: string;
    target: string;
    qtModules: string[];
    defines: string[];
}

export function parseProFile(proPath: string): ProFileInfo | null {
    let content: string;
    try {
        content = fs.readFileSync(proPath, 'utf-8');
    } catch {
        return null;
    }

    const projectDir = path.dirname(proPath);
    const proFile = path.basename(proPath);

    let target = path.basename(proFile, '.pro');
    const targetMatch = content.match(/^\s*TARGET\s*=\s*(\S+)/m);
    if (targetMatch) { target = targetMatch[1].trim(); }

    // Collect all QT += / QT = lines (projects often have multiple)
    const qtModules: string[] = [];
    for (const m of content.matchAll(/^\s*QT\s*\+?=\s*(.+)$/gm)) {
        qtModules.push(...m[1].trim().split(/\s+/));
    }
    if (qtModules.length === 0) { qtModules.push('core', 'gui', 'widgets'); }

    const definesMatch = content.match(/^\s*DEFINES\s*\+?=\s*(.+)$/m);
    const defines = definesMatch ? definesMatch[1].trim().split(/\s+/) : [];

    return {
        proPath,
        projectDir,   // full path, not basename
        proFile,
        target,
        qtModules,
        defines
    };
}
