/**
 * Pure Node SSH/SCP transport shared by VSCode adapters and CLI.
 * No vscode dependency is allowed in this module.
 */
import * as cp from 'child_process';
import { ServerConfig } from './serverStore';
import { buildScpArgs, buildSshArgs, createAskpassEnv, sshTarget } from './ssh';

interface DisposableLike {
    dispose(): void;
}

export interface CancellationTokenLike {
    isCancellationRequested: boolean;
    onCancellationRequested?: (listener: () => void) => DisposableLike;
}

export interface TestConnectionResult {
    ok: boolean;
    error?: string;
}

export const SYNC_CANCELLED_CODE = 'FORJA_SYNC_CANCELLED';

interface SyncTransportError extends Error {
    code?: string;
}

interface ProcessResult {
    code: number | null;
    stderr: string;
    timedOut: boolean;
}

function createCancellationError(): SyncTransportError {
    const error = new Error('操作已取消') as SyncTransportError;
    error.code = SYNC_CANCELLED_CODE;
    return error;
}

function createTimeoutError(command: string, timeoutMs: number): SyncTransportError {
    const error = new Error(`${command} 超时（${Math.round(timeoutMs / 1000)}s）`) as SyncTransportError;
    error.code = 'FORJA_SYNC_TIMEOUT';
    return error;
}

export function isCancellationError(error: unknown): boolean {
    return error instanceof Error && (error as SyncTransportError).code === SYNC_CANCELLED_CODE;
}

function terminateProcess(proc: cp.ChildProcess, forceTimerRef: { timer?: NodeJS.Timeout }): void {
    if (proc.killed) { return; }
    proc.kill();
    forceTimerRef.timer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGKILL');
        }
    }, 1500);
}

function runCancellableProcess(command: string, args: string[], askpass: ReturnType<typeof createAskpassEnv>, token?: CancellationTokenLike, timeoutMs?: number): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        if (token?.isCancellationRequested) {
            askpass?.cleanup();
            reject(createCancellationError());
            return;
        }

        const proc = cp.spawn(command, args, {
            windowsHide: true,
            env: askpass?.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stderr = '';
        let settled = false;
        let cancelled = false;
        let timedOut = false;
        const forceTimerRef: { timer?: NodeJS.Timeout } = {};
        const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
            timedOut = true;
            terminateProcess(proc, forceTimerRef);
        }, timeoutMs);
        const subscription = token?.onCancellationRequested?.(() => {
            cancelled = true;
            terminateProcess(proc, forceTimerRef);
        });

        const finish = (callback: () => void): void => {
            if (settled) { return; }
            settled = true;
            subscription?.dispose();
            if (timeout) { clearTimeout(timeout); }
            if (forceTimerRef.timer) { clearTimeout(forceTimerRef.timer); }
            askpass?.cleanup();
            callback();
        };

        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            finish(() => {
                if (cancelled || token?.isCancellationRequested) { reject(createCancellationError()); }
                else { resolve({ code, stderr, timedOut }); }
            });
        });
        proc.on('error', (e) => {
            finish(() => {
                if (cancelled || token?.isCancellationRequested) { reject(createCancellationError()); }
                else { reject(e); }
            });
        });
    });
}

/** SCP 上传单个文件。 */
export async function scpUpload(server: ServerConfig, localFile: string, remoteFile: string, password: string | null, token?: CancellationTokenLike): Promise<void> {
    const baseArgs = buildScpArgs(server);
    const dest = process.platform === 'win32'
        ? `${sshTarget(server)}:${remoteFile}`
        : `${sshTarget(server)}:'${remoteFile.replace(/'/g, "'\\''")}'`;
    const args = [...baseArgs, localFile, dest];

    const askpass = createAskpassEnv(
        server.authMode === 'password' ? password : null, `transport-${process.pid}`
    );

    let processResult: ProcessResult;
    try {
        processResult = await runCancellableProcess('scp', args, askpass, token);
    } catch (e) {
        if (isCancellationError(e)) { throw e; }
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`scp 启动失败: ${msg}`);
    }

    if (processResult.code !== 0) {
        throw new Error(`scp 失败 (code=${processResult.code}): ${processResult.stderr.trim()}`);
    }
}

/** 确保远程目录存在。 */
export async function ensureRemoteDir(server: ServerConfig, remoteDir: string, password: string | null, token?: CancellationTokenLike): Promise<void> {
    const sshArgs = buildSshArgs(server);
    const escaped = remoteDir.replace(/'/g, "'\\''");
    const cmd = `mkdir -p '${escaped}'`;
    const args = [...sshArgs, sshTarget(server), cmd];

    const askpass = createAskpassEnv(
        server.authMode === 'password' ? password : null, `mkdir-${process.pid}`
    );

    const timeoutMs = 5000;
    const result = await runCancellableProcess('ssh', args, askpass, token, timeoutMs);
    if (result.timedOut) {
        throw createTimeoutError('创建远程目录', timeoutMs);
    }
    if (result.code !== 0) {
        throw new Error(`创建远程目录失败 (code=${result.code}): ${result.stderr.trim() || 'mkdir -p failed'}`);
    }
}

/** 测试 SSH 连接。 */
export async function testConnection(server: ServerConfig, password: string | null): Promise<TestConnectionResult> {
    const sshArgs = buildSshArgs(server, { extraOptions: ['ConnectTimeout=10'] });
    const args = [...sshArgs, sshTarget(server), 'echo ok'];
    const askpass = createAskpassEnv(
        server.authMode === 'password' ? password : null, `test-${process.pid}`
    );
    const timeoutMs = 15000;

    let result: ProcessResult;
    try {
        result = await runCancellableProcess('ssh', args, askpass, undefined, timeoutMs);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }

    if (result.timedOut) {
        return { ok: false, error: '连接超时（15s）' };
    }
    if (result.code === 0) {
        return { ok: true };
    }
    return { ok: false, error: result.stderr.trim() || `exit code ${result.code}` };
}
