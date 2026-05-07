import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createActionPlan } from '../coreCli/qtCore';
import { writeLocalConfig } from '../coreCli/localState';

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-pilot-core-'));
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core gui widgets\n', 'utf8');
    return workspace;
}

test('createActionPlan uses local config when CLI args are omitted', async () => {
    const workspace = makeWorkspace();
    const project = path.join(workspace, 'demo.pro');
    writeLocalConfig(workspace, {
        version: 1,
        workspace,
        project,
        mode: 'release',
        arch: 'x64',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        qmakeTarget: ''
    });

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: null,
        mode: null,
        arch: null,
        qtPath: null,
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.workspace, workspace);
    assert.equal(result.project, project);
    assert.match(result.commands.join('\n'), /jom/);
});

test('createActionPlan reports multiple projects without explicit project', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'other.pro'), 'TARGET = other\n', 'utf8');

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: null,
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].level, 'error');
    assert.match(result.diagnostics[0].message, /发现多个 .pro 文件/);
});
