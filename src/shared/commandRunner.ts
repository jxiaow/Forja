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
                // error.code is the process exit code (number) when available
                if (typeof (error as any).code === 'number') {
                    exitCode = (error as any).code;
                } else if ((error as any).signal) {
                    // Process killed by signal (e.g. SIGTERM, SIGKILL)
                    exitCode = 128;
                } else {
                    exitCode = 1;
                }
            }
            resolve({ exitCode, stdout, stderr });
        });
    });
}

function shellQuote(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
}

function buildRunCommand(result: CliResult): string | null {
    if (!result.project || !result.resolved) {
        return null;
    }

    const runtimeTarget = resolveRuntimeTarget(path.dirname(result.project), result.resolved.mode, result.resolved.arch);
    if (!runtimeTarget) {
        return null;
    }

    if (process.platform === 'win32') {
        return shellQuote(runtimeTarget.exePath);
    }

    const libraryPaths = parseRuntimeLibPaths(path.dirname(result.project));
    if (libraryPaths.length === 0) {
        return shellQuote(runtimeTarget.exePath);
    }

    return `export LD_LIBRARY_PATH=${shellQuote(`${libraryPaths.join(':')}:$LD_LIBRARY_PATH`)} && ${shellQuote(runtimeTarget.exePath)}`;
}

export async function runCliResult(result: CliResult): Promise<CliResult> {
    if (!result.ok || result.mode === 'dryRun' || result.commands.length === 0) {
        return result;
    }

    const started = Date.now();
    const commandParts = [...result.commands];
    if (result.action === 'run') {
        const runCommand = buildRunCommand(result);
        if (!runCommand) {
            return {
                ...result,
                ok: false,
                diagnostics: [
                    ...result.diagnostics,
                    {
                        level: 'error',
                        message: '无法确定可执行文件路径',
                        hint: '请先运行 qmake/build 生成 Makefile，或检查 project/mode/arch 是否匹配'
                    }
                ],
                nextActions: [
                    ...result.nextActions,
                    '先执行 qmake --execute，然后重新运行 run --execute'
                ]
            };
        }
        commandParts.push(runCommand);
    }

    const commandLine = commandParts.join(' && ');
    const executed = await execute(commandLine, result.workspace);
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
