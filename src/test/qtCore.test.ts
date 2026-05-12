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
    assert.equal(result.candidates.length, 2);
    assert.match(result.nextActions[0], /--project/);
});

test('createActionPlan status returns resolved config and candidates without executing', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'status',
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
    assert.equal(result.commands.length, 0);
    assert.equal(result.project, path.join(workspace, 'demo.pro'));
    assert.equal(result.candidates.length, 1);
    assert.equal(result.resolved?.mode, 'debug');
    assert.equal(result.resolved?.arch, 'x86');
});

test('createActionPlan qmake warns when Qt and VS environment are unresolved', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'qmake',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: null,
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.project, path.join(workspace, 'demo.pro'));
    assert.match(result.commands.join('\n'), /qmake/);
    assert.ok(result.diagnostics.some(d => /Qt 路径未解析/.test(d.message)));
    assert.ok(result.diagnostics.some(d => /VS DevShell 路径未解析/.test(d.message)));
    assert.ok(result.nextActions.some(action => /--qt-path/.test(action)));
    assert.ok(result.nextActions.some(action => /--vs-dev-shell/.test(action)));
});

test('createActionPlan clean generates clean commands', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'clean',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, 'clean');
    assert.ok(result.commands.length > 0);
    assert.match(result.commands.join('\n'), /clean/i);
});

test('createActionPlan init dry-run previews what would be created', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'init',
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
    assert.equal(result.action, 'init');
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.some(d => /\.qtpilot/.test(d.message)));
    assert.ok(result.diagnostics.some(d => /\.gitignore/.test(d.message)));
    assert.ok(result.diagnostics.some(d => /cache\.json/.test(d.message)));
    assert.ok(result.nextActions.some(a => /init --execute/.test(a)));
});
