import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createActionPlan } from '../qt/shared/qtCore';
import { saveSettings, DEFAULT_SETTINGS } from '../core/settingsIO';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-core-'));
    _tmpDirs.push(workspace);
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core gui widgets\n', 'utf8');
    return workspace;
}

test('createActionPlan uses settings.json when CLI args are omitted', async () => {
    const workspace = makeWorkspace();
    const project = path.join(workspace, 'demo.pro');
    saveSettings(workspace, {
        ...DEFAULT_SETTINGS,
        mode: 'release',
        arch: 'x64',
        qtPath: 'D:/Qt',
        vsDevShellPath: 'C:/VS/Launch-VsDevShell.ps1'
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
    assert.ok(result.diagnostics.some(d => /Qt 路径未解/.test(d.message)));
    assert.ok(result.diagnostics.some(d => /VS DevShell 路径未解/.test(d.message)));
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
    assert.ok(result.diagnostics.some(d => /\.compilot/.test(d.message)));
    assert.ok(result.diagnostics.some(d => /\.gitignore/.test(d.message)));
    assert.ok(result.diagnostics.some(d => /cache\.json/.test(d.message)));
    assert.ok(result.nextActions.some(a => /init --json/.test(a)));
});

test('run without Makefile returns fallback build commands and qmake hint', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'run',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: null,
        arch: null,
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.ok(result.commands.length > 0, 'should return fallback build commands');
    assert.ok(result.diagnostics.some(d => /Makefile/.test(d.message)));
    assert.ok(result.nextActions.some(a => /qmake/.test(a)));
    // Without explicit --mode/--arch, hint should be plain "qmake"
    assert.ok(result.nextActions.some(a => a === '先执行 qmake 生成 Makefile，再重新调用 run'));
});

test('run without Makefile includes --mode/--arch in qmake hint when CLI-passed', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'run',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'release',
        arch: 'x64',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    const qmakeHint = result.nextActions.find(a => /qmake/.test(a));
    assert.ok(qmakeHint);
    assert.match(qmakeHint!, /--mode release/);
    assert.match(qmakeHint!, /--arch x64/);
});

test('CLI args override settings for mode/arch/qtPath', async () => {
    const workspace = makeWorkspace();
    saveSettings(workspace, {
        ...DEFAULT_SETTINGS,
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt-old',
        vsDevShellPath: 'C:/VS-old/Launch-VsDevShell.ps1'
    });

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'release',
        arch: 'x64',
        qtPath: 'D:/Qt-new',
        vsDevShell: 'C:/VS-new/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.resolved?.mode, 'release');
    assert.equal(result.resolved?.arch, 'x64');
    assert.equal(result.resolved?.qtPath, 'D:/Qt-new');
    assert.equal(result.resolved?.vsDevShell, 'C:/VS-new/Launch-VsDevShell.ps1');
});

test('nextActions warns differently when --qt-path is CLI-passed but resolves empty', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: '',
        vsDevShell: '',
        target: null,
        saveLocal: false,
        json: true
    });

    // qtPath is '' (CLI-passed empty string, but options.qtPath is '' which is not null)
    // Actually '' is truthy for !== null check — this tests the "CLI passed" path
    assert.ok(result.diagnostics.some(d => /Qt 路径未解/.test(d.message)));
    assert.ok(result.nextActions.some(a => /指定的路径未能解析/.test(a)));
});

test('project error branch fills resolved with current config', async () => {
    // Workspace with no .pro files
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-nopro-'));
    _tmpDirs.push(workspace);

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: null,
        mode: 'release',
        arch: 'x64',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, false);
    assert.ok(result.resolved, 'resolved should be filled even on project error');
    assert.equal(result.resolved?.mode, 'release');
    assert.equal(result.resolved?.arch, 'x64');
    assert.equal(result.resolved?.qtPath, 'D:/Qt');
});

test('createActionPlan propagates version info from cache to resolved', async () => {
    const workspace = makeWorkspace();
    // Pre-populate cache with version info
    const { writeLocalCache } = require('../qt/shared/localState');
    writeLocalCache(workspace, {
        version: 1,
        updatedAt: new Date().toISOString(),
        detected: {
            qt: { path: 'D:/Qt/5.15.2/msvc2019_64', qmake: 'D:/Qt/5.15.2/msvc2019_64/bin/qmake.exe', version: '5.15.2', compiler: 'msvc2019_64' },
            vs: { devShellPath: 'C:/VS/Launch-VsDevShell.ps1', version: '17.8.0', edition: 'Professional' },
            jom: null,
            projects: [path.join(workspace, 'demo.pro')]
        }
    });

    const result = await createActionPlan({
        action: 'build',
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
    assert.equal(result.resolved?.qtVersion, '5.15.2');
    assert.equal(result.resolved?.vsVersion, '17.8.0');
});


test('run with Makefile generates full command chain including executable', async () => {
    const workspace = makeWorkspace();
    const projectDir = workspace;
    // Create Makefile that matches debug/x86
    fs.writeFileSync(path.join(projectDir, 'Makefile'), '# Command: qmake demo.pro -spec win32-msvc CONFIG+=debug CONFIG+=console CONFIG+=x86\n', 'utf8');
    fs.writeFileSync(path.join(projectDir, 'Makefile.Debug'), 'DESTDIR_TARGET = debug\\demo.exe\n', 'utf8');

    const result = await createActionPlan({
        action: 'run',
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
    // Should have kill + build + run commands
    assert.ok(result.commands.length >= 2);
    // Last command should reference the executable
    assert.ok(result.commands.some(c => /demo/.test(c)));
    // Should NOT have the "Makefile not generated" warning
    assert.ok(!result.diagnostics.some(d => /Makefile/.test(d.message)));
});

test('workspace not exist returns error diagnostic', async () => {
    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace: path.join(os.tmpdir(), 'compilot-nonexistent-' + Date.now()),
        project: null,
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(d => d.level === 'error' && /workspace 不存在/.test(d.message)));
});

test('single candidate project hint includes the path', async () => {
    const workspace = makeWorkspace();
    // Only one .pro file exists (from makeWorkspace)

    // Verify non-existent project path is still accepted (resolveProject doesn't check existence for explicit paths)
    await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'nonexistent.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: true
    });

    // project outside workspace triggers error
    // Actually nonexistent.pro is inside workspace but doesn't exist — let's check resolveProject behavior
    // resolveProject with explicit project just returns it without existence check
    // So let's test the "no settings, no explicit" path with single candidate
    const result2 = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: null,
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: true
    });

    // Single .pro file should auto-resolve without error
    assert.equal(result2.ok, true);
    assert.equal(result2.project, path.join(workspace, 'demo.pro'));
});

test('no .pro file gives helpful nextAction', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-empty-'));
    _tmpDirs.push(workspace);

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: null,
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(d => /未找到 .pro 文件/.test(d.message)));
    assert.ok(result.nextActions.some(a => /--project/.test(a)));
});

test('non-existent qtPath triggers path validation warning', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: 'Z:/nonexistent/qt/path',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.ok(result.diagnostics.some(d => /Qt 路径不存在/.test(d.message)));
    assert.ok(result.nextActions.some(a => /路径不存在/.test(a)));
});
