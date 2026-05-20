import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureLocalStateDir,
    logsDir
} from '../qt/shared/localState';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-local-state-'));
    _tmpDirs.push(ws);
    return ws;
}

test('ensureLocalStateDir creates logs directory only', () => {
    const workspace = makeWorkspace();
    ensureLocalStateDir(workspace);

    // Logs dir should exist
    assert.equal(fs.existsSync(logsDir(workspace)), true);
    // .compilot/ should NOT be created in project directory
    assert.equal(fs.existsSync(path.join(workspace, '.compilot')), false);
});
