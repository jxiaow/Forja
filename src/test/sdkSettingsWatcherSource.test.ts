import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('SDK extension observes unified settingsStore changes instead of old workspace settings file', () => {
    const sdkExtension = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'sdkExtension.ts'), 'utf8');
    const configService = fs.readFileSync(path.join(process.cwd(), 'src', 'sdk', 'modules', 'configService.ts'), 'utf8');

    assert.match(sdkExtension, /onSettingsChange/);
    assert.doesNotMatch(sdkExtension, /onSettingsFileChanged/);
    assert.doesNotMatch(configService, /\.compilot\/settings\.json/);
});
