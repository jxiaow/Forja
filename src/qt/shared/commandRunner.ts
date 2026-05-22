import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CliResult } from '../cli/types';
import { ensureLocalStateDir, findExecutablePids, logsDir, runLogPath, writeRunState } from './localState';
import { parseRuntimeLibPaths, resolveRuntimeTarget } from './runtimeTarget';

function logFileFor(workspace: string, action: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(logsDir(workspace), `${stamp}-${action}.log`);
}

/** Clean up stale .bat/.vbs launcher scripts from previous detach runs */
function cleanDetachScripts(dir: string): void {
    try {
        if (!fs.existsSync(dir)) { return; }
        for (const entry of fs.readdirSync(dir)) {
            if (entry.endsWith('.bat') || entry.endsWith('.vbs')) {
                try { fs.unlinkSync(path.join(dir, entry)); } catch { /* stale file, ignore */ }
            }
        }
    } catch { /* dir read failure, non-critical */ }
}

/**
 * On Windows, prepend `chcp 65001` to force UTF-8 console output from MSVC/jom.
 * Without this, Chinese characters in warnings/errors appear garbled because
 * MSVC outputs GBK (code page 936) but Node.js reads as UTF-8.
 */
function wrapForUtf8(commandLine: string): string {
    if (process.platform === 'win32') {
        return `chcp 65001 >nul && ${commandLine}`;
    }
    return commandLine;
}

function execute(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.exec(wrapForUtf8(commandLine), { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            let exitCode = 0;
            if (error) {
                const execError = error as cp.ExecException;
                if (typeof execError.code === 'number') {
                    exitCode = execError.code;
                } else if (execError.signal) {
                    exitCode = 128;
                } else {
                    exitCode = 1;
                }
            }
            resolve({ exitCode, stdout, stderr });
        });
    });
}

/**
 * Streaming execute: uses cp.exec but pipes stdout/stderr to the current process in real-time.
 */
function executeStreaming(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        const child = cp.exec(wrapForUtf8(commandLine), { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk: string) => {
            stdout += chunk;
            process.stdout.write(chunk);
        });

        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
            process.stderr.write(chunk);
        });

        child.on('close', (code) => {
            resolve({ exitCode: code ?? 0, stdout, stderr });
        });

        child.on('error', (err) => {
            resolve({ exitCode: 1, stdout, stderr: stderr + err.message });
        });
    });
}

function shellQuote(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveDetachedRunPid(
    executablePath: string | undefined,
    launcherPid: number,
    previousPids: number[]
): Promise<number> {
    if (!executablePath) {
        return launcherPid;
    }

    const previous = new Set(previousPids);
    const deadline = Date.now() + 2000;

    do {
        const currentPids = findExecutablePids(executablePath);
        const newPid = currentPids.find(pid => !previous.has(pid));
        if (newPid) {
            return newPid;
        }
        await delay(100);
    } while (Date.now() < deadline);

    return launcherPid;
}

export function buildRunCommand(project: string, mode: string, arch: string): string | null {
    const runtimeTarget = resolveRuntimeTarget(path.dirname(project), mode, arch);
    if (!runtimeTarget) {
        return null;
    }

    if (process.platform === 'win32') {
        return shellQuote(runtimeTarget.exePath);
    }

    const libraryPaths = parseRuntimeLibPaths(path.dirname(project));
    if (libraryPaths.length === 0) {
        return shellQuote(runtimeTarget.exePath);
    }

    return `export LD_LIBRARY_PATH=${shellQuote(`${libraryPaths.join(':')}:$LD_LIBRARY_PATH`)} && ${shellQuote(runtimeTarget.exePath)}`;
}

/**
 * Extract error lines from compiler output (MSVC and GCC patterns).
 */
function extractErrors(output: string): string[] {
    const lines = output.split(/\r?\n/);
    const errorPattern = /\): error |: error:|: fatal error |: fatal error:/i;
    const errors = lines.filter(line => errorPattern.test(line));
    // Limit to 20 error lines to avoid token bloat
    return errors.slice(0, 20);
}

/**
 * Summarize warnings from compiler output: deduplicate by warning code and return counts.
 * Returns a compact summary like "C4819 x 47, C4068 x 3, C4189 x 2"
 */
