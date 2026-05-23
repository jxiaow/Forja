import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { quoteRemoteArg, remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface RemoteLockMetadata {
    lockId: string;
    targetId: string;
    owner: string;
    stage: string;
    remotePath: string;
    repos: string[];
    startedAt: string;
    workspace?: string;
}

export interface AcquireRemoteTargetOptions {
    stateRoot?: string;
    targetId: string;
    owner: string;
    stage: string;
    remotePath: string;
    repos: string[];
    workspace?: string;
    lockId?: string;
    startedAt?: string;
}

export interface AcquireRemoteTargetResult {
    ok: boolean;
    action: 'lock';
    mode: 'remote';
    targetId: string;
    acquired: boolean;
    lock?: RemoteLockMetadata;
    diagnostics: RemoteDiagnostic[];
}

export interface ReleaseRemoteTargetOptions {
    stateRoot?: string;
    targetId: string;
    lockId: string;
}

export interface ReleaseRemoteTargetResult {
    ok: boolean;
    action: 'releaseLock';
    mode: 'remote';
    targetId: string;
    lockId: string;
    removed: boolean;
    diagnostics: RemoteDiagnostic[];
}

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

export interface ExecuteRemoteAcquireLockOptions {
    remotePath: string;
    owner: string;
    stage: string;
    repos: string[];
    workspace?: string;
    runner: RemoteRunner;
}

export interface ExecuteRemoteAcquireLockResult extends AcquireRemoteTargetResult {
    canonicalPath?: string;
}

export interface ExecuteRemoteReleaseLockOptions {
    remotePath: string;
    lockId: string;
    runner: RemoteRunner;
}

export interface ExecuteRemoteReleaseLockResult extends ReleaseRemoteTargetResult {
    canonicalPath?: string;
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

export function acquireRemoteTarget(options: AcquireRemoteTargetOptions): AcquireRemoteTargetResult {
    const diagnostics: RemoteDiagnostic[] = [];
    const root = options.stateRoot || defaultRemoteStateRoot();
    const lockDir = path.join(root, 'locks', options.targetId);
    const lockFile = path.join(lockDir, 'lock.json');
    fs.mkdirSync(path.dirname(lockDir), { recursive: true });

    if (fs.existsSync(lockFile)) {
        const existing = readLockFile(lockFile);
        diagnostics.push({ level: 'error', message: '远端 target 已被占用' });
        return { ok: false, action: 'lock', mode: 'remote', targetId: options.targetId, acquired: false, lock: existing, diagnostics };
    }

    try {
        fs.mkdirSync(lockDir, { recursive: false });
    } catch {
        const existing = readLockFile(lockFile);
        diagnostics.push({ level: 'error', message: '远端 target 已被占用' });
        return { ok: false, action: 'lock', mode: 'remote', targetId: options.targetId, acquired: false, lock: existing, diagnostics };
    }

    const lock = buildLockMetadata(options);
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2), 'utf8');
    return { ok: true, action: 'lock', mode: 'remote', targetId: options.targetId, acquired: true, lock, diagnostics };
}

export function releaseRemoteTarget(options: ReleaseRemoteTargetOptions): ReleaseRemoteTargetResult {
    const diagnostics: RemoteDiagnostic[] = [];
    if (!options.lockId) {
        diagnostics.push({ level: 'error', message: 'release lock 需要 lockId' });
        return releaseResult(false, options.targetId, options.lockId, false, diagnostics);
    }
    const root = options.stateRoot || defaultRemoteStateRoot();
    const lockDir = path.join(root, 'locks', options.targetId);
    const lockFile = path.join(lockDir, 'lock.json');
    if (!fs.existsSync(lockFile)) {
        diagnostics.push({ level: 'warning', message: 'lock 不存在' });
        return releaseResult(true, options.targetId, options.lockId, false, diagnostics);
    }
    const raw = readLockFile(lockFile);
    if (!raw || raw.lockId !== options.lockId) {
        diagnostics.push({ level: 'error', message: 'lock-id 不匹配' });
        return releaseResult(false, options.targetId, options.lockId, false, diagnostics);
    }
    fs.rmSync(lockDir, { recursive: true, force: true });
    return releaseResult(true, options.targetId, options.lockId, true, diagnostics);
}

