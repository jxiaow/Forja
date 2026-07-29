import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PlatformRunExecutor, PlatformRunRequest, PlatformRunResult } from '../runExecutor';

interface DesktopRunStatus {
    pid?: number;
    exitCode?: number;
    errorCode?: number;
    stage?: string;
}

interface PipeCapture {
    pipePath: string;
    drained: Promise<void>;
    close(): void;
}

const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 30;
const STALE_REQUEST_AGE_MS = 60 * 60 * 1000;
const LAUNCHER_PREFIX = 'forja-desktop-launcher-';

export function shouldUseWindowsDesktopRun(
    env: NodeJS.ProcessEnv,
    ancestorProcessNames: string[] = []
): boolean {
    for (const processName of ancestorProcessNames) {
        const normalized = processName.toLowerCase();
        if (normalized === 'code.exe' || normalized === 'code - insiders.exe') { return false; }
        if (normalized === 'windowsterminal.exe') { return true; }
    }

    const inWindowsTerminal = !!(env.WT_SESSION || env.WT_PROFILE_ID);
    const inVsCodeTerminal = env.TERM_PROGRAM?.toLowerCase() === 'vscode';
    return inWindowsTerminal && !inVsCodeTerminal;
}

function readAncestorProcessNames(parentPid: number = process.ppid): string[] {
    const script = [
        `$forjaParentPid = ${parentPid}`,
        '$forjaProcesses = Get-CimInstance Win32_Process -ErrorAction Stop',
        'for ($forjaDepth = 0; $forjaDepth -lt 12 -and $forjaParentPid -gt 0; $forjaDepth++) {',
        '  $forjaProcess = $forjaProcesses | Where-Object ProcessId -eq $forjaParentPid | Select-Object -First 1',
        '  if (-not $forjaProcess) { break }',
        '  $forjaProcess.Name',
        '  $forjaParentPid = $forjaProcess.ParentProcessId',
        '}'
    ].join('\n');

    try {
        return cp.execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            { encoding: 'utf8', windowsHide: true, timeout: 5000 })
            .split(/\r?\n/)
            .map(name => name.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

export function parseDesktopRunStatus(text: string): DesktopRunStatus {
    const values = new Map<string, string>();
    for (const line of text.split(/\r?\n/)) {
        const separator = line.indexOf('=');
        if (separator > 0) {
            values.set(line.slice(0, separator), line.slice(separator + 1));
        }
    }

    const parseNumber = (key: string): number | undefined => {
        const value = values.get(key);
        if (value === undefined) { return undefined; }
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    return {
        pid: parseNumber('pid'),
        exitCode: parseNumber('exit'),
        errorCode: parseNumber('error'),
        stage: values.get('stage')
    };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function removeBestEffort(filePath: string): boolean {
    try { fs.unlinkSync(filePath); } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') { return true; }
        if (code === 'EACCES' || code === 'EPERM') { return false; }
        throw error;
    }
    return true;
}

const LAUNCHER_FILE_SUFFIXES = [
    '.request.tmp',
    '.environment',
    '.status.tmp',
    '.exe.done',
    '.request',
    '.status',
    '.exe'
] as const;

function launcherBaseName(fileName: string): string | undefined {
    const suffix = LAUNCHER_FILE_SUFFIXES.find(candidate => fileName.endsWith(candidate));
    return suffix ? fileName.slice(0, -suffix.length) : undefined;
}

function removeLauncherGroup(directory: string, baseName: string): void {
    const executablePath = path.join(directory, `${baseName}.exe`);
    if (!removeBestEffort(executablePath)) {
        // A running launcher keeps its executable locked on Windows. Its status
        // and environment files still belong to that active launch.
        return;
    }
    for (const suffix of LAUNCHER_FILE_SUFFIXES) {
        if (suffix !== '.exe') {
            removeBestEffort(path.join(directory, `${baseName}${suffix}`));
        }
    }
}

export function cleanStaleDesktopRunFiles(directory: string, now: number = Date.now()): void {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith(LAUNCHER_PREFIX) || !entry.name.endsWith('.exe.done')) {
            continue;
        }
        removeLauncherGroup(directory, entry.name.slice(0, -'.exe.done'.length));
    }

    const cutoff = now - STALE_REQUEST_AGE_MS;
    const groups = new Map<string, number>();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const baseName = entry.isFile() && entry.name.startsWith(LAUNCHER_PREFIX)
            ? launcherBaseName(entry.name)
            : undefined;
        if (!baseName) { continue; }
        try {
            const modified = fs.statSync(path.join(directory, entry.name)).mtimeMs;
            groups.set(baseName, Math.max(groups.get(baseName) ?? 0, modified));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
        }
    }
    for (const [baseName, newestModified] of groups) {
        if (newestModified < cutoff) {
            removeLauncherGroup(directory, baseName);
        }
    }
}

