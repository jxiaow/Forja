import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureLocalStateDir,
    ensureQtpilotGitignored,
    writeLocalCache
} from '../qt/shared/localState';

function makeWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-local-state-'));
}

test('ensureQtpilotGitignored appends .qtpilot/ once', () => {
    const workspace = makeWorkspace();
    ensureQtpilotGitignored(workspace);
    ensureQtpilotGitignored(workspace);

    const gitignore = fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8');
    assert.equal(gitignore.split('.qtpilot/').length - 1, 1);
});

test('writeLocalCache records detected data under .qtpilot', () => {
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

    assert.equal(fs.existsSync(path.join(workspace, '.qtpilot', 'cache.json')), true);
});
