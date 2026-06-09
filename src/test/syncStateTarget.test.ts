import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearSyncState, filterNeedsSync, markSyncedBatch, SyncTargetContext } from '../core/syncState';

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

test('sync state keeps legacy non-target behavior for callers without target context', () => {
    const workspace = createWorkspace();
    try {
        clearSyncState(workspace);
        markSyncedBatch(workspace, ['main.cpp']);

        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp']), []);
        assert.deepEqual(filterNeedsSync(workspace, ['main.cpp'], targetA), ['main.cpp']);
    } finally {
        clearSyncState(workspace);
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});
