import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('sdk activation does not unconditionally switch the unified status bar to SDK', () => {
    const sdkExtension = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'sdkExtension.ts'), 'utf8');
    const unifiedStatusBar = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'unifiedStatusBar.ts'), 'utf8');

    assert.match(unifiedStatusBar, /export function activateSdkModuleIfNoQtProject\(\): void/);
    assert.match(sdkExtension, /activateSdkModuleIfNoQtProject\(\)/);
    assert.doesNotMatch(sdkExtension, /setActiveModule\('sdk'\)/);
});
