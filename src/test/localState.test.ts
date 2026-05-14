import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureLocalStateDir,
    ensureCompilotGitignored,
    writeLocalCache
} from '../qt/shared/localState';

function makeWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-local-state-'));
}

test('ensureCompilotGitignored appends .compilot/ once', () => {
    const workspace = makeWorkspace();
    ensureCompilotGitignored(workspace);
    ensureCompilotGitignored(workspace);

    const gitignore = fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8');
    assert.equal(gitignore.split('.compilot/').length - 1, 1);
});

test('writeLocalCache records detected data under .compilot', () => {
    const workspace = makeWorkspace();
    writeLocalCache(workspace, {
        version: 1,
        updatedAt: '2026-04-30T00:00:00.000Z',
        detected: {
            qt: { path: 'D:/Qt', qmake: 'D:/Qt/bin/qmake.exe' },
            vs: { devShellPath: 'C:/VS/Launch-VsDevShell.ps1' },
            projects: [path.join(workspace, 'demo.pro')]
        }
    });

    assert.equal(fs.existsSync(path.join(workspace, '.compilot', 'cache.json')), true);
});
