import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureLocalStateDir,
    isProcessRunning,
    logsDir,
    parsePsPids,
    parseTasklistPids
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

test('isProcessRunning treats non-positive pids as not running', () => {
    assert.equal(isProcessRunning(0), false);
    assert.equal(isProcessRunning(-1), false);
});

test('parseTasklistPids returns matching executable pids', () => {
    const output = [
        '"XYWinQT.exe","13228","Console","1","42,000 K"',
        '"cmd.exe","9988","Console","1","1,000 K"'
    ].join('\r\n');

    assert.deepEqual(
        parseTasklistPids(output, 'C:\\Code\\workspace\\dev\\qt_client\\qt_linux_pc_client\\release\\x86\\XYWinQT.exe'),
        [13228]
    );
});

test('parsePsPids returns matching executable pids', () => {
    const output = [
        '13228 /opt/app/XYWinQT /opt/app/XYWinQT --flag',
        '9988 /bin/sh /bin/sh -c test'
    ].join('\n');

    assert.deepEqual(parsePsPids(output, '/opt/app/XYWinQT'), [13228]);
});
