import { remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export type RemoteBridgeTarget = 'qt' | 'sdk';
export type RemoteBridgeAction = 'status' | 'init' | 'use' | 'build' | 'rebuild' | 'clean' | 'qmake';

export interface ExecuteRemoteBridgeOptions {
    target: RemoteBridgeTarget;
    action: RemoteBridgeAction;
    args: string[];
    json: boolean;
    remotePath: string;
    runner: RemoteRunner;
    remoteCompilotBin?: string;
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
    nextActions: string[];
}

export async function executeRemoteBridge(options: ExecuteRemoteBridgeOptions): Promise<ExecuteRemoteBridgeResult> {
    const remoteArgs = [options.target, options.action, '--workspace', options.remotePath, ...options.args];
    if (options.json && !remoteArgs.includes('--json')) {
        remoteArgs.push('--json');
    }
    const remoteBin = options.remoteCompilotBin ? remoteCommand([options.remoteCompilotBin]) : '$HOME/.compilot/bin/compilot';
    const command = `cd ${remoteCommand([options.remotePath])} && ${remoteBin} ${remoteCommand(remoteArgs)}`;
    const executed = await options.runner.run(command, 120000);
    const diagnostics: RemoteDiagnostic[] = [];
    let parsed: unknown;

    if (options.json && executed.stdout.trim()) {
        try {
            parsed = JSON.parse(executed.stdout);
        } catch (error) {
            diagnostics.push({ level: 'error', message: `远端 ${options.target} ${options.action} JSON 输出解析失败: ${error instanceof Error ? error.message : String(error)}` });
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
        diagnostics,
        nextActions: []
    };
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
