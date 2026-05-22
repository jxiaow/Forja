import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

export function logsDir(workspace: string): string {
    const tmpBase = process.env.TEMP || process.env.TMP || require('os').tmpdir();
    // Use a hash-like folder name based on workspace path to avoid collisions
    const folderName = workspace.replace(/[\\/:*?"<>|]/g, '_');
    return path.join(tmpBase, 'compilot-logs', folderName);
}

export function ensureLocalStateDir(workspace: string): void {
    fs.mkdirSync(logsDir(workspace), { recursive: true });
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
    executablePath?: string;
    logFile: string;
    startedAt: string;
}

export function runStatePath(workspace: string): string {
    return path.join(logsDir(workspace), 'run-state.json');
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

export function isExecutableRunning(executablePath: string): boolean {
    if (!executablePath) { return false; }
    if (path.resolve(executablePath) === path.resolve(process.execPath)) {
        return isProcessRunning(process.pid);
    }
    const exeName = path.basename(executablePath).toLowerCase();
    try {
        if (process.platform === 'win32') {
            const output = cp.execFileSync(
                'tasklist',
                ['/FI', `IMAGENAME eq ${path.basename(executablePath)}`, '/FO', 'CSV', '/NH'],
                { encoding: 'utf8', windowsHide: true }
            );
            return output.toLowerCase().includes(exeName);
        }

        const output = cp.execFileSync('ps', ['-axo', 'comm=,args='], { encoding: 'utf8' });
        const normalizedPath = executablePath.toLowerCase();
        return output.toLowerCase().split(/\r?\n/).some(line =>
            line.includes(normalizedPath) || path.basename(line.split(/\s+/)[0] || '') === exeName
        );
    } catch {
        return false;
    }
}

export function isRunStateRunning(state: RunState): boolean {
    if (state.executablePath && isExecutableRunning(state.executablePath)) {
        return true;
    }
    return isProcessRunning(state.pid);
}
