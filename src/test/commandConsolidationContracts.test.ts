import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = process.cwd();

function source(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function between(text: string, start: string, end: string): string {
    const startIndex = text.indexOf(start);
    assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
    const endIndex = text.indexOf(end, startIndex);
    assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
    return text.slice(startIndex, endIndex);
}

test('status no longer derives remote readiness from the active target', () => {
    const status = source('src/cli/commands/status.ts');
    const remoteBlock = between(status, '// ── Remote readiness ──', '// ── Build result ──');

    assert.match(remoteBlock, /readiness\.remote = 'not-selected'/);
});

test('status POSIX C++ next action does not suggest unsupported project selection command', () => {
    const status = source('src/cli/commands/status.ts');

    assert.doesNotMatch(status, /forja use cpp --project <path>/);
    assert.match(status, /forja list env/);
});