function createLineForwarder(onChunk: ((chunk: Buffer) => void) | undefined): {
    push(chunk: Buffer): void;
    flush(): void;
} {
    let pending = Buffer.alloc(0);
    return {
        push(chunk: Buffer): void {
            pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
            const lastNewline = pending.lastIndexOf(0x0a);
            if (lastNewline < 0) { return; }
            onChunk?.(pending.subarray(0, lastNewline + 1));
            pending = pending.subarray(lastNewline + 1);
        },
        flush(): void {
            if (pending.length > 0) {
                onChunk?.(pending);
                pending = Buffer.alloc(0);
            }
        }
    };
}

function createPipeCapture(pipePath: string, onChunk: ((chunk: Buffer) => void) | undefined): Promise<PipeCapture> {
    return new Promise((resolve, reject) => {
        const forwarder = createLineForwarder(onChunk);
        const server = net.createServer();
        let socket: net.Socket | undefined;
        let settled = false;
        let resolveDrained: (() => void) | undefined;
        let rejectDrained: ((error: Error) => void) | undefined;
        const drained = new Promise<void>((done, failed) => {
            resolveDrained = done;
            rejectDrained = failed;
        });
        const finish = (): void => {
            if (settled) { return; }
            settled = true;
            forwarder.flush();
            resolveDrained?.();
        };

        server.once('connection', connected => {
            socket = connected;
            server.close();
            connected.on('data', chunk => forwarder.push(chunk));
            connected.once('end', finish);
            connected.once('close', finish);
            connected.once('error', error => {
                if (!settled) {
                    settled = true;
                    rejectDrained?.(error);
                }
            });
        });
        server.once('error', reject);
        server.listen({ path: pipePath, readableAll: true, writableAll: true }, () => {
            resolve({
                pipePath,
                drained,
                close(): void {
                    socket?.destroy();
                    server.close();
                    finish();
                }
            });
        });
    });
}

