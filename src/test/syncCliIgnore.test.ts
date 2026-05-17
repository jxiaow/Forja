import test from 'node:test';
import assert from 'node:assert/strict';
import { isIgnored } from '../core/syncCli';

test('isIgnored returns false for empty ignore list', () => {
    assert.equal(isIgnored('src/main.cpp', []), false);
});

test('isIgnored matches exact directory name', () => {
    assert.equal(isIgnored('build/output.o', ['build']), true);
});

test('isIgnored matches nested path segment', () => {
    assert.equal(isIgnored('src/build/main.o', ['build']), true);
});

test('isIgnored does not match partial segment', () => {
    assert.equal(isIgnored('src/rebuild/main.cpp', ['build']), false);
});

test('isIgnored supports glob wildcard', () => {
    assert.equal(isIgnored('src/main.o', ['*.o']), true);
});

test('isIgnored glob does not match across segments', () => {
    assert.equal(isIgnored('src/lib/test.cpp', ['*.o']), false);
});

test('isIgnored handles Windows backslash paths', () => {
    assert.equal(isIgnored('src\\build\\main.o', ['build']), true);
});

test('isIgnored handles multiple patterns', () => {
    assert.equal(isIgnored('node_modules/pkg/index.js', ['build', 'node_modules', '.git']), true);
});
