import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('cpp activation does not unconditionally switch the status bar to C++', () => {
    const cppExtension = fs.readFileSync(path.join(process.cwd(), 'src', 'cpp', 'cppExtension.ts'), 'utf8');
    const statusBar = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'statusBar.ts'), 'utf8');

    // activateCppModuleIfNoQtProject has been removed — C++ module is only activated via status bar
    assert.doesNotMatch(statusBar, /export function activateCppModuleIfNoQtProject/);
    assert.doesNotMatch(cppExtension, /activateCppModuleIfNoQtProject/);
    assert.doesNotMatch(cppExtension, /setActiveModule\('cpp'\)/);
});
