import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseRuntimeLibPaths, resolveRuntimeTarget } from '../qt/shared/runtimeTarget';

function makeWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-runtime-'));
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