function launchThroughDesktopExplorer(helperPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const explorerPath = path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe');
        const child = cp.spawn(explorerPath, [helperPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

function writeEnvironmentBlock(filePath: string, request: PlatformRunRequest): void {
    const environment = { ...process.env };
    const pathKey = Object.keys(environment).find(key => key.toUpperCase() === 'PATH') || 'PATH';
    if (request.qtPath) {
        environment[pathKey] = `${path.join(request.qtPath, 'bin')};${environment[pathKey] || ''}`;
    }
    const entries = Object.entries(environment)
        .filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].includes('\0') && !entry[1].includes('\0'))
        .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
        .map(([key, value]) => `${key}=${value}`);
    fs.writeFileSync(filePath, Buffer.from(`${entries.join('\0')}\0\0`, 'utf16le'));
}

function serializeRequest(request: PlatformRunRequest, files: {
    stdout: string;
    stderr: string;
    status: string;
    environment: string;
    outputMode: 'pipe' | 'file';
}): string {
    return [
        'protocol=2',
        `target=${request.executablePath}`,
        `cwd=${request.cwd}`,
        `stdout=${files.stdout}`,
        `stderr=${files.stderr}`,
        `status=${files.status}`,
        `environment=${files.environment}`,
        `outputMode=${files.outputMode}`,
        `detached=${request.detached ? '1' : '0'}`,
        ''
    ].join('\n');
}

async function executeDesktopRun(request: PlatformRunRequest): Promise<PlatformRunResult> {
    if (request.detached && !request.outputFile) {
        throw new Error('Detached Windows desktop launch requires an output file');
    }
    const packagedHelperPath = path.join(__dirname, 'forja-desktop-launcher.exe');
    if (!fs.existsSync(packagedHelperPath)) {
        throw new Error(`Forja desktop launcher is missing: ${packagedHelperPath}`);
    }

    const stateRoot = process.env.LOCALAPPDATA || os.tmpdir();
    const queueDir = path.join(stateRoot, 'Forja', 'desktop-launch');
    fs.mkdirSync(queueDir, { recursive: true });
    cleanStaleDesktopRunFiles(queueDir);

    const id = `${process.pid}-${crypto.randomUUID()}`;
    const requestBase = path.join(queueDir, `${LAUNCHER_PREFIX}${id}`);
    const launcherPath = `${requestBase}.exe`;
    const requestPath = `${requestBase}.request`;
    const requestTempPath = `${requestPath}.tmp`;
    const statusPath = `${requestBase}.status`;
    const environmentPath = `${requestBase}.environment`;
    let stdoutCapture: PipeCapture | undefined;
    let stderrCapture: PipeCapture | undefined;
    let pid: number | undefined;

    const outputMode = request.detached ? 'file' : 'pipe';
    const stdoutPath = request.detached && request.outputFile
        ? request.outputFile
        : `\\\\.\\pipe\\forja-${id}-stdout`;
    const stderrPath = request.detached && request.outputFile
        ? request.outputFile
        : `\\\\.\\pipe\\forja-${id}-stderr`;

    try {
        fs.copyFileSync(packagedHelperPath, launcherPath);
        writeEnvironmentBlock(environmentPath, request);
        if (!request.detached) {
            stdoutCapture = await createPipeCapture(stdoutPath, request.onStdout);
            try {
                stderrCapture = await createPipeCapture(stderrPath, request.onStderr);
            } catch (error) {
                stdoutCapture.close();
                throw error;
            }
        }

        fs.writeFileSync(requestTempPath, serializeRequest(request, {
            stdout: stdoutPath,
            stderr: stderrPath,
            status: statusPath,
            environment: environmentPath,
            outputMode
        }), 'utf8');
        fs.renameSync(requestTempPath, requestPath);
        await launchThroughDesktopExplorer(launcherPath);

        const startDeadline = Date.now() + START_TIMEOUT_MS;
        do {
            if (fs.existsSync(statusPath)) {
                const status = parseDesktopRunStatus(fs.readFileSync(statusPath, 'utf8'));
                if (status.errorCode !== undefined) {
                    const stage = status.stage ? ` at ${status.stage}` : '';
                    throw new Error(`Forja desktop launcher failed${stage} (Win32 error ${status.errorCode})`);
                }
                pid = status.pid;
            }
            if (!pid) { await delay(POLL_INTERVAL_MS); }
        } while (!pid && Date.now() < startDeadline);

        if (!pid) {
            throw new Error('Forja desktop launcher did not report the target PID within 10 seconds');
        }
        if (request.detached) {
            return { pid, exitCode: null };
        }

        while (true) {
            const status = parseDesktopRunStatus(fs.readFileSync(statusPath, 'utf8'));
            if (status.exitCode !== undefined) {
                await Promise.all([stdoutCapture!.drained, stderrCapture!.drained]);
                return { pid, exitCode: status.exitCode };
            }
            await delay(POLL_INTERVAL_MS);
        }
    } finally {
        stdoutCapture?.close();
        stderrCapture?.close();
        removeBestEffort(requestTempPath);
        removeBestEffort(requestPath);
        removeBestEffort(environmentPath);
        removeBestEffort(statusPath);
        if (!request.detached || !pid) {
            await delay(100);
            removeBestEffort(`${launcherPath}.done`);
            removeBestEffort(launcherPath);
        }
    }
}

export function createWindowsRunExecutor(
    env: NodeJS.ProcessEnv,
    ancestorProcessNames?: string[]
): PlatformRunExecutor | undefined {
    if (env.TERM_PROGRAM?.toLowerCase() === 'vscode') { return undefined; }
    if (env.WT_SESSION || env.WT_PROFILE_ID) { return { execute: executeDesktopRun }; }
    const ancestors = ancestorProcessNames ?? readAncestorProcessNames();
    return shouldUseWindowsDesktopRun(env, ancestors)
        ? { execute: executeDesktopRun }
        : undefined;
}
