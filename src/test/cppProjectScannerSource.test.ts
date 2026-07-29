import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('C++ project scanner enforces timeout during scan', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'modules', 'projectScanner.ts'), 'utf8');

    assert.match(source, /SCAN_TIMEOUT_MS/);
    assert.match(source, /scanWithTimeout/);
    assert.match(source, /reject\(new Error\('Scan timed out'\)\)/);
});
