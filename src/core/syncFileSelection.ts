import * as path from 'path';
import * as fs from 'fs';

function normalizeRelative(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function isPathInside(parentDir: string, childPath: string): boolean {
    const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isGlobPattern(s: string): boolean {
    return /[*?\[]/.test(s);
}

export function globToRegex(glob: string): RegExp {
    let regex = '';
    let i = 0;
    while (i < glob.length) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                regex += '.*';
                i += 2;
                if (glob[i] === '/') { i++; }
            } else {
                regex += '[^/]*';
                i++;
            }
        } else if (c === '?') {
            regex += '[^/]';
            i++;
        } else if (c === '[') {
            const end = glob.indexOf(']', i + 1);
            if (end === -1) {
                regex += '\\[';
                i++;
            } else {
                regex += glob.slice(i, end + 1);
                i = end + 1;
            }
        } else if ('.+^$()|{}\\'.includes(c)) {
            regex += '\\' + c;
            i++;
        } else {
            regex += c;
            i++;
        }
    }
    return new RegExp('^' + regex + '$');
}

function walkDir(dir: string, baseDir: string): string[] {
    const results: string[] = [];
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const rel = path.relative(baseDir, full).replace(/\\/g, '/');
            if (entry.isDirectory()) {
                results.push(...walkDir(full, baseDir));
            } else {
                results.push(rel);
            }
        }
    } catch { /* ignore read errors */ }
    return results;
}

function expandGlobInDir(baseDir: string, glob: string): string[] {
    if (!fs.existsSync(baseDir)) { return []; }
    const regex = globToRegex(glob);
    const allFiles = walkDir(baseDir, baseDir);
    return allFiles.filter(f => regex.test(f));
}

export interface ResolveResult {
    files: string[];
    hasUnmatchedGlob: boolean;
}

export function resolveRequestedFilesForGitRoot(gitRoot: string, workspaceRoot: string, requestedFiles: string[]): string[] {
    const result = resolveRequestedFilesForGitRootDetailed(gitRoot, workspaceRoot, requestedFiles);
    return result.files;
}

export function resolveRequestedFilesForGitRootDetailed(gitRoot: string, workspaceRoot: string, requestedFiles: string[]): ResolveResult {
    const results: string[] = [];
    const gitAbs = path.resolve(gitRoot);
    const workspaceAbs = path.resolve(workspaceRoot);
    let hasUnmatchedGlob = false;

    for (const requested of requestedFiles) {
        const trimmed = requested.trim();
        if (!trimmed) { continue; }

        if (isGlobPattern(trimmed) && !path.isAbsolute(trimmed)) {
            const globBase = trimmed.split(/[*?\[]/)[0].replace(/\/+$/, '');
            const globPattern = trimmed.slice(globBase.length).replace(/^\//, '');
            const searchDir = path.resolve(workspaceAbs, globBase || '.');

            if (!isPathInside(gitAbs, searchDir) && !isPathInside(searchDir, gitAbs)) { continue; }

            const expanded = expandGlobInDir(searchDir, globPattern || '*');
            const matched: string[] = [];

            for (const rel of expanded) {
                const absFile = path.resolve(searchDir, rel);
                if (!isPathInside(gitAbs, absFile)) { continue; }
                const gitRel = normalizeRelative(path.relative(gitAbs, absFile));
                if (gitRel && !results.includes(gitRel) && !matched.includes(gitRel)) {
                    matched.push(gitRel);
                }
            }

            if (matched.length === 0) {
                hasUnmatchedGlob = true;
            }
            results.push(...matched);
            continue;
        }

        const candidates = path.isAbsolute(trimmed)
            ? [path.resolve(trimmed)]
            : [path.resolve(workspaceAbs, trimmed), path.resolve(gitAbs, trimmed)];

        for (let i = 0; i < candidates.length; i++) {
            if (!isPathInside(gitAbs, candidates[i])) { continue; }
            if (i > 0 && !fs.existsSync(candidates[i])) { continue; }
            const relative = normalizeRelative(path.relative(gitAbs, candidates[i]));
            if (relative && !results.includes(relative)) {
                results.push(relative);
            }
            break;
        }
    }

    return { files: results, hasUnmatchedGlob };
}