export function summarizeWarnings(output: string): { total: number; summary: string } {
    const lines = output.split(/\r?\n/);
    const warningPattern = /warning (C\d+|#\d+|-W[\w-]+)|: warning:/i;
    const codePattern = /warning (C\d+|#\d+|-W[\w-]+)/i;
    const counts = new Map<string, number>();
    let total = 0;

    for (const line of lines) {
        if (!warningPattern.test(line)) { continue; }
        total++;
        const match = codePattern.exec(line);
        const code = match ? match[1] : 'other';
        counts.set(code, (counts.get(code) || 0) + 1);
    }

    if (total === 0) { return { total: 0, summary: '' }; }

    // Sort by count descending, take top 5
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const parts = sorted.map(([code, count]) => `${code} x ${count}`);
    if (counts.size > 5) { parts.push(`+${counts.size - 5} others`); }
    return { total, summary: parts.join(', ') };
}

export interface RunOptions {
    /** When true, pipes stdout/stderr to the terminal in real-time */
    streaming?: boolean;
    /** When true, launches commands detached with output to log file. For run: builds first then detaches exe. For build/clean/rebuild: detaches entire command sequence. */
    detach?: boolean;
}

export async function runCliResult(result: CliResult, options?: RunOptions): Promise<CliResult> {
    if (!result.ok || result.mode === 'dryRun' || result.commands.length === 0) {
        return result;
    }

    const started = Date.now();
    const commandParts = [...result.commands];

    // stop is always synchronous — detach makes no sense for a kill command
    const effectiveDetach = options?.detach && result.action !== 'stop';

    // Detach mode for run: build first, then launch exe separately
    if (effectiveDetach && result.action === 'run' && commandParts.length > 1) {
        const buildCommands = commandParts.slice(0, -1);
        const runCommand = commandParts[commandParts.length - 1];

        // Execute build commands
        const buildLine = buildCommands.join(' && ');
        const exec = options.streaming ? executeStreaming : execute;
        const buildResult = await exec(buildLine, result.workspace);

        if (buildResult.exitCode !== 0) {
            const durationMs = Date.now() - started;
            ensureLocalStateDir(result.workspace);
            const filePath = logFileFor(result.workspace, result.action);
            fs.writeFileSync(filePath, [`$ ${buildLine}`, '', buildResult.stdout, buildResult.stderr].join('\n'), 'utf8');
            const combinedOutput = buildResult.stdout + '\n' + buildResult.stderr;
            const ws = summarizeWarnings(combinedOutput);
            return {
                ...result,
                ok: false,
                exitCode: buildResult.exitCode,
                durationMs,
                stdout: buildResult.stdout,
                stderr: buildResult.stderr,
                errors: extractErrors(combinedOutput),
                warningSummary: ws.total > 0 ? ws : undefined,
                logFile: filePath,
                commands: commandParts,
                diagnostics: [...result.diagnostics, { level: 'error', message: '编译失败' }]
            };
        }

        // Launch exe detached with output to log file
        ensureLocalStateDir(result.workspace);
        const logFile = runLogPath(result.workspace);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        cleanDetachScripts(path.dirname(logFile));

        const cwd = result.project ? path.dirname(result.project) : result.workspace;
        const isWin = process.platform === 'win32';
        const previousExecutablePids = result.executablePath ? findExecutablePids(result.executablePath) : [];

        let child: cp.ChildProcess;
        if (isWin) {
            // Use VBScript to launch without visible console window
            const batFile = path.join(path.dirname(logFile), 'run.bat');
            const vbsFile = path.join(path.dirname(logFile), 'run.vbs');
            fs.writeFileSync(batFile, `@echo off\r\ncd /d "${cwd}"\r\n${runCommand} >"${logFile}" 2>&1\r\n`, 'utf8');
            fs.writeFileSync(vbsFile, `CreateObject("Wscript.Shell").Run "cmd /c ""${batFile}""", 0, False\r\n`, 'utf8');
            child = cp.spawn('wscript', [vbsFile], {
                cwd,
                detached: true,
                windowsHide: true,
                stdio: 'ignore'
            });
        } else {
            child = cp.spawn('/bin/sh', ['-c', `cd "${cwd}" && ${runCommand} >"${logFile}" 2>&1 &`], {
                cwd,
                detached: true,
                stdio: 'ignore'
            });
        }
        child.unref();

        const launcherPid = child.pid || 0;
        const pid = await resolveDetachedRunPid(result.executablePath, launcherPid, previousExecutablePids);
        writeRunState(result.workspace, {
            pid,
            launcherPid,
            exePath: runCommand,
            executablePath: result.executablePath,
            logFile,
            startedAt: new Date().toISOString()
        });

        const durationMs = Date.now() - started;
        return {
            ...result,
            ok: true,
            exitCode: 0,
            durationMs,
            stdout: buildResult.stdout,
            stderr: '',
            logFile,
            commands: commandParts,
            diagnostics: [{ level: 'info', message: `程序已后台启动 (PID: ${pid})，日志: ${logFile}` }]
        };
    }

    // Detach mode for build/clean/rebuild: run entire command sequence in background
    if (effectiveDetach && result.action !== 'run' && commandParts.length > 0) {
        ensureLocalStateDir(result.workspace);
        const logFile = logFileFor(result.workspace, result.action);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        cleanDetachScripts(path.dirname(logFile));

        const commandLine = commandParts.join(' && ');
        const cwd = result.project ? path.dirname(result.project) : result.workspace;
        const isWin = process.platform === 'win32';

        let child: cp.ChildProcess;
        if (isWin) {
            const batFile = path.join(path.dirname(logFile), `${result.action}.bat`);
            const vbsFile = path.join(path.dirname(logFile), `${result.action}.vbs`);
            fs.writeFileSync(batFile, `@echo off\r\ncd /d "${cwd}"\r\n${commandLine} >"${logFile}" 2>&1\r\n`, 'utf8');
            fs.writeFileSync(vbsFile, `CreateObject("Wscript.Shell").Run "cmd /c ""${batFile}""", 0, False\r\n`, 'utf8');
            child = cp.spawn('wscript', [vbsFile], {
                cwd,
                detached: true,
                windowsHide: true,
                stdio: 'ignore'
            });
        } else {
            child = cp.spawn('/bin/sh', ['-c', `cd "${cwd}" && ${commandLine} >"${logFile}" 2>&1 &`], {
                cwd,
                detached: true,
                stdio: 'ignore'
            });
        }
        child.unref();

        const pid = child.pid || 0;
        const durationMs = Date.now() - started;
        return {
            ...result,
            ok: true,
            exitCode: null,
            durationMs,
            logFile,
            commands: commandParts,
            diagnostics: [{ level: 'info', message: `${result.action} 已后台启动 (PID: ${pid})，日志: ${logFile}` }]
        };
    }

    // Normal mode: execute all commands together
    const commandLine = commandParts.join(' && ');
    const exec = options?.streaming ? executeStreaming : execute;
    const executed = await exec(commandLine, result.workspace);
    const durationMs = Date.now() - started;
    ensureLocalStateDir(result.workspace);
    const filePath = logFileFor(result.workspace, result.action);
    fs.writeFileSync(filePath, [
        `$ ${commandLine}`,
        '',
        executed.stdout,
        executed.stderr
    ].join('\n'), 'utf8');

    const errors = executed.exitCode !== 0
        ? extractErrors(executed.stdout + '\n' + executed.stderr)
        : [];

    const warningSummary = executed.exitCode !== 0
        ? summarizeWarnings(executed.stdout + '\n' + executed.stderr)
        : undefined;

    return {
        ...result,
        ok: executed.exitCode === 0,
        exitCode: executed.exitCode,
        durationMs,
        stdout: executed.stdout,
        stderr: executed.stderr,
        errors,
        warningSummary: warningSummary && warningSummary.total > 0 ? warningSummary : undefined,
        logFile: filePath,
        commands: commandParts,
        diagnostics: executed.exitCode === 0
            ? result.diagnostics
            : [
                ...result.diagnostics,
                {
                    level: 'error',
                    message: '命令执行失败'
                }
            ]
    };
}
