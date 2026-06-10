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
 * 将系统 locale 编码（中文系统 = GBK）的 Buffer 解码为 UTF-8 字符串。
 * MSVC/jom 输出使用系统默认代码页（无需 chcp 65001），
 * Node.js 直接读会乱码，此处先按 GBK 解码。
 */
function decodeWinOutput(buffer: Buffer): string {
    try {
        return new TextDecoder('gbk', { fatal: false }).decode(buffer);
    } catch {
        // TextDecoder 不支持 gbk 时退回 UTF-8
        return buffer.toString('utf-8');
    }
}

/**
 * No-op wrapper kept for compatibility (previously set chcp 65001).
 * MSVC/jom output encoding is handled by decodeWinOutput using the system
 * locale encoding (e.g. GBK on zh-CN systems).
 */
function wrapForUtf8(commandLine: string): string {
    return commandLine;
}

function execute(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.exec(wrapForUtf8(commandLine), { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' }, (error, stdout, stderr) => {
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
            const decodedStdout = process.platform === 'win32' ? decodeWinOutput(stdout) : stdout.toString('utf-8');
            const decodedStderr = process.platform === 'win32' ? decodeWinOutput(stderr) : stderr.toString('utf-8');
            resolve({ exitCode, stdout: decodedStdout, stderr: decodedStderr });
        });
    });
}

/**
 * Streaming execute: uses cp.exec but pipes stdout/stderr to the current process in real-time.
 */
