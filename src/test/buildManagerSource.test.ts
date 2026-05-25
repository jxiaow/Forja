import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('vscode qt run stops the previous executable before building', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'buildManager.ts'), 'utf8');
    const runStart = source.indexOf('export async function run()');
    const rccStart = source.indexOf('export function rcc()', runStart);
    const runSource = source.slice(runStart, rccStart);

    const killIndex = runSource.indexOf('await _killApp(');
    const buildIndex = runSource.indexOf('builder.buildCommands(cfg)');

    assert.notEqual(killIndex, -1);
    assert.notEqual(buildIndex, -1);
    assert.ok(killIndex < buildIndex, 'run must stop the old executable before the build starts');
});

test('vscode qt pre-run kill tolerates a missing executable process', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'buildManager.ts'), 'utf8');
    const killStart = source.indexOf('function _killApp(');
    const resolveStart = source.indexOf('function _resolveMakefileInfo()', killStart);
    const killSource = source.slice(killStart, resolveStart);

    assert.notEqual(killStart, -1);
    assert.match(killSource, /builder\.killApp\(exeName\)/);
    assert.doesNotMatch(killSource, /taskkill \/F \/IM/);
    assert.doesNotMatch(killSource, /pkill -x/);
});
