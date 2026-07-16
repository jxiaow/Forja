import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('sdk activation does not unconditionally switch the status bar to SDK', () => {
    const cppExtension = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'cppExtension.ts'), 'utf8');
    const statusBar = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'statusBar.ts'), 'utf8');

    assert.match(statusBar, /export function activateCppModuleIfNoQtProject\(_?workspace\?: string\): void/);
    assert.match(cppExtension, /activateCppModuleIfNoQtProject\(/);
    assert.doesNotMatch(cppExtension, /setActiveModule\('cpp'\)/);
});
