import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CliResult } from '../cli/types';
import { ensureLocalStateDir, logsDir } from './localState';
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
 * Streaming execute: pipes stdout/stderr to the current process in real-time,
 * while also collecting output for logging.
 */
function executeStreaming(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        const child = cp.spawn(commandLine, {
            cwd,
            windowsHide: true,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(text);
        });

        child.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
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
}

export async function runCliResult(result: CliResult, options?: RunOptions): Promise<CliResult> {
    if (!result.ok || result.mode === 'dryRun' || result.commands.length === 0) {
        return result;
    }

    const started = Date.now();
    const commandParts = [...result.commands];

    // Execute commands
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
