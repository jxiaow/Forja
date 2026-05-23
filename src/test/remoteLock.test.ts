import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    acquireRemoteTarget,
    executeRemoteAcquireLock,
    executeRemoteReleaseLock,
    releaseRemoteTarget
} from '../remote/core/lock';

const tmpDirs: string[] = [];

test.after(() => {
    for (const dir of tmpDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-remote-lock-'));
    tmpDirs.push(dir);
    return dir;
}

test('acquireRemoteTarget creates metadata and refuses an existing lock', () => {
    const stateRoot = tmpDir();
    const first = acquireRemoteTarget({
        stateRoot,
        targetId: 'target-a',
        owner: 'cli',
        stage: 'baseline',
        remotePath: '/remote/ws',
        repos: ['qt-app']
    });

    assert.equal(first.ok, true);
    assert.equal(first.acquired, true);
    assert.equal(first.lock?.owner, 'cli');
    assert.equal(first.lock?.stage, 'baseline');
    assert.deepEqual(first.lock?.repos, ['qt-app']);

    const second = acquireRemoteTarget({
        stateRoot,
        targetId: 'target-a',
        owner: 'vscode',
        stage: 'sync',
        remotePath: '/remote/ws',
        repos: ['sdk-lib']
    });

    assert.equal(second.ok, false);
    assert.equal(second.acquired, false);
    assert.equal(second.lock?.lockId, first.lock?.lockId);
    assert.match(second.diagnostics[0].message, /已被占用/);
});

test('releaseRemoteTarget only removes a matching lock id', () => {
    const stateRoot = tmpDir();
    const acquired = acquireRemoteTarget({ stateRoot, targetId: 'target-a', owner: 'cli', stage: 'sync', remotePath: '/remote/ws', repos: [] });
    assert.ok(acquired.lock?.lockId);

    const mismatch = releaseRemoteTarget({ stateRoot, targetId: 'target-a', lockId: 'wrong' });
    assert.equal(mismatch.ok, false);
    assert.equal(fs.existsSync(path.join(stateRoot, 'locks', 'target-a', 'lock.json')), true);

    const released = releaseRemoteTarget({ stateRoot, targetId: 'target-a', lockId: acquired.lock.lockId });
    assert.equal(released.ok, true);
    assert.equal(released.removed, true);
    assert.equal(fs.existsSync(path.join(stateRoot, 'locks', 'target-a')), false);
});

test('executeRemoteAcquireLock creates a canonical target lock over SSH', async () => {
    const commands: string[] = [];
    const result = await executeRemoteAcquireLock({
        remotePath: '/remote/ws',
        owner: 'cli',
        stage: 'baseline',
        repos: ['qt-app'],
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                if (command.includes('mkdir "$lock_dir"')) {
                    const jsonStart = command.indexOf("'{");
                    assert.ok(jsonStart >= 0);
                    return { exitCode: 0, stdout: 'acquired\n{"lockId":"abc","targetId":"remote-target","owner":"cli","stage":"baseline","remotePath":"/remote/ws","repos":["qt-app"],"startedAt":"2026-05-23T00:00:00.000Z"}\n', stderr: '' };
                }
                return { exitCode: 1, stdout: '', stderr: 'unexpected command' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.acquired, true);
    assert.equal(result.lock?.owner, 'cli');
    assert.equal(result.lock?.stage, 'baseline');
    assert.ok(result.targetId.length > 20);
    assert.ok(commands.some(command => command.includes('$HOME/.compilot/locks/')));
});

test('executeRemoteReleaseLock refuses to remove a mismatched remote lock', async () => {
    const commands: string[] = [];
    const result = await executeRemoteReleaseLock({
        remotePath: '/remote/ws',
        lockId: 'abc',
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                if (command.includes('rm -rf')) { return { exitCode: 3, stdout: '', stderr: 'lock-id mismatch' }; }
                return { exitCode: 1, stdout: '', stderr: 'unexpected command' };
            }
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.removed, false);
    assert.match(result.diagnostics[0].message, /lock-id mismatch/);
    assert.ok(commands.some(command => command.includes('rm -rf')));
});
