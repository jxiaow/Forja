import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { getModeDisplayLabel } from '../ui/statusBarLabels';

test('windows mode label uses full mode and architecture text', () => {
    assert.equal(getModeDisplayLabel('debug', 'x86', true), 'Debug x86');
    assert.equal(getModeDisplayLabel('debug', 'x64', true), 'Debug x64');
    assert.equal(getModeDisplayLabel('release', 'x86', true), 'Release x86');
    assert.equal(getModeDisplayLabel('release', 'x64', true), 'Release x64');
});

test('non-windows mode label uses full mode text without architecture', () => {
    assert.equal(getModeDisplayLabel('debug', 'x64', false), 'Debug');
    assert.equal(getModeDisplayLabel('release', 'x64', false), 'Release');
});

test('status bar uses full display label instead of short label text', () => {
    const statusBarPath = path.join(process.cwd(), 'src', 'ui', 'statusBar.ts');
    const source = fs.readFileSync(statusBarPath, 'utf8');

    assert.doesNotMatch(source, /_modeShortLabel/);
    assert.match(source, /_modeDisplayLabel/);
});
