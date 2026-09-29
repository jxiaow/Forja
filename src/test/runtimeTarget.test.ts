import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseRuntimeLibPaths, resolveRuntimeTarget, buildRenameCommand, missingQmakeBin } from '../qt/shared/runtimeTarget';

const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-runtime-'));
    _tmpDirs.push(ws);
    return ws;
}

test('resolveRuntimeTarget reads windows makefile output path', () => {
    const workspace = makeWorkspace();
    fs.writeFileSync(path.join(workspace, 'Makefile'), '# Command: qmake demo.pro -spec win32-msvc CONFIG+=debug CONFIG+=console CONFIG+=x86\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'Makefile.Debug'), 'DESTDIR_TARGET = debug\\demo.exe\n', 'utf8');

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
        const result = resolveRuntimeTarget(workspace, 'debug', 'x86');
        assert.equal(result?.target, 'demo');
        assert.equal(result?.exePath, path.join(workspace, 'debug', 'demo.exe'));
    } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
});

test('parseRuntimeLibPaths reads library search paths from makefile', () => {
    const workspace = makeWorkspace();
    const libDir = path.join(workspace, 'lib');
    fs.mkdirSync(libDir);
    fs.writeFileSync(path.join(workspace, 'Makefile'), `LIBS = -L${libDir} -lQt5Core\n`, 'utf8');

    const result = parseRuntimeLibPaths(workspace);
    assert.deepEqual(result, [libDir]);
});

// ── buildRenameCommand ──

function withPlatform<T>(platform: string, fn: () => T): T {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: platform });
    try { return fn(); } finally { Object.defineProperty(process, 'platform', { value: original }); }
}

test('buildRenameCommand uses move /Y on windows so an existing target is overwritten', () => {
    withPlatform('win32', () => {
        const exePath = 'C:\\work\\debug\\demo.exe';
        const desiredPath = 'C:\\work\\debug\\MyApp.exe';
        const cmds = buildRenameCommand(exePath, 'demo', 'MyApp');
        assert.equal(cmds.length, 1);
        assert.equal(cmds[0], `(if exist "${exePath}" move /Y "${exePath}" "${desiredPath}")`);
    });
});

test('buildRenameCommand uses mv -f with posix quoting on linux', () => {
    withPlatform('linux', () => {
        const cmds = buildRenameCommand('/work/debug/demo', 'demo', "My App");
        const expectedPath = path.join('/work/debug', 'My App');
        assert.deepEqual(cmds, [`mv -f '/work/debug/demo' '${expectedPath}'`]);
    });
});

test('buildRenameCommand returns nothing when names already match', () => {
    withPlatform('win32', () => {
        assert.deepEqual(buildRenameCommand('C:\\w\\demo.exe', 'demo', 'demo.exe'), []);
        assert.deepEqual(buildRenameCommand('C:\\w\\demo.exe', 'demo', undefined), []);
    });
});

// ── missingQmakeBin ──

test('missingQmakeBin returns null for empty path, qmake path when absent, null when present', () => {
    withPlatform('linux', () => {
        assert.equal(missingQmakeBin(''), null);
        const qtRoot = makeWorkspace();
        assert.equal(missingQmakeBin(qtRoot), path.join(qtRoot, 'bin', 'qmake'));
        fs.mkdirSync(path.join(qtRoot, 'bin'));
        fs.writeFileSync(path.join(qtRoot, 'bin', 'qmake'), '#!/bin/sh\n', 'utf8');
        assert.equal(missingQmakeBin(qtRoot), null);
    });
});