export function unlockRemoteTarget(options: UnlockRemoteTargetOptions): UnlockRemoteTargetResult {
    const diagnostics: UnlockRemoteTargetResult['diagnostics'] = [];
    if (!options.force) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --force' });
        return unlockResult(false, options.targetId, options.lockId, false, diagnostics);
    }
    if (!options.lockId) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --lock-id <id>' });
        return unlockResult(false, options.targetId, options.lockId, false, diagnostics);
    }
    const released = releaseRemoteTarget(options);
    return unlockResult(released.ok, options.targetId, options.lockId, released.removed, released.diagnostics);
}

export async function executeRemoteAcquireLock(options: ExecuteRemoteAcquireLockOptions): Promise<ExecuteRemoteAcquireLockResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    const target = await resolveRemoteTarget(options.remotePath, options.runner, 'lock');
    if (!target.ok) {
        return { ok: false, action: 'lock', mode: 'remote', targetId: '', acquired: false, diagnostics: target.diagnostics };
    }

    const lock = buildLockMetadata({
        targetId: target.targetId,
        owner: options.owner,
        stage: options.stage,
        remotePath: options.remotePath,
        repos: options.repos,
        workspace: options.workspace
    });
    const lockDir = homePath('.compilot', 'locks', target.targetId);
    const lockJson = JSON.stringify(lock);
    const command = [
        'lock_dir=' + lockDir,
        'lock_file="$lock_dir/lock.json"',
        'mkdir -p "$(dirname "$lock_dir")"',
        'if mkdir "$lock_dir" 2>/dev/null; then',
        'printf %s ' + quoteRemoteArg(lockJson) + ' > "$lock_file"',
        'printf "acquired\\n"',
        'cat "$lock_file"',
        'else',
        'printf "locked\\n"',
        'cat "$lock_file" 2>/dev/null',
        'exit 2',
        'fi'
    ].join('; ');
    const acquired = await options.runner.run(command, 10000);
    const parsed = parseLockFromOutput(acquired.stdout) || lock;
    if (acquired.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(acquired.stderr) || '远端 target 已被占用' });
        return { ok: false, action: 'lock', mode: 'remote', targetId: target.targetId, acquired: false, lock: parsed, diagnostics, canonicalPath: target.canonicalPath };
    }
    return { ok: true, action: 'lock', mode: 'remote', targetId: target.targetId, acquired: true, lock: parsed, diagnostics, canonicalPath: target.canonicalPath };
}

export async function executeRemoteReleaseLock(options: ExecuteRemoteReleaseLockOptions): Promise<ExecuteRemoteReleaseLockResult> {
    const target = await resolveRemoteTarget(options.remotePath, options.runner, 'release lock');
    if (!target.ok) {
        return { ok: false, action: 'releaseLock', mode: 'remote', targetId: '', lockId: options.lockId, removed: false, diagnostics: target.diagnostics };
    }
    return executeRemoteReleaseByTarget({ targetId: target.targetId, canonicalPath: target.canonicalPath, lockId: options.lockId, runner: options.runner, action: 'releaseLock' });
}

export async function executeRemoteUnlock(options: ExecuteRemoteUnlockOptions): Promise<ExecuteRemoteUnlockResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    if (!options.force) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --force' });
        return remoteUnlockResult(false, '', options.lockId, false, diagnostics);
    }
    if (!options.lockId) {
        diagnostics.push({ level: 'error', message: 'unlock 需要 --lock-id <id>' });
        return remoteUnlockResult(false, '', options.lockId, false, diagnostics);
    }

    const target = await resolveRemoteTarget(options.remotePath, options.runner, 'unlock');
    if (!target.ok) {
        return remoteUnlockResult(false, '', options.lockId, false, target.diagnostics);
    }
    const released = await executeRemoteReleaseByTarget({ targetId: target.targetId, canonicalPath: target.canonicalPath, lockId: options.lockId, runner: options.runner, action: 'unlock' });
    return { ok: released.ok, action: 'unlock', mode: 'remote', targetId: released.targetId, lockId: released.lockId, removed: released.removed, diagnostics: released.diagnostics, canonicalPath: released.canonicalPath };
}

