import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitStatusPorcelainZ } from '../core/gitChangedFiles';

test('parseGitStatusPorcelainZ marks modified and untracked files for upload', () => {
    const changes = parseGitStatusPorcelainZ(' M src/main.cpp\0?? include/new.h\0');

    assert.deepEqual(changes, [
        { path: 'src/main.cpp', kind: 'upload', status: ' M' },
        { path: 'include/new.h', kind: 'upload', status: '??' }
    ]);
});

test('parseGitStatusPorcelainZ marks deleted files for remote deletion', () => {
    const changes = parseGitStatusPorcelainZ(' D src/old.cpp\0D  include/old.h\0');

    assert.deepEqual(changes, [
        { path: 'src/old.cpp', kind: 'delete', status: ' D' },
        { path: 'include/old.h', kind: 'delete', status: 'D ' }
    ]);
});

test('parseGitStatusPorcelainZ expands rename into remote delete and upload', () => {
    const changes = parseGitStatusPorcelainZ('R  src/new.cpp\0src/old.cpp\0');

    assert.deepEqual(changes, [
        { path: 'src/old.cpp', kind: 'delete', status: 'R ', previousPath: 'src/old.cpp' },
        { path: 'src/new.cpp', kind: 'upload', status: 'R ', previousPath: 'src/old.cpp' }
    ]);
});
