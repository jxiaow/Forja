import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CliResult } from '../cli/types';
import { ensureLocalStateDir, logsDir, runLogPath, writeRunState, clearRunState } from './localState';
import { parseRuntimeLibPaths, resolveRuntimeTarget } from './runtimeTarget';

function logFileFor(workspace: string, action: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(logsDir(workspace), `${stamp}-${action}.log`);
}

function execute(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.exec(commandLine, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            let exitCode = 0;
            if (error) {
                if (typeof (error as any).code === 'number') {
                    exitCode = (error as any).code;
                } else if ((error as any).signal) {
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
        const child = cp.exec(commandLine, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });

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

export interface RunOptions {
    /** When true, pipes stdout/stderr to the terminal in real-time */
    streaming?: boolean;
    /** When true (run action only), launches the program detached with output to log file */
    detach?: boolean;
}

export async function runCliResult(result: CliResult, options?: RunOptions): Promise<CliResult> {
    if (!result.ok || result.mode === 'dryRun' || result.commands.length === 0) {
        return result;
    }

    const started = Date.now();
    const commandParts = [...result.commands];

    // Detach mode: build first, then launch exe separately
    if (options?.detach && result.action === 'run' && commandParts.length > 1) {
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
            return {
                ...result,
                ok: false,
                exitCode: buildResult.exitCode,
                durationMs,
                stdout: buildResult.stdout,
                stderr: buildResult.stderr,
                logFile: filePath,
                commands: commandParts,
                diagnostics: [...result.diagnostics, { level: 'error', message: '编译失败', hint: '请查看 logFile 中的 stdout 和 stderr' }]
            };
        }

        // Launch exe detached with output to log file
        ensureLocalStateDir(result.workspace);
        const logFile = runLogPath(result.workspace);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        const logFd = fs.openSync(logFile, 'w');

        const cwd = result.project ? path.dirname(result.project) : result.workspace;
        const isWin = process.platform === 'win32';

        let child: cp.ChildProcess;
        if (isWin) {
            // Write a temp bat file to avoid cmd /c quoting issues
            const batFile = path.join(path.dirname(logFile), 'run.bat');
            fs.writeFileSync(batFile, `@echo off\r\ncd /d "${cwd}"\r\n${runCommand}\r\n`, 'utf8');
            child = cp.spawn('cmd', ['/c', batFile], {
                cwd,
                detached: true,
                windowsHide: true,
                stdio: ['ignore', logFd, logFd]
            });
        } else {
            child = cp.spawn('/bin/sh', ['-c', `cd "${cwd}" && ${runCommand}`], {
                cwd,
                detached: true,
                stdio: ['ignore', logFd, logFd]
            });
        }
        child.unref();
        fs.closeSync(logFd);

        const pid = child.pid || 0;
        writeRunState(result.workspace, {
            pid,
            exePath: runCommand,
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

    return {
        ...result,
        ok: executed.exitCode === 0,
        exitCode: executed.exitCode,
        durationMs,
        stdout: executed.stdout,
        stderr: executed.stderr,
        logFile: filePath,
        commands: commandParts,
        diagnostics: executed.exitCode === 0
            ? result.diagnostics
            : [
                ...result.diagnostics,
                {
                    level: 'error',
                    message: '命令执行失败',
                    hint: '请查看 logFile 中的 stdout 和 stderr'
                }
            ]
    };
}