async function executeRemoteReleaseByTarget(options: {
    targetId: string;
    canonicalPath: string;
    lockId: string;
    runner: RemoteRunner;
    action: 'releaseLock' | 'unlock';
}): Promise<ExecuteRemoteReleaseLockResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    if (!options.lockId) {
        diagnostics.push({ level: 'error', message: 'release lock 需要 lockId' });
        return { ok: false, action: 'releaseLock', mode: 'remote', targetId: options.targetId, lockId: options.lockId, removed: false, diagnostics, canonicalPath: options.canonicalPath };
    }
    const lockDir = homePath('.compilot', 'locks', options.targetId);
    const expected = quoteRemoteArg(options.lockId);
    const releaseCommand = [
        'lock_dir=' + lockDir,
        'lock_file="$lock_dir/lock.json"',
        'if [ ! -f "$lock_file" ]; then printf "absent\\n"; exit 0; fi',
        "stored_lock_id=$(sed -n 's/.*\"lockId\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' \"$lock_file\" | head -n 1)",
        'if [ "$stored_lock_id" != ' + expected + ' ]; then printf "lock-id mismatch\\n" >&2; exit 3; fi',
        'rm -rf "$lock_dir"',
        'printf "removed\\n"'
    ].join('; ');

    const releaseResult = await options.runner.run(releaseCommand, 10000);
    if (releaseResult.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(releaseResult.stderr) || '远端 lock 释放失败' });
        return { ok: false, action: 'releaseLock', mode: 'remote', targetId: options.targetId, lockId: options.lockId, removed: false, diagnostics, canonicalPath: options.canonicalPath };
    }
    const removed = releaseResult.stdout.includes('removed');
    if (!removed) {
        diagnostics.push({ level: 'warning', message: 'lock 不存在' });
    }
    return { ok: true, action: 'releaseLock', mode: 'remote', targetId: options.targetId, lockId: options.lockId, removed, diagnostics, canonicalPath: options.canonicalPath };
}

async function resolveRemoteTarget(remotePath: string, runner: RemoteRunner, label: string): Promise<{ ok: true; canonicalPath: string; targetId: string; diagnostics: RemoteDiagnostic[] } | { ok: false; diagnostics: RemoteDiagnostic[] }> {
    const pathCommand = 'mkdir -p ' + remoteCommand([remotePath]) + ' && cd ' + remoteCommand([remotePath]) + ' && pwd -P';
    const pathResult = await runner.run(pathCommand, 10000);
    if (pathResult.exitCode !== 0) {
        return { ok: false, diagnostics: [{ level: 'error', message: trim(pathResult.stderr) || 'remotePath 不可用，无法定位 ' + label }] };
    }
    const canonicalPath = pathResult.stdout.trim();
    const targetId = crypto.createHash('sha256').update(canonicalPath).digest('hex');
    return { ok: true, canonicalPath, targetId, diagnostics: [] };
}

function buildLockMetadata(options: AcquireRemoteTargetOptions): RemoteLockMetadata {
    return {
        lockId: options.lockId || crypto.randomUUID(),
        targetId: options.targetId,
        owner: options.owner,
        stage: options.stage,
        remotePath: options.remotePath,
        repos: options.repos,
        startedAt: options.startedAt || new Date().toISOString(),
        workspace: options.workspace
    };
}

function readLockFile(lockFile: string): RemoteLockMetadata | undefined {
    try {
        return JSON.parse(fs.readFileSync(lockFile, 'utf8')) as RemoteLockMetadata;
    } catch {
        return undefined;
    }
}

function parseLockFromOutput(stdout: string): RemoteLockMetadata | undefined {
    const start = stdout.indexOf('{');
    if (start < 0) { return undefined; }
    try {
        return JSON.parse(stdout.slice(start)) as RemoteLockMetadata;
    } catch {
        return undefined;
    }
}

function releaseResult(ok: boolean, targetId: string, lockId: string, removed: boolean, diagnostics: RemoteDiagnostic[]): ReleaseRemoteTargetResult {
    return { ok, action: 'releaseLock', mode: 'remote', targetId, lockId, removed, diagnostics };
}

function unlockResult(ok: boolean, targetId: string, lockId: string, removed: boolean, diagnostics: RemoteDiagnostic[]): UnlockRemoteTargetResult {
    return { ok, action: 'unlock', mode: 'remote', targetId, lockId, removed, diagnostics };
}

function remoteUnlockResult(ok: boolean, targetId: string, lockId: string, removed: boolean, diagnostics: RemoteDiagnostic[]): ExecuteRemoteUnlockResult {
    return { ok, action: 'unlock', mode: 'remote', targetId, lockId, removed, diagnostics };
}

function homePath(...segments: string[]): string {
    return '$HOME/' + segments.map(segment => /^[A-Za-z0-9._-]+$/.test(segment) ? segment : remoteCommand([segment])).join('/');
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
