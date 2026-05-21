import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('compile copy-html step is cross-platform node script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

    assert.equal(pkg.scripts['copy-html'], 'node scripts/copy-html.js');
});
