import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CliResult } from '../cli/types';
import type { PlatformRunExecutor } from '../platform/runExecutor';
import { ensureLocalStateDir, findExecutablePids, logsDir, runLogPath, writeRunState } from './localState';
import { parseRuntimeLibPaths, resolveRuntimeTarget } from './runtimeTarget';

function logFileFor(workspace: string, action: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(logsDir(workspace), `${stamp}-${action}.log`);
}

function resolveProjectCwd(result: CliResult): string {
    if (!result.project) { return result.workspace; }
    const projectPath = path.isAbsolute(result.project)
        ? result.project
        : path.resolve(result.workspace, result.project);
    return path.dirname(projectPath);
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
 * 将子进程输出的 Buffer 解码为字符串。
 * 优先尝试 UTF-8（MSBuild 等现代工具），失败则退回 GBK（传统 cmd/jom 等）。
 */
function decodeWinOutput(buffer: Buffer): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        // Not valid UTF-8 — fall back to GBK for legacy Windows tools
        try {
            return new TextDecoder('gbk', { fatal: false }).decode(buffer);
        } catch {
            return buffer.toString('utf-8');
        }
    }
}

/**
 * Extract `set "PATH=...;%PATH%"` commands and return a modified env object.
 * On Windows, %PATH% expansion inside cmd.exe inflates the effective command
 * line length far beyond the JS string length, hitting the ~8191 char limit.
 * Moving PATH into the child process env eliminates this inflation entirely.
 */
function extractPathEnv(commands: string[]): { filtered: string[]; env?: NodeJS.ProcessEnv } {
    if (process.platform !== 'win32') {
        return { filtered: commands };
    }
    const pathValues: string[] = [];
    const filtered = commands.filter(cmd => {
        const m = cmd.match(/^set\s+"PATH=(.+);%PATH%"$/);
        if (m) {
            pathValues.push(m[1]);
            return false;
        }
        return true;
    });
    if (pathValues.length === 0) {
        return { filtered };
    }
    const currentPath = process.env.PATH || '';
    return {
        filtered,
        env: { ...process.env, PATH: [...pathValues, currentPath].join(';') }
    };
}

function execute(commandLine: string, cwd: string, suppressedWarnings?: string[], env?: NodeJS.ProcessEnv): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.exec(commandLine, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer', env }, (error, stdout, stderr) => {
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
            const decodedStdout = filterBuildOutput(process.platform === 'win32' ? decodeWinOutput(stdout) : stdout.toString('utf-8'), suppressedWarnings);
            const decodedStderr = filterBuildOutput(process.platform === 'win32' ? decodeWinOutput(stderr) : stderr.toString('utf-8'), suppressedWarnings);
            resolve({ exitCode, stdout: decodedStdout, stderr: decodedStderr });
        });
    });
}

/**
 * Streaming execute: uses cp.exec but pipes stdout/stderr to the current process in real-time.
 */
function executeStreaming(commandLine: string, cwd: string, executablePath?: string, suppressedWarnings?: string[], env?: NodeJS.ProcessEnv): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        const child = cp.exec(commandLine, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'buffer', env });

        let stdout = '';
        let stderr = '';
        let interrupted = false;
        const isWin = process.platform === 'win32';

        const onInterrupt = (): void => {
            interrupted = true;
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
            const text = filterBuildOutput(isWin ? decodeWinOutput(chunk) : chunk.toString('utf-8'), suppressedWarnings);
            stdout += text;
            process.stdout.write(text);
        });

        child.stderr?.on('data', (chunk: Buffer) => {
            const text = filterBuildOutput(isWin ? decodeWinOutput(chunk) : chunk.toString('utf-8'), suppressedWarnings);
            stderr += text;
            process.stderr.write(text);
        });

        child.on('close', (code) => {
            cleanupSignalHandlers();
            resolve({ exitCode: interrupted ? 0 : (code ?? 0), stdout, stderr });
        });

        child.on('error', (err) => {
            cleanupSignalHandlers();
            resolve({ exitCode: interrupted ? 0 : 1, stdout, stderr: stderr + err.message });
        });
    });
}

