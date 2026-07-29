import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { decodeSelectedProject, encodeSelectedProject } from '../core/selectedProject';

test('selectedProject setting is declared as an object for readable workspace JSON', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        contributes?: {
            configuration?: {
                properties?: Record<string, unknown>;
            };
        };
    };

    const properties = packageJson.contributes?.configuration?.properties as Record<string, any>;
    const selectedProject = properties['qtPilot.selectedProject'];

    assert.equal(selectedProject.type, 'object');
    assert.deepEqual(selectedProject.default, {});
    assert.equal(selectedProject.additionalProperties, false);
    assert.deepEqual(selectedProject.required, ['root', 'relative']);
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
