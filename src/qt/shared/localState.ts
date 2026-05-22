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
    launcherPid?: number;
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
    if (pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function parseCsvLine(line: string): string[] {
    const values: string[] = [];
    const quotedPattern = /"([^"]*)"/g;
    let match: RegExpExecArray | null;

    while ((match = quotedPattern.exec(line)) !== null) {
        values.push(match[1]);
    }

    if (values.length > 0) {
        return values;
    }

    return line.split(',').map(value => value.trim());
}

function parsePid(value: string): number | null {
    const pid = Number.parseInt(value, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function normalizeExecutablePath(executablePath: string): string {
    return path.resolve(executablePath).toLowerCase();
}

function executableName(executablePath: string): string {
    return path.basename(path.win32.basename(executablePath));
}

function parsePowerShellPids(output: string): number[] {
    return output
        .split(/\r?\n/)
        .map(line => parsePid(line.trim()))
        .filter((pid): pid is number => pid !== null);
}

export function parseTasklistPids(output: string, executablePath: string): number[] {
    const exeName = executableName(executablePath).toLowerCase();
    const pids: number[] = [];

    for (const line of output.split(/\r?\n/)) {
        const fields = parseCsvLine(line);
        if (fields.length < 2 || fields[0].toLowerCase() !== exeName) {
            continue;
        }

        const pid = parsePid(fields[1]);
        if (pid !== null) {
            pids.push(pid);
        }
    }

    return pids;
}

export function parsePsPids(output: string, executablePath: string): number[] {
    const normalizedPath = normalizeExecutablePath(executablePath);
    const exeName = executableName(executablePath).toLowerCase();
    const pids: number[] = [];

    for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const match = /^(\d+)\s+(\S+)(?:\s+(.*))?$/.exec(trimmed);
        if (!match) {
            continue;
        }

        const pid = parsePid(match[1]);
        if (pid === null) {
            continue;
        }

        const command = match[2];
        const args = match[3] || '';
        const commandName = executableName(command).toLowerCase();
        const haystack = `${command} ${args}`.toLowerCase();
        if (haystack.includes(normalizedPath) || commandName === exeName) {
            pids.push(pid);
        }
    }

    return pids;
}

function findWindowsExecutablePids(executablePath: string): number[] {
    const exeName = executableName(executablePath);
    const escapedPath = executablePath.replace(/'/g, "''").toLowerCase();
    const command = [
        `$target='${escapedPath}'; Get-CimInstance Win32_Process -Filter "Name = '${exeName.replace(/'/g, "''")}'"`,
        'Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant() -eq $target }',
        'ForEach-Object { $_.ProcessId }'
    ].join(' | ');

    try {
        const output = cp.execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', command],
            { encoding: 'utf8', windowsHide: true }
        );
        const pids = parsePowerShellPids(output);
        if (pids.length > 0) {
            return pids;
        }
    } catch {
        // Fallback to tasklist below when PowerShell/CIM is unavailable.
    }

    const output = cp.execFileSync(
        'tasklist',
        ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', windowsHide: true }
    );
    return parseTasklistPids(output, executablePath);
}

export function findExecutablePids(executablePath: string): number[] {
    if (!executablePath) {
        return [];
    }

    if (path.resolve(executablePath) === path.resolve(process.execPath)) {
        return [process.pid];
    }

    try {
        if (process.platform === 'win32') {
            return findWindowsExecutablePids(executablePath);
        }

        const output = cp.execFileSync('ps', ['-axo', 'pid=,comm=,args='], { encoding: 'utf8' });
        return parsePsPids(output, executablePath);
    } catch {
        return [];
    }
}

export function isExecutableRunning(executablePath: string): boolean {
    return findExecutablePids(executablePath).length > 0;
}

export function isRunStateRunning(state: RunState): boolean {
    if (state.executablePath && isExecutableRunning(state.executablePath)) {
        return true;
    }
    return isProcessRunning(state.pid);
}
