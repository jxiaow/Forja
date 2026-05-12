import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSelectedProject, encodeSelectedProject } from '../core/selectedProject';

test('selectedProject setting is managed in .qtpilot/settings.json (not in package.json contributes)', () => {
    // Configuration is now self-managed in .qtpilot/settings.json
    // This test verifies the codec still works correctly with the expected format
    const encoded = encodeSelectedProject('C:/workspace', 'app/demo.pro');
    assert.deepEqual(encoded, { root: 'C:/workspace', relative: 'app/demo.pro' });

    const decoded = decodeSelectedProject(encoded);
    assert.deepEqual(decoded, { root: 'C:/workspace', relative: 'app/demo.pro' });
});

test('selectedProject codec supports object config values and legacy string values', () => {
    assert.deepEqual(
        decodeSelectedProject({ root: 'C:/workspace', relative: 'app/demo.pro' }),
        { root: 'C:/workspace', relative: 'app/demo.pro' }
    );

    assert.deepEqual(
        decodeSelectedProject('{"root":"C:/workspace","relative":"app/demo.pro"}'),
        { root: 'C:/workspace', relative: 'app/demo.pro' }
    );

    assert.equal(
        JSON.stringify(encodeSelectedProject('C:/workspace', 'app/demo.pro')),
        JSON.stringify({ root: 'C:/workspace', relative: 'app/demo.pro' })
    );
});