function executeStreaming(commandLine: string, cwd: string, executablePath?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        const child = cp.exec(wrapForUtf8(commandLine), { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' });

        let stdout = '';
        let stderr = '';
        const isWin = process.platform === 'win32';

        const onInterrupt = (): void => {
            terminateExecutable(executablePath);
            try { child.kill(); } catch { /* child may already be closed */ }
        };
        const cleanupSignalHandlers = (): void => {
            process.off('SIGINT', onInterrupt);
            process.off('SIGTERM', onInterrupt);
        };

        if (executablePath) {
            process.on('SIGINT', onInterrupt);
            process.on('SIGTERM', onInterrupt);
        }

        child.stdout?.on('data', (chunk: Buffer) => {
            const text = isWin ? decodeWinOutput(chunk) : chunk.toString('utf-8');
            stdout += text;
            process.stdout.write(text);
        });

        child.stderr?.on('data', (chunk: Buffer) => {
            const text = isWin ? decodeWinOutput(chunk) : chunk.toString('utf-8');
            stderr += text;
            process.stderr.write(text);
        });

        child.on('close', (code) => {
            cleanupSignalHandlers();
            resolve({ exitCode: code ?? 0, stdout, stderr });
        });

        child.on('error', (err) => {
            cleanupSignalHandlers();
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
    previousPids: number[]
): Promise<number | null> {
    if (!executablePath) {
        return null;
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

    return null;
}

function terminateExecutable(executablePath: string | undefined): void {
    if (!executablePath) {
        return;
    }

    const pids = findExecutablePids(executablePath);
    for (const pid of pids) {
        try {
            if (process.platform === 'win32') {
                cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
            } else {
                process.kill(pid, 'SIGTERM');
            }
        } catch {
            // Process may have already exited.
        }
    }
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

        // Write build log (both on success and failure)
        ensureLocalStateDir(result.workspace);
        const buildLogFilePath = logFileFor(result.workspace, 'build');
        fs.writeFileSync(buildLogFilePath, [`$ ${buildLine}`, '', buildResult.stdout, buildResult.stderr].join('\n'), 'utf8');
        const combinedOutput = buildResult.stdout + '\n' + buildResult.stderr;
        const ws = summarizeWarnings(combinedOutput);

        if (buildResult.exitCode !== 0) {
            const durationMs = Date.now() - started;
            return {
                ...result,
                ok: false,
                exitCode: buildResult.exitCode,
                durationMs,
                stdout: buildResult.stdout,
                stderr: buildResult.stderr,
                errors: extractErrors(combinedOutput),
                warningSummary: ws.total > 0 ? ws : undefined,
                logFile: buildLogFilePath,
                buildLogFile: buildLogFilePath,
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
            // 在 bat 中设置 PATH 让 Qt DLL 和 .qm 文件可被加载
            const envSetup = result.resolved?.qtPath
                ? 'set "PATH=' + result.resolved.qtPath + '\\bin;%PATH%"\r\n'
                : '';
            fs.writeFileSync(batFile, `@echo off\r\n${envSetup}cd /d "${cwd}"\r\n${runCommand} >"${logFile}" 2>&1\r\n`, 'utf8');
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

        const pid = await resolveDetachedRunPid(result.executablePath, previousExecutablePids);
        writeRunState(result.workspace, {
            pid: pid || 0,
            exePath: runCommand,
            executablePath: result.executablePath,
            logFile,
            startedAt: new Date().toISOString()
        });

        const durationMs = Date.now() - started;
        if (!pid) {
            return {
                ...result,
                ok: false,
                exitCode: 1,
                durationMs,
                stdout: buildResult.stdout,
                stderr: '',
                logFile,
                commands: commandParts,
                diagnostics: [
                    ...result.diagnostics,
                    {
                        level: 'error',
                        message: '程序已请求后台启动，但未能在超时时间内获取目标进程 PID'
                    }
                ]
            };
        }

        return {
            ...result,
            ok: true,
            exitCode: 0,
            durationMs,
            stdout: buildResult.stdout,
            stderr: '',
            logFile,
            buildLogFile: buildLogFilePath,
            warningSummary: ws.total > 0 ? ws : undefined,
            pid,
            commands: commandParts,
            diagnostics: [
                { level: 'info', message: `编译日志: ${buildLogFilePath}` },
                { level: 'info', message: `程序已后台启动 (PID: ${pid})，日志: ${logFile}` }
            ]
        };
    }

    // Foreground run: build first, then start the app. Once the build succeeds,
    // the app exiting later is normal user/runtime behavior, not a Forja failure.
    if (!effectiveDetach && result.action === 'run' && commandParts.length > 1) {
        const buildCommands = commandParts.slice(0, -1);
        const runCommand = commandParts[commandParts.length - 1];
        const buildLine = buildCommands.join(' && ');
        const exec = options?.streaming ? executeStreaming : execute;
        const buildResult = await exec(buildLine, result.workspace);
        const buildOutput = buildResult.stdout + '\n' + buildResult.stderr;
        const ws = summarizeWarnings(buildOutput);

        ensureLocalStateDir(result.workspace);
        const filePath = logFileFor(result.workspace, result.action);

        if (buildResult.exitCode !== 0) {
            const durationMs = Date.now() - started;
            fs.writeFileSync(filePath, [`$ ${buildLine}`, '', buildResult.stdout, buildResult.stderr].join('\n'), 'utf8');
            return {
                ...result,
                ok: false,
                exitCode: buildResult.exitCode,
                durationMs,
                stdout: buildResult.stdout,
                stderr: buildResult.stderr,
                errors: extractErrors(buildOutput),
                warningSummary: ws.total > 0 ? ws : undefined,
                logFile: filePath,
                commands: commandParts,
                diagnostics: [...result.diagnostics, { level: 'error', message: '编译失败' }]
            };
        }

        const runResult = await exec(runCommand, result.project ? path.dirname(result.project) : result.workspace, result.executablePath);
        const durationMs = Date.now() - started;
        fs.writeFileSync(filePath, [
            `$ ${buildLine}`,
            '',
            buildResult.stdout,
            buildResult.stderr,
            `$ ${runCommand}`,
            '',
            runResult.stdout,
            runResult.stderr
        ].join('\n'), 'utf8');

        return {
            ...result,
            ok: true,
            exitCode: 0,
            durationMs,
            stdout: buildResult.stdout + runResult.stdout,
            stderr: buildResult.stderr + runResult.stderr,
            errors: [],
            warningSummary: ws.total > 0 ? ws : undefined,
            logFile: filePath,
            commands: commandParts,
            runtimeExitCode: runResult.exitCode,
            diagnostics: runResult.exitCode === 0
                ? result.diagnostics
                : [...result.diagnostics, { level: 'warning', message: `程序已退出 (退出码: ${runResult.exitCode})` }]
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
    const executed = options?.streaming
        ? await executeStreaming(commandLine, result.workspace, result.action === 'run' ? result.executablePath : undefined)
        : await execute(commandLine, result.workspace);
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
