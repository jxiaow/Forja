import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearSyncState, filterNeedsDelete, filterNeedsSync, getSyncPendingInfo, markDeletedBatch, markSyncedBatch, SyncTargetContext } from '../core/syncState';

const _oldConfigDir = process.env.FORJA_CONFIG_DIR;
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sync-state-config-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;

after(() => {
    if (_oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = _oldConfigDir; }
    fs.rmSync(_testConfigDir, { recursive: true, force: true });
});

function createWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sync-state-'));
    fs.writeFileSync(path.join(workspace, 'main.cpp'), 'int main() { return 0; }\n', 'utf-8');
    return workspace;
}

const targetA: SyncTargetContext = { serverId: 'server-a', serverName: 'A', remotePath: '/opt/app' };
const targetB: SyncTargetContext = { serverId: 'server-b', serverName: 'B', remotePath: '/opt/app' };
const targetC: SyncTargetContext = { serverId: 'server-a', serverName: 'A', remotePath: '/opt/other' };

test('sync state is isolated by server target and remote path', () => {
    const workspace = createWorkspace();
    try {
        clearSyncState(workspace);
        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp'], targetA), ['main.cpp']);

        markSyncedBatch(workspace, ['main.cpp'], targetA);

        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp'], targetA), []);
        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp'], targetB), ['main.cpp']);
        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp'], targetC), ['main.cpp']);
    } finally {
        clearSyncState(workspace);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('sync state requires target context for sync markers', () => {
    const workspace = createWorkspace();
    try {
        clearSyncState(workspace);
        markSyncedBatch(workspace, ['main.cpp']);

        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp']), ['main.cpp']);
        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp'], targetA), ['main.cpp']);
    } finally {
        clearSyncState(workspace);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('pending info resolves target-prefixed state keys back to relative paths', () => {
    const workspace = createWorkspace();
    try {
        clearSyncState(workspace);
        markSyncedBatch(workspace, ['main.cpp'], targetA);

        const filePath = path.join(workspace, 'main.cpp');
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(filePath, future, future);

        const pending = getSyncPendingInfo(workspace, []);
        assert.equal(pending.count, 1);
    } finally {
        clearSyncState(workspace);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('sync state tracks already deleted files per target', () => {
    const workspace = createWorkspace();
    try {
        clearSyncState(workspace);
        fs.unlinkSync(path.join(workspace, 'main.cpp'));

        assert.deepEqual(filterNeedsDelete(workspace, ['main.cpp'], targetA), ['main.cpp']);
        markDeletedBatch(workspace, ['main.cpp'], targetA);

        assert.deepEqual(filterNeedsDelete(workspace, ['main.cpp'], targetA), []);
        assert.deepEqual(filterNeedsDelete(workspace, ['main.cpp'], targetB), ['main.cpp']);
    } finally {
        clearSyncState(workspace);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('deleted sync markers survive unrelated uploads', () => {
    const workspace = createWorkspace();
    try {
        clearSyncState(workspace);
        fs.unlinkSync(path.join(workspace, 'main.cpp'));
        markDeletedBatch(workspace, ['main.cpp'], targetA);

        fs.writeFileSync(path.join(workspace, 'other.cpp'), 'int other() { return 1; }\n', 'utf-8');
        markSyncedBatch(workspace, ['other.cpp'], targetA);

        assert.deepEqual(filterNeedsDelete(workspace, ['main.cpp'], targetA), []);
    } finally {
        clearSyncState(workspace);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});
