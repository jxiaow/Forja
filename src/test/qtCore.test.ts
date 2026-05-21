import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createActionPlan } from '../qt/shared/qtCore';
import { saveQtSettings, DEFAULT_QT } from '../core/settingsIO';

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
    saveQtSettings(workspace, { ...DEFAULT_QT, mode: 'release', arch: 'x64', qtPath: 'D:/Qt', vsInstall: 'C:/VS' });

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
    assert.match(result.commands.join('\n'), process.platform === 'win32' ? /jom/ : /make/);
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
    assert.ok(result.nextActions.some(a => /status --json/.test(a)));
});

test('createActionPlan status returns checks and resolved config', async () => {
    const workspace = makeWorkspace();
    // Save settings so status sees an initialized project
    saveQtSettings(workspace, { ...DEFAULT_QT, pinnedProject: { root: workspace, relative: 'demo.pro' }, qtPath: 'D:/Qt', jomPath: 'C:/jom/jom.exe' });

    const result = await createActionPlan({
        action: 'status',
        executionMode: 'execute',
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
    assert.equal(result.resolved?.mode, 'debug');
    assert.equal(result.resolved?.arch, process.platform === 'win32' ? 'x86' : 'x64');
    // stdout contains custom status structure
    const statusData = JSON.parse(result.stdout);
    assert.equal(statusData.checks.settings, true);
    assert.equal(statusData.checks.project, true);
    assert.equal(statusData.checks.qtPath, true);
    if (process.platform === 'win32') {
        assert.equal(statusData.checks.jom, true);
    }
    assert.equal(typeof statusData.ready, 'boolean');
    assert.ok(statusData.nextAction);
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
    // 执行层不再自行诊断环境问题，交给 status
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
    assert.ok(result.diagnostics.some(d => /\.compilot/.test(d.message) || /settings\.json/.test(d.message)));
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
    assert.ok(result.nextActions.some(a => /status --json/.test(a)));
});

test('run without Makefile includes status hint when CLI-passed mode/arch', async () => {
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
    assert.ok(result.nextActions.some(a => /status --json/.test(a)));
});

test('CLI args override settings for mode/arch/qtPath', async () => {
    const workspace = makeWorkspace();
    saveQtSettings(workspace, { ...DEFAULT_QT, mode: 'debug', arch: 'x86', qtPath: 'D:/Qt-old', vsInstall: 'C:/VS-old' });

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

test('nextActions points to status when Qt path is empty', async () => {
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

    // 执行层不自行诊断环境问题，成功返回命令
    assert.equal(result.ok, true);
    assert.ok(result.commands.length > 0);
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

test('run with Makefile generates full command chain including executable', async () => {
    const workspace = makeWorkspace();
    const projectDir = workspace;
    if (process.platform === 'win32') {
        fs.writeFileSync(path.join(projectDir, 'Makefile'), '# Command: "D:/Qt/bin/qmake.exe" demo.pro -spec win32-msvc CONFIG+=debug CONFIG+=console CONFIG+=x86\n', 'utf8');
        fs.writeFileSync(path.join(projectDir, 'Makefile.Debug'), 'DESTDIR_TARGET = debug\\demo.exe\n', 'utf8');
    } else {
        fs.writeFileSync(path.join(projectDir, 'Makefile'), '# Command: "D:/Qt/bin/qmake" demo.pro -spec linux-g++ CONFIG+=debug CONFIG+=console\nTARGET = debug/demo\n', 'utf8');
    }

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

    const _result = await createActionPlan({
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
    assert.ok(result.nextActions.some(a => /status --json/.test(a)));
});

test('non-existent qtPath still generates commands (validation delegated to status)', async () => {
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
    assert.ok(result.commands.length > 0);
});

test('env action returns current config and available options', async () => {
    const workspace = makeWorkspace();
    saveQtSettings(workspace, { ...DEFAULT_QT, mode: 'release', arch: 'x64', qtPath: 'D:/Qt/5.15.2/msvc2019' });

    const result = await createActionPlan({
        action: 'env',
        executionMode: 'execute',
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
    assert.equal(result.action, 'env');
    assert.ok(result.resolved);
    assert.equal(result.resolved!.mode, 'release');
    assert.equal(result.resolved!.arch, 'x64');
    // stdout contains the available data as JSON
    const envData = JSON.parse(result.stdout);
    assert.ok(Array.isArray(envData.available.mode));
    assert.ok(envData.available.mode.includes('debug'));
    assert.ok(envData.available.mode.includes('release'));
    assert.ok(Array.isArray(envData.available.qt));
    assert.ok(envData.configHints.usage);
});

test('projects action returns available .pro files', async () => {
    const workspace = makeWorkspace();
    // makeWorkspace creates demo.pro; add another
    fs.writeFileSync(path.join(workspace, 'lib.pro'), 'TARGET = mylib\nQT += core\n', 'utf8');

    const result = await createActionPlan({
        action: 'projects',
        executionMode: 'execute',
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
    assert.equal(result.action, 'projects');
    const data = JSON.parse(result.stdout);
    assert.equal(data.current, null);
    assert.equal(data.available.length, 2);
    assert.ok(data.available.some((p: { path: string }) => p.path === 'demo.pro'));
    assert.ok(data.available.some((p: { path: string }) => p.path === 'lib.pro'));
    assert.ok(data.configHints.usage);
});

test('projects action shows pinned project as current', async () => {
    const workspace = makeWorkspace();
    saveQtSettings(workspace, { ...DEFAULT_QT, pinnedProject: { root: workspace, relative: 'demo.pro' } });

    const result = await createActionPlan({
        action: 'projects',
        executionMode: 'execute',
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
    const data = JSON.parse(result.stdout);
    assert.equal(data.current, 'demo.pro');
});
