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
