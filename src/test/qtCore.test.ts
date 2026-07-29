import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createActionPlan } from '../qt/shared/qtCore';

const _tmpDirs: string[] = [];
const _oldConfigDir = process.env.FORJA_CONFIG_DIR;
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-core-config-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;
_tmpDirs.push(_testConfigDir);

after(() => {
    if (_oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = _oldConfigDir; }
    for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); }
});

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-core-'));
    _tmpDirs.push(workspace);
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core gui widgets\n', 'utf8');
    return workspace;
}

function defaultArch(): 'x86' | 'x64' {
    return process.platform === 'win32' ? 'x86' : 'x64';
}

function writeMatchingMakefile(workspace: string, overrides: { mode?: string; arch?: string; qtPath?: string } = {}): void {
    const mode = overrides.mode || 'debug';
    const arch = overrides.arch || defaultArch();
    const qtPath = overrides.qtPath || 'D:/Qt';
    const qmakeBin = process.platform === 'win32' ? 'qmake.exe' : 'qmake';
    const qmakePath = qtPath
        ? `${qtPath.replace(/\\/g, '/')}/bin/${qmakeBin}`
        : qmakeBin;
    const spec = process.platform === 'win32' ? 'win32-msvc' : 'linux-g++';
    const archConfig = process.platform === 'win32' ? ` CONFIG+=${arch}` : '';
    fs.writeFileSync(
        path.join(workspace, 'Makefile'),
        `# Command: "${qmakePath}" demo.pro -spec ${spec} CONFIG+=${mode} CONFIG+=console${archConfig}\n`,
        'utf8'
    );
}

// ── qmake action ──

test('createActionPlan qmake generates qmake commands', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'qmake',
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
    assert.equal(result.project, path.join(workspace, 'demo.pro'));
    assert.match(result.commands.join('\n'), /qmake/);
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
});

// ── clean action ──

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

// ── build action ──

test('build action plan uses CliOptions values', async () => {
    const workspace = makeWorkspace();
    writeMatchingMakefile(workspace, { mode: 'release', arch: 'x64', qtPath: 'D:/Qt-new' });

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

test('build with stale Makefile auto-runs qmake then builds', async () => {
    const workspace = makeWorkspace();
    if (process.platform === 'win32') {
        fs.writeFileSync(path.join(workspace, 'Makefile'), '# Command: "D:/Qt/bin/qmake.exe" demo.pro -spec win32-msvc CONFIG+=release CONFIG+=console CONFIG+=x86\n', 'utf8');
        fs.writeFileSync(path.join(workspace, 'Makefile.Release'), 'DESTDIR_TARGET = release\\demo.exe\n', 'utf8');
    } else {
        fs.writeFileSync(path.join(workspace, 'Makefile'), '# Command: "D:/Qt/bin/qmake" demo.pro -spec linux-g++ CONFIG+=release CONFIG+=console\nTARGET = release/demo\n', 'utf8');
    }

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: defaultArch(),
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.ok(result.commands.length > 0);
    assert.ok(result.diagnostics.some(d => d.level === 'info' && /QMake/.test(d.message)));
});

test('build with matching Makefile still generates commands when Qt path is empty', async () => {
    const workspace = makeWorkspace();
    writeMatchingMakefile(workspace, { mode: 'debug', arch: 'x86', qtPath: '' });

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

    assert.equal(result.ok, true);
    assert.ok(result.commands.length > 0);
});

test('build without project generates build commands', async () => {
    const workspace = makeWorkspace();

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

    assert.equal(result.ok, true);
    assert.ok(result.commands.length > 0);
});

// ── run action ──

test('run without Makefile returns fallback build commands and qmake hint', async () => {
    const workspace = makeWorkspace();

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
    assert.ok(result.commands.length > 0, 'should return fallback build commands');
    assert.ok(result.diagnostics.some(d => /Makefile/.test(d.message)));
    assert.ok(!!result.nextAction);
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
    assert.ok(!!result.nextAction);
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
    assert.ok(result.commands.length >= 2);
    assert.ok(result.commands.some(c => /demo/.test(c)));
    assert.equal(result.executablePath, path.join(workspace, process.platform === 'win32' ? 'debug\\demo.exe' : 'debug/demo'));
    assert.ok(!result.diagnostics.some(d => /Makefile/.test(d.message)));
});

test('run resolves a relative project from workspace instead of process cwd', async () => {
    const workspace = makeWorkspace();
    writeMatchingMakefile(workspace);
    if (process.platform === 'win32') {
        fs.writeFileSync(path.join(workspace, 'Makefile.Debug'), 'DESTDIR_TARGET = debug\\demo.exe\n', 'utf8');
    } else {
        fs.appendFileSync(path.join(workspace, 'Makefile'), 'TARGET = debug/demo\n', 'utf8');
    }

    const result = await createActionPlan({
        action: 'run',
        executionMode: 'dryRun',
        workspace,
        project: 'demo.pro',
        mode: 'debug',
        arch: defaultArch(),
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.executablePath, path.join(workspace, process.platform === 'win32' ? 'debug\\demo.exe' : 'debug/demo'));
    assert.ok(result.commands.some(command => /demo/.test(command)));
    assert.ok(!result.diagnostics.some(diagnostic => /无法解析可执行文件/.test(diagnostic.message)));
});

test('run uses configured runtime process name only for pre-run stop', async () => {
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
    assert.equal(result.executablePath, path.join(workspace, process.platform === 'win32' ? 'debug\\demo.exe' : 'debug/demo'));
    assert.ok(result.commands.some(c => /demo/.test(c)));
});

// ── error cases ──

test('workspace not exist returns error diagnostic', async () => {
    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace: path.join(os.tmpdir(), 'forja-nonexistent-' + Date.now()),
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

test('unsupported action returns error diagnostic', async () => {
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

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(d => d.level === 'error' && /不支持的 action/.test(d.message)));
});

test('non-existent qtPath still generates commands', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: 'Z:/nonexistent/qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.ok(result.commands.length > 0);
});

// ── jomPath pass-through ──

test('jomPath is passed through to resolved config', async () => {
    const workspace = makeWorkspace();

    const result = await createActionPlan({
        action: 'build',
        executionMode: 'dryRun',
        workspace,
        project: path.join(workspace, 'demo.pro'),
        mode: 'debug',
        arch: 'x86',
        qtPath: 'D:/Qt',
        vsDevShell: 'C:/VS/Launch-VsDevShell.ps1',
        target: null,
        jomPath: 'C:/Qt/Tools/jom/jom.exe',
        saveLocal: false,
        json: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.resolved?.jomPath, 'C:/Qt/Tools/jom/jom.exe');
});
