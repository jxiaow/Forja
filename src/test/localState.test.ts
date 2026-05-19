import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureCompilotGitignored
} from '../qt/shared/localState';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-local-state-'));
    _tmpDirs.push(ws);
    return ws;
}

test('ensureCompilotGitignored appends .compilot/ once', () => {
    const workspace = makeWorkspace();
    ensureCompilotGitignored(workspace);
    ensureCompilotGitignored(workspace);

    const gitignore = fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8');
    assert.equal(gitignore.split('.compilot/').length - 1, 1);
});
