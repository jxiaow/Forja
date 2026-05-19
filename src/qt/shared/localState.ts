import * as fs from 'fs';
import * as path from 'path';

export interface LocalCache {
    version: 1;
    updatedAt: string;
    detected: {
        qt: { path: string; qmake: string; version?: string; compiler?: string } | null;
        vs: { devShellPath: string; version?: string; edition?: string } | null;
        jom: string | null;
        projects: string[];
    };
}

export function localRoot(workspace: string): string {
    return path.join(workspace, '.compilot');
}

export function cachePath(workspace: string): string {
    return path.join(localRoot(workspace), 'cache.json');
}

export function logsDir(workspace: string): string {
    const tmpBase = process.env.TEMP || process.env.TMP || require('os').tmpdir();
    // Use a hash-like folder name based on workspace path to avoid collisions
    const folderName = workspace.replace(/[\\/:*?"<>|]/g, '_');
    return path.join(tmpBase, 'compilot-logs', folderName);
}

export function ensureLocalStateDir(workspace: string): void {
    fs.mkdirSync(localRoot(workspace), { recursive: true });
    fs.mkdirSync(logsDir(workspace), { recursive: true });
}

export function readLocalCache(workspace: string): LocalCache | null {
    return readJson<LocalCache>(cachePath(workspace));
}

export function writeLocalCache(workspace: string, cache: LocalCache): void {
    writeJson(cachePath(workspace), cache);
}

export function ensureCompilotGitignored(workspace: string): void {
    const gitignorePath = path.join(workspace, '.gitignore');
    let lines: string[] = [];

    try {
        lines = fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/);
    } catch { /* file not found OK */ }

    const otherLines = lines.filter(line =>
        line.trim() !== '.compilot/' && line.trim() !== '.qtpilot/'
    );
    otherLines.push('.compilot/');
    fs.mkdirSync(path.dirname(gitignorePath), { recursive: true });
    fs.writeFileSync(gitignorePath, `${otherLines.join('\n')}\n`, 'utf8');
}

function readJson<T>(filePath: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    } catch { /* parse failure returns null */ }
    return null;
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// ── Run state (detach mode) ──

export interface RunState {
    pid: number;
    exePath: string;
    logFile: string;
    startedAt: string;
}

export function runStatePath(workspace: string): string {
    return path.join(localRoot(workspace), 'run-state.json');
}

export function runLogPath(workspace: string): string {
    return path.join(logsDir(workspace), 'run.log');
}

export function readRunState(workspace: string): RunState | null {
    return readJson<RunState>(runStatePath(workspace));
}

export function writeRunState(workspace: string, state: RunState): void {
    writeJson(runStatePath(workspace), state);
}

export function clearRunState(workspace: string): void {
    try { fs.unlinkSync(runStatePath(workspace)); } catch { /* file not found OK */ }
}

export function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
