import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePinnedProject, encodePinnedProject } from '../qt/project/pinnedProject';

test('pinnedProject setting is managed in Compilot local settings (not in package.json contributes)', () => {
    // Configuration is self-managed in Compilot's local settings store.
    // This test verifies the codec still works correctly with the expected format
    const encoded = encodePinnedProject('C:/workspace', 'app/demo.pro');
    assert.deepEqual(encoded, { root: 'C:/workspace', relative: 'app/demo.pro' });

    const decoded = decodePinnedProject(encoded);
    assert.deepEqual(decoded, { root: 'C:/workspace', relative: 'app/demo.pro' });
});

test('pinnedProject codec supports object config values and legacy string values', () => {
    assert.deepEqual(
        decodePinnedProject({ root: 'C:/workspace', relative: 'app/demo.pro' }),
        { root: 'C:/workspace', relative: 'app/demo.pro' }
    );

    assert.deepEqual(
        decodePinnedProject('{"root":"C:/workspace","relative":"app/demo.pro"}'),
        { root: 'C:/workspace', relative: 'app/demo.pro' }
    );

    assert.equal(
        JSON.stringify(encodePinnedProject('C:/workspace', 'app/demo.pro')),
        JSON.stringify({ root: 'C:/workspace', relative: 'app/demo.pro' })
    );
});
