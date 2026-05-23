import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { quoteRemoteArg, remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface UnlockRemoteTargetOptions {
    stateRoot?: string;
    targetId: string;
    lockId: string;
    force: boolean;
}

export interface UnlockRemoteTargetResult {
    ok: boolean;
    action: 'unlock';
    mode: 'remote';
    targetId: string;
    lockId: string;
    removed: boolean;
    diagnostics: RemoteDiagnostic[];
}

export interface ExecuteRemoteUnlockOptions {
    remotePath: string;
    lockId: string;
    force: boolean;
    runner: RemoteRunner;
}

export interface ExecuteRemoteUnlockResult extends UnlockRemoteTargetResult {
    canonicalPath?: string;
}

export function defaultRemoteStateRoot(): string {
    return path.join(os.homedir(), '.compilot');
}

export function unlockRemoteTarget(options: UnlockRemoteTargetOptions): UnlockRemoteTargetResult {
    const diagnostics: UnlockRemoteTargetResult['diagnostics'] = [];
    if (!options.force) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --force' });
        return result(false, options, false, diagnostics);
    }
    if (!options.lockId) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --lock-id <id>' });
        return result(false, options, false, diagnostics);
    }
    const root = options.stateRoot || defaultRemoteStateRoot();
    const lockDir = path.join(root, 'locks', options.targetId);
    const lockFile = path.join(lockDir, 'lock.json');
    if (!fs.existsSync(lockFile)) {
        diagnostics.push({ level: 'warning', message: 'lock 不存在' });
        return result(true, options, false, diagnostics);
    }
    const raw = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { lockId?: unknown };
    if (raw.lockId !== options.lockId) {
        diagnostics.push({ level: 'error', message: 'lock-id 不匹配' });
        return result(false, options, false, diagnostics);
    }
    fs.rmSync(lockDir, { recursive: true, force: true });
    return result(true, options, true, diagnostics);
}

export async function executeRemoteUnlock(options: ExecuteRemoteUnlockOptions): Promise<ExecuteRemoteUnlockResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    if (!options.force) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --force' });
        return remoteResult(false, '', options.lockId, false, diagnostics);
    }
    if (!options.lockId) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --lock-id <id>' });
        return remoteResult(false, '', options.lockId, false, diagnostics);
    }

    const pathCommand = `mkdir -p ${remoteCommand([options.remotePath])} && cd ${remoteCommand([options.remotePath])} && pwd -P`;
    const pathResult = await options.runner.run(pathCommand, 10000);
    if (pathResult.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(pathResult.stderr) || 'remotePath 不可用，无法定位 lock' });
        return remoteResult(false, '', options.lockId, false, diagnostics);
    }

    const canonicalPath = pathResult.stdout.trim();
    const targetId = crypto.createHash('sha256').update(canonicalPath).digest('hex');
    const lockDir = homePath('.compilot', 'locks', targetId);
    const expected = quoteRemoteArg(options.lockId);
    const unlockCommand = [
        `lock_dir=${lockDir}`,
        'lock_file="$lock_dir/lock.json"',
        'if [ ! -f "$lock_file" ]; then printf "absent\n"; exit 0; fi',
        "stored_lock_id=$(sed -n 's/.*\"lockId\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' \"$lock_file\" | head -n 1)",
        `if [ "$stored_lock_id" != ${expected} ]; then printf "lock-id mismatch\n" >&2; exit 3; fi`,
        'rm -rf "$lock_dir"',
        'printf "removed\n"'
    ].join('; ');

    const unlockResult = await options.runner.run(unlockCommand, 10000);
    if (unlockResult.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(unlockResult.stderr) || '远端 lock 解除失败' });
        return { ...remoteResult(false, targetId, options.lockId, false, diagnostics), canonicalPath };
    }

    const removed = unlockResult.stdout.includes('removed');
    if (!removed) {
        diagnostics.push({ level: 'warning', message: 'lock 不存在' });
    }
    return { ...remoteResult(true, targetId, options.lockId, removed, diagnostics), canonicalPath };
}

function result(
    ok: boolean,
    options: UnlockRemoteTargetOptions,
    removed: boolean,
    diagnostics: UnlockRemoteTargetResult['diagnostics']
): UnlockRemoteTargetResult {
    return {
        ok,
        action: 'unlock',
        mode: 'remote',
        targetId: options.targetId,
        lockId: options.lockId,
        removed,
        diagnostics
    };
}

function remoteResult(ok: boolean, targetId: string, lockId: string, removed: boolean, diagnostics: RemoteDiagnostic[]): ExecuteRemoteUnlockResult {
    return { ok, action: 'unlock', mode: 'remote', targetId, lockId, removed, diagnostics };
}

function homePath(...segments: string[]): string {
    return '$HOME/' + segments.map(segment => /^[A-Za-z0-9._-]+$/.test(segment) ? segment : remoteCommand([segment])).join('/');
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
