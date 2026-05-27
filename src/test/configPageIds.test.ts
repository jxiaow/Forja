import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfigPageId } from '../ui/configPanel/pageIds';

test('config page command defaults to project page without an argument', () => {
    assert.equal(normalizeConfigPageId(undefined), 'project');
});

test('config page command rejects unknown page ids', () => {
    assert.equal(normalizeConfigPageId('missing'), 'project');
});

test('config page command keeps valid page ids', () => {
    assert.equal(normalizeConfigPageId('sync'), 'sync');
});
