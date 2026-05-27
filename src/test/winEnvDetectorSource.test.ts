import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('Windows env detection keeps scanning candidates when manual paths are configured', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'platform', 'win', 'envDetector.ts'), 'utf8');

    assert.match(source, /const vsCandidatesPromise = scanVS\(\)/);
    assert.doesNotMatch(source, /const vsCandidatesPromise = manualVsPath[\s\S]*Promise\.resolve/);
    assert.match(source, /const qtPromise = detectQt\(manualQtPath\)/);
    assert.match(source, /const manualVs = manualVsPath/);
});
