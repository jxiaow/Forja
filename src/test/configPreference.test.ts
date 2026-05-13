import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('config generator prefers configured qtPath over detected env path', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'configGenerator.ts'), 'utf8');

    assert.match(source, /getEffectiveQtPath/);
    assert.doesNotMatch(source, /state\.envInfo\?\.qt\?\.path/);
});