async function executeWithPlatformRunner(
    executor: PlatformRunExecutor,
    executablePath: string,
    cwd: string,
    qtPath: string | undefined,
    streaming: boolean,
    suppressedWarnings?: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string; pid: number }> {
    let stdout = '';
    let stderr = '';
    let interrupted = false;

    const onInterrupt = (): void => {
        interrupted = true;
        terminateExecutable(executablePath);
    };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);

    try {
        const launched = await executor.execute({
            executablePath,
            cwd,
            qtPath,
            detached: false,
            onStdout: chunk => {
                const text = filterBuildOutput(decodeWinOutput(chunk), suppressedWarnings);
                stdout += text;
                if (streaming) { process.stdout.write(text); }
            },
            onStderr: chunk => {
                const text = filterBuildOutput(decodeWinOutput(chunk), suppressedWarnings);
                stderr += text;
                if (streaming) { process.stderr.write(text); }
            }
        });
        return {
            exitCode: interrupted ? 0 : (launched.exitCode ?? 0),
            stdout,
            stderr,
            pid: launched.pid
        };
    } finally {
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onInterrupt);
    }
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
    const deadline = Date.now() + 5000;

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

export function terminateExecutable(executablePath: string | undefined): void {
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

export function buildRunCommand(project: string, mode: string, arch: string, qtPath?: string): string | null {
    const runtimeTarget = resolveRuntimeTarget(path.dirname(project), mode, arch);
    if (!runtimeTarget) {
        return null;
    }

    if (process.platform === 'win32') {
        if (qtPath) {
            return `set "PATH=${qtPath}\\bin;%PATH%" && ${shellQuote(runtimeTarget.exePath)}`;
        }
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
    /** Warning codes to suppress from build output (e.g. ['C4819', 'C5297']) */
    suppressedWarnings?: string[];
    /** Optional platform boundary for runtime launch workarounds. */
    runExecutor?: PlatformRunExecutor;
}

/**
 * Filter build output lines matching suppressed warning codes.
 * Each code is matched as a substring (e.g. "C4819" matches "warning C4819:").
 */
function filterBuildOutput(text: string, suppressed?: string[]): string {
    if (!suppressed || suppressed.length === 0) return text;
    return text.split('\n').filter(line => !suppressed.some(code => line.includes(` ${code}:`) || line.includes(` ${code} `))).join('\n');
}

export async function runCliResult(result: CliResult, options?: RunOptions): Promise<CliResult> {
    if (!result.ok || result.mode === 'dryRun' || result.commands.length === 0) {
        return result;
    }

    // Pre-kill previous instance by executable path (path-aware, more precise than shell-level name-based kill)
    if (result.action === 'run') {
        terminateExecutable(result.executablePath);
    }

    const started = Date.now();
    const commandParts = [...result.commands];

    const effectiveDetach = !!options?.detach;
    const suppressed = options?.suppressedWarnings;

    // Detach mode for run: build first, then launch exe separately
    if (effectiveDetach && result.action === 'run' && commandParts.length > 1) {
        const buildCommands = commandParts.slice(0, -1);
        const runCommand = commandParts[commandParts.length - 1];

        // Execute build commands
        const buildLine = buildCommands.join(' && ');
        const { filtered: buildExecCmds, env: buildPathEnv } = extractPathEnv(buildCommands);
        const buildExecLine = buildExecCmds.join(' && ');
        const buildResult = options.streaming
            ? await executeStreaming(buildExecLine, result.workspace, undefined, suppressed, buildPathEnv)
            : await execute(buildExecLine, result.workspace, suppressed, buildPathEnv);

        // Write build log (both on success and failure)
        ensureLocalStateDir(result.workspace);
        const buildLogFilePath = logFileFor(result.workspace, 'build');
        fs.writeFileSync(buildLogFilePath, [`$ ${buildLine}`, '', buildResult.stdout, buildResult.stderr].join('\n'), 'utf8');
        const combinedOutput = buildResult.stdout + '\n' + buildResult.stderr;
        const ws = summarizeWarnings(combinedOutput);
        const buildErrors = extractErrors(combinedOutput);
        const buildFailed = buildResult.exitCode !== 0 || buildErrors.length > 0;

        if (buildFailed) {
            const durationMs = Date.now() - started;
            return {
                ...result,
                ok: false,
                exitCode: buildResult.exitCode,
                durationMs,
                stdout: buildResult.stdout,
                stderr: buildResult.stderr,
                errors: buildErrors,
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

        const cwd = resolveProjectCwd(result);
        const isWin = process.platform === 'win32';
        const previousExecutablePids = result.executablePath ? findExecutablePids(result.executablePath) : [];

        let pid: number | null;
        if (options.runExecutor && result.executablePath) {
            const launched = await options.runExecutor.execute({
                executablePath: result.executablePath,
                cwd,
                qtPath: result.resolved?.qtPath,
                detached: true,
                outputFile: logFile
            });
            pid = launched.pid;
        } else if (isWin) {
            // Use VBScript to launch without visible console window
            const batFile = path.join(path.dirname(logFile), 'run.bat');
            const vbsFile = path.join(path.dirname(logFile), 'run.vbs');
            // 在 bat 中设置 PATH 让 Qt DLL 和 .qm 文件可被加载
            const envSetup = result.resolved?.qtPath
                ? 'set "PATH=' + result.resolved.qtPath + '\\bin;%PATH%"\r\n'
                : '';
            fs.writeFileSync(batFile, `@echo off\r\n${envSetup}cd /d "${cwd}"\r\n${runCommand} >"${logFile}" 2>&1\r\n`, 'utf8');
            fs.writeFileSync(vbsFile, `CreateObject("Wscript.Shell").Run "cmd /c ""${batFile}""", 0, False\r\n`, 'utf8');
            const child = cp.spawn('wscript', [vbsFile], {
                cwd,
                detached: true,
                windowsHide: true,
                stdio: 'ignore'
            });
            child.unref();
            pid = await resolveDetachedRunPid(result.executablePath, previousExecutablePids);
        } else {
            const child = cp.spawn('/bin/sh', ['-c', `cd "${cwd}" && ${runCommand} >"${logFile}" 2>&1 &`], {
                cwd,
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            pid = await resolveDetachedRunPid(result.executablePath, previousExecutablePids);
        }
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
        const { filtered: buildExecCmds, env: buildPathEnv } = extractPathEnv(buildCommands);
        const buildExecLine = buildExecCmds.join(' && ');
        const buildResult = options?.streaming
            ? await executeStreaming(buildExecLine, result.workspace, undefined, suppressed, buildPathEnv)
            : await execute(buildExecLine, result.workspace, suppressed, buildPathEnv);
        const buildOutput = buildResult.stdout + '\n' + buildResult.stderr;
        const ws = summarizeWarnings(buildOutput);
        const buildErrors = extractErrors(buildOutput);
        const buildFailed = buildResult.exitCode !== 0 || buildErrors.length > 0;

        ensureLocalStateDir(result.workspace);
        const filePath = logFileFor(result.workspace, result.action);

        if (buildFailed) {
            const durationMs = Date.now() - started;
            fs.writeFileSync(filePath, [`$ ${buildLine}`, '', buildResult.stdout, buildResult.stderr].join('\n'), 'utf8');
            return {
                ...result,
                ok: false,
                exitCode: buildResult.exitCode,
                durationMs,
                stdout: buildResult.stdout,
                stderr: buildResult.stderr,
                errors: buildErrors,
                warningSummary: ws.total > 0 ? ws : undefined,
                logFile: filePath,
                commands: commandParts,
                diagnostics: [...result.diagnostics, { level: 'error', message: '编译失败' }]
            };
        }

        const runResult = options?.runExecutor && result.executablePath
            ? await executeWithPlatformRunner(
                options.runExecutor,
                result.executablePath,
                resolveProjectCwd(result),
                result.resolved?.qtPath,
                !!options.streaming,
                suppressed)
            : options?.streaming
                ? await executeStreaming(runCommand, resolveProjectCwd(result), result.executablePath, suppressed)
                : await execute(runCommand, resolveProjectCwd(result), suppressed);
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
        const cwd = resolveProjectCwd(result);
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

    // A runtime-only plan can still use the selected platform runner.
    if (result.action === 'run' && commandParts.length === 1 && options?.runExecutor && result.executablePath) {
        const executed = await executeWithPlatformRunner(
            options.runExecutor,
            result.executablePath,
            resolveProjectCwd(result),
            result.resolved?.qtPath,
            !!options.streaming,
            suppressed);
        const durationMs = Date.now() - started;
        ensureLocalStateDir(result.workspace);
        const filePath = logFileFor(result.workspace, result.action);
        fs.writeFileSync(filePath, [
            `$ ${commandParts[0]}`,
            '',
            executed.stdout,
            executed.stderr
        ].join('\n'), 'utf8');

        return {
            ...result,
            ok: true,
            exitCode: 0,
            durationMs,
            stdout: executed.stdout,
            stderr: executed.stderr,
            errors: [],
            logFile: filePath,
            runtimeExitCode: executed.exitCode,
            commands: commandParts,
            diagnostics: executed.exitCode === 0
                ? result.diagnostics
                : [...result.diagnostics, { level: 'warning', message: `程序已退出 (退出码: ${executed.exitCode})` }]
        };
    }

    // Normal mode: execute all commands together
    // Extract PATH env setup from commands on Windows — %PATH% expansion inside
    // cmd.exe inflates the effective line length far beyond the JS string length,
    // hitting the ~8191 char limit.  Moving PATH into the child process env
    // eliminates this inflation entirely.
    const { filtered: execCommands, env: pathEnv } = extractPathEnv(commandParts);
    const commandLine = commandParts.join(' && ');
    const execCommandLine = execCommands.join(' && ');

    // Windows cmd.exe has a ~8191 char command line limit.
    // When RCC targets are many, the joined commands can exceed this.
    // Fall back to writing a .bat file and executing it directly.
    let batFile: string | undefined;
    let effectiveCmd = execCommandLine;
    if (process.platform === 'win32' && execCommandLine.length > 7000) {
        ensureLocalStateDir(result.workspace);
        batFile = path.join(logsDir(result.workspace), `${result.action}-${Date.now()}.bat`);
        const cwd = resolveProjectCwd(result);
        fs.writeFileSync(batFile, `@echo off\r\ncd /d "${cwd}"\r\n${execCommandLine}\r\n`, 'utf8');
        effectiveCmd = batFile;
    }

    let executed: { exitCode: number; stdout: string; stderr: string };
    try {
        executed = options?.streaming
            ? await executeStreaming(effectiveCmd, result.workspace, result.action === 'run' ? result.executablePath : undefined, suppressed, pathEnv)
            : await execute(effectiveCmd, result.workspace, suppressed, pathEnv);
    } finally {
        if (batFile) {
            try { fs.unlinkSync(batFile); } catch { /* cleanup best-effort */ }
        }
    }
    const durationMs = Date.now() - started;
    ensureLocalStateDir(result.workspace);
    const filePath = logFileFor(result.workspace, result.action);
    fs.writeFileSync(filePath, [
        `$ ${commandLine}`,
        '',
        executed.stdout,
        executed.stderr
    ].join('\n'), 'utf8');

    const combinedOutput = executed.stdout + '\n' + executed.stderr;
    const errors = extractErrors(combinedOutput);
    const buildOk = executed.exitCode === 0 && errors.length === 0;

    const warningSummary = summarizeWarnings(combinedOutput);

    return {
        ...result,
        ok: buildOk,
        exitCode: executed.exitCode,
        durationMs,
        stdout: executed.stdout,
        stderr: executed.stderr,
        errors,
        warningSummary: warningSummary.total > 0 ? warningSummary : undefined,
        logFile: filePath,
        commands: commandParts,
        diagnostics: buildOk
            ? result.diagnostics
            : [
                ...result.diagnostics,
                {
                    level: 'error',
                    message: executed.exitCode !== 0
                        ? '命令执行失败'
                        : '命令执行成功但输出中包含编译错误'
                }
            ]
    };
}
