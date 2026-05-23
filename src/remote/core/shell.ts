import * as cp from 'child_process';
import { ServerConfig } from '../../core/serverStore';
import { buildScpArgs, buildSshArgs, createAskpassEnv, sshTarget } from '../../core/ssh';
import type { RemoteUploader } from './bootstrap';
import { RemoteCommandResult, RemoteRunner } from './types';

export interface SshRunnerHooks {
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
    onSpawn?: (child: cp.ChildProcess) => void;
}

export function quoteRemoteArg(value: string): string {
    if (value.includes('\0')) {
        throw new Error('remote argv contains NUL');
    }
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function remoteCommand(argv: string[]): string {
    return argv.map(quoteRemoteArg).join(' ');
}

export function createScpUploader(server: ServerConfig, password: string | null = null): RemoteUploader {
    return {
        upload(localPath: string, remotePath: string): Promise<void> {
            return new Promise((resolve, reject) => {
                const askpass = createAskpassEnv(server.authMode === 'password' ? password : null, `remote-scp-${process.pid}`);
                const target = `${sshTarget(server)}:${remotePath}`;
                const child = cp.spawn('scp', [...buildScpArgs(server), localPath, target], {
                    windowsHide: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: askpass?.env
                });
                let stderr = '';
                child.stderr.on('data', chunk => { stderr += String(chunk); });
                child.on('error', error => {
                    askpass?.cleanup();
                    reject(error);
                });
                child.on('close', code => {
                    askpass?.cleanup();
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(stderr.trim() || `scp exited with code ${code ?? 1}`));
                    }
                });
            });
        }
    };
}

export function createSshRunner(server: ServerConfig, password: string | null = null, hooks: SshRunnerHooks = {}): RemoteRunner {
    return {
        run(command: string, timeoutMs: number = 10000, stream: boolean = false): Promise<RemoteCommandResult> {
            return new Promise(resolve => {
                const askpass = createAskpassEnv(server.authMode === 'password' ? password : null, `remote-${process.pid}`);
                const child = cp.spawn('ssh', [...buildSshArgs(server), sshTarget(server), command], {
                    windowsHide: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: askpass?.env
                });
                hooks.onSpawn?.(child);
                let stdout = '';
                let stderr = '';
                const timer = setTimeout(() => {
                    child.kill('SIGTERM');
                }, timeoutMs);
                child.stdout.on('data', chunk => {
                    const text = String(chunk);
                    stdout += text;
                    if (stream) {
                        if (hooks.onStdout) { hooks.onStdout(text); }
                        else { process.stdout.write(text); }
                    }
                });
                child.stderr.on('data', chunk => {
                    const text = String(chunk);
                    stderr += text;
                    if (stream) {
                        if (hooks.onStderr) { hooks.onStderr(text); }
                        else { process.stderr.write(text); }
                    }
                });
                child.on('error', error => {
                    clearTimeout(timer);
                    askpass?.cleanup();
                    resolve({ exitCode: 1, stdout, stderr: error.message });
                });
                child.on('close', code => {
                    clearTimeout(timer);
                    askpass?.cleanup();
                    resolve({ exitCode: code ?? 1, stdout, stderr });
                });
            });
        }
    };
}
