import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('package exposes qt-pilot bin entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.bin['qt-pilot'], './out/cli/index.js');
});

test('cli entry handles parse errors as json when requested', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /parseCliArgs/);
    assert.match(source, /JSON\.stringify/);
    assert.match(source, /process\.exitCode = 1/);
});
