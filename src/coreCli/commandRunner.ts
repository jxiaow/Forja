import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CliResult } from '../cli/types';
import { ensureLocalStateDir, logsDir } from './localState';

function logFileFor(workspace: string, action: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(logsDir(workspace), `${stamp}-${action}.log`);
}

function execute(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.exec(commandLine, { cwd, windowsHide: true }, (error, stdout, stderr) => {
            const exitCode = typeof (error as cp.ExecException | null)?.code === 'number'
                ? ((error as cp.ExecException).code as number)
                : 0;
            resolve({ exitCode, stdout, stderr });
        });
    });
}

export async function runCliResult(result: CliResult): Promise<CliResult> {
    if (!result.ok || result.mode === 'dryRun' || result.commands.length === 0) {
        return result;
    }

    const started = Date.now();
    const commandLine = result.commands.join(' && ');
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
