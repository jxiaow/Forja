import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runQtCli } from '../qt/cli';
import { runLogPath, writeRunState } from '../qt/shared/localState';
import { saveQtSettings, DEFAULT_QT } from '../core/settingsIO';

const _tmpDirs: string[] = [];
const _oldConfigDir = process.env.FORJA_CONFIG_DIR;
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cli-config-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;
_tmpDirs.push(_testConfigDir);

after(() => {
    if (_oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = _oldConfigDir; }
    for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); }
});
beforeEach(() => { process.exitCode = undefined; });
afterEach(() => { process.exitCode = undefined; });

function makeWorkspace(): string {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cli-'));
    _tmpDirs.push(workspace);
    return workspace;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const oldLog = console.log;
    console.log = (message?: unknown) => { chunks.push(String(message ?? '')); };
    try {
        await fn();
    } finally {
        console.log = oldLog;
    }
    return chunks.join('\n');
}

test('qt env text shows mode and arch candidates without mandatory json hint', async () => {
    const workspace = makeWorkspace();

    const output = await captureStdout(() => runQtCli(['env', '--workspace', workspace]));

    assert.match(output, /可用 mode:/);
    assert.match(output, /debug/);
    assert.match(output, /release/);
    assert.match(output, /可用 arch:/);
    assert.match(output, /修改: forja use target --mode/);
    assert.doesNotMatch(output, /修改: .*--json/);
});

test('qt projects text use hint includes optional target without mandatory json hint', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core\n', 'utf8');

    const output = await captureStdout(() => runQtCli(['projects', '--workspace', workspace]));

    assert.match(output, /修改: forja use target --project <path>/);
    assert.doesNotMatch(output, /修改: .*--json/);
});

test('qt init text includes env next step for auto-selected Qt path without mandatory json hints', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'a.pro'), 'TARGET = a\nQT += core\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'b.pro'), 'TARGET = b\nQT += core\n', 'utf8');

    const oldPath = process.env.FORJA_QT_PATH;
    process.env.FORJA_QT_PATH = 'D:/Qt/auto';
    try {
        const output = await captureStdout(() => runQtCli(['init', '--workspace', workspace]));

        assert.match(output, /warning: 部分配置为自动选择/);
        assert.match(output, /下一步:/);
        assert.match(output, /forja list env/);
        assert.doesNotMatch(output, /下一步:[\s\S]*--json/);
    } finally {
        if (oldPath === undefined) { delete process.env.FORJA_QT_PATH; }
        else { process.env.FORJA_QT_PATH = oldPath; }
    }
});


test('qt status reports current target in json and text output', async () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'demo.pro'), 'TARGET = demo\nQT += core\n', 'utf8');
    saveQtSettings(workspace, {
        ...DEFAULT_QT,
        pinnedProject: { root: workspace, relative: 'demo.pro' },
        mode: 'debug',
        arch: process.platform === 'win32' ? 'x86' : 'x64',
        qtPath: 'D:/Qt'
    });

    const jsonOutput = await captureStdout(() => runQtCli(['status', '--workspace', workspace, '--json']));
    const data = JSON.parse(jsonOutput);
    assert.equal(data.ok, true);
    assert.equal(data.resolved.target, 'demo');

    const textOutput = await captureStdout(() => runQtCli(['status', '--workspace', workspace]));
    assert.match(textOutput, /Target: demo/);
});

test('qt ps --json reports no detached run state', async () => {
    const workspace = makeWorkspace();

    const output = await captureStdout(() => runQtCli(['ps', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, false);
    assert.equal(data.action, 'ps');
    assert.equal(data.running, false);
    assert.equal(data.pid, null);
    assert.equal(data.executablePath, null);
    assert.equal(data.logFile, null);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'workspace'), false);
    assert.ok(Array.isArray(data.diagnostics));
    assert.equal(process.exitCode, 1);
});

test('qt ps --json reports stopped state with previous log path', async () => {
    const workspace = makeWorkspace();
    const logFile = runLogPath(workspace);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'line 1\nline 2\n', 'utf8');
    writeRunState(workspace, {
        pid: 99999999,
        exePath: 'demo',
        executablePath: '/tmp/missing-app',
        logFile,
        startedAt: new Date().toISOString()
    });

    const output = await captureStdout(() => runQtCli(['ps', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'ps');
    assert.equal(data.running, false);
    assert.equal(data.pid, null);
    assert.equal(data.executablePath, '/tmp/missing-app');
    assert.equal(data.logFile, logFile);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'tail'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'workspace'), false);
    assert.equal(process.exitCode, 0);
});

test('qt ps --json reports running target pid without launcher pid', async () => {
    const workspace = makeWorkspace();
    const logFile = runLogPath(workspace);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, 'line 1\nline 2\n', 'utf8');
    writeRunState(workspace, {
        pid: 99999999,
        exePath: 'launcher',
        executablePath: process.execPath,
        logFile,
        startedAt: new Date().toISOString()
    });

    const output = await captureStdout(() => runQtCli(['ps', '--workspace', workspace, '--json']));
    const data = JSON.parse(output);

    assert.equal(data.ok, true);
    assert.equal(data.action, 'ps');
    assert.equal(data.running, true);
    assert.equal(data.pid, process.pid);
    assert.equal(data.executablePath, process.execPath);
    assert.equal(data.logFile, logFile);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'launcherPid'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(data, 'workspace'), false);
    assert.equal(process.exitCode, 0);
});
