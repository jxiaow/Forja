import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ensureLocalStateDir,
    ensureQtpilotGitignored,
    readLocalConfig,
    writeLocalConfig,
    writeLocalCache
} from '../coreCli/localState';

function makeWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-local-state-'));
}

test('local state writes and reads config under .qtpilot', () => {
    const workspace = makeWorkspace();
    ensureLocalStateDir(workspace);
    writeLocalConfig(workspace, {
        version: 1,
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        qmakeTarget: ''
    });

    const config = readLocalConfig(workspace);
    assert.equal(config?.workspace, workspace);
    assert.equal(config?.mode, 'debug');
});

test('ensureQtpilotGitignored appends .qtpilot/ once', () => {
    const workspace = makeWorkspace();
    ensureQtpilotGitignored(workspace);
    ensureQtpilotGitignored(workspace);

    const gitignore = fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8');
    assert.equal(gitignore.split('.qtpilot/').length - 1, 1);
});

test('writeLocalCache records detected data separately from config', () => {
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
    assert.equal(fs.existsSync(path.join(workspace, '.qtpilot', 'config.json')), false);
});
