import { remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export type RemoteBridgeTarget = 'qt' | 'cpp';
export type RemoteBridgeAction = 'status' | 'init' | 'use' | 'build' | 'rebuild' | 'clean' | 'qmake' | 'run' | 'stop' | 'ps';

export interface ExecuteRemoteBridgeOptions {
    target: RemoteBridgeTarget;
    action: RemoteBridgeAction;
    args: string[];
    json: boolean;
    remotePath: string;
    runner: RemoteRunner;
    remoteForjaBin?: string;
    timeoutMs?: number;
    stream?: boolean;
}

export interface ExecuteRemoteBridgeResult {
    ok: boolean;
    action: 'bridge';
    mode: 'remote';
    target: RemoteBridgeTarget;
    remoteAction: RemoteBridgeAction;
    remoteCommand: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    result?: unknown;
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

export async function executeRemoteBridge(options: ExecuteRemoteBridgeOptions): Promise<ExecuteRemoteBridgeResult> {
    // New unified CLI: commands are top-level (build, run, status, etc.)
    // No more 'qt'/'cpp' subcommand prefix
    const remoteArgs = [options.action, '--workspace', options.remotePath, ...options.args];
    if (options.json && !remoteArgs.includes('--json')) {
        remoteArgs.push('--json');
    }
    const remoteBin = options.remoteForjaBin ? remoteCommand([options.remoteForjaBin]) : '$HOME/.forja/bin/forja';
    const command = `cd ${remoteCommand([options.remotePath])} && ${remoteBin} ${remoteCommand(remoteArgs)}`;
    const timeoutMs = options.timeoutMs ?? (options.action === 'run' && !options.json ? 24 * 60 * 60 * 1000 : 120000);
    const executed = await options.runner.run(command, timeoutMs, options.stream);
    const diagnostics: RemoteDiagnostic[] = [];
    let parsed: unknown;

    if (options.json && executed.stdout.trim()) {
        try {
            parsed = JSON.parse(executed.stdout);
            if (isFailedJsonResult(parsed)) {
                diagnostics.push(...extractRemoteDiagnostics(parsed, `远端 ${options.target} ${options.action} 返回失败`));
            }
        } catch (error) {
            const stdoutPreview = trim(executed.stdout);
            const stdoutContext = stdoutPreview ? `; stdout: ${stdoutPreview}` : '';
            diagnostics.push({ level: 'error', message: `远端 ${options.target} ${options.action} JSON 输出解析失败: ${error instanceof Error ? error.message : String(error)}${stdoutContext}` });
        }
    }
    if (executed.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(executed.stderr) || `远端 ${options.target} ${options.action} 执行失败` });
    }

    return {
        ok: executed.exitCode === 0 && diagnostics.every(item => item.level !== 'error'),
        action: 'bridge',
        mode: 'remote',
        target: options.target,
        remoteAction: options.action,
        remoteCommand: command,
        exitCode: executed.exitCode,
        stdout: executed.stdout,
        stderr: executed.stderr,
        result: parsed,
        diagnostics
    };
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}

function isFailedJsonResult(value: unknown): value is { ok: false; diagnostics?: unknown } {
    return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
}

function extractRemoteDiagnostics(value: { diagnostics?: unknown }, fallback: string): RemoteDiagnostic[] {
    if (Array.isArray(value.diagnostics)) {
        const diagnostics = value.diagnostics
            .map(item => normalizeDiagnostic(item))
            .filter((item): item is RemoteDiagnostic => item !== null);
        if (diagnostics.length > 0) { return diagnostics; }
    }
    return [{ level: 'error', message: fallback }];
}

function normalizeDiagnostic(value: unknown): RemoteDiagnostic | null {
    if (typeof value !== 'object' || value === null) { return null; }
    const raw = value as { level?: unknown; message?: unknown };
    if (typeof raw.message !== 'string' || !raw.message) { return null; }
    const level = raw.level === 'info' || raw.level === 'warning' || raw.level === 'error' ? raw.level : 'error';
    return { level, message: raw.message };
}
