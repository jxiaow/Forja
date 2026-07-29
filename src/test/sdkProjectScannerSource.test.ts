import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('SDK project scanner enforces timeout during synchronous walk', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'modules', 'projectScanner.ts'), 'utf8');

    assert.match(source, /const deadline = Date\.now\(\) \+ SCAN_TIMEOUT_MS/);
    assert.match(source, /if \(Date\.now\(\) > deadline\) \{ throw new Error\('Scan timed out'\); \}/);
    assert.match(source, /this\.walk\(wsRoot, wsRoot, 0, maxDepth, filePattern, allResults, deadline\)/);
});
