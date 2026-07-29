/**
 * Unit tests for init.ts and candidates.ts core logic.
 * Tests detectToolchain, auto-select, path normalization, and CMake support.
 */
import test, { after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-init-test-'));
const OLD_CONFIG = process.env.FORJA_CONFIG_DIR;
const CONFIG_DIR = path.join(TEST_DIR, 'config');
fs.mkdirSync(CONFIG_DIR);
process.env.FORJA_CONFIG_DIR = CONFIG_DIR;

const cleanup = () => {
    process.env.FORJA_CONFIG_DIR = OLD_CONFIG;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
};

after(cleanup);

// ── candidates.ts: aggregateCandidates ──

test('aggregateCandidates: empty workspace returns no candidates', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'empty-ws');
    fs.mkdirSync(workspace, { recursive: true });
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 0);
});

test('aggregateCandidates: detects .pro files as qt candidates', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'qt-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'myapp.pro'), 'QT += core\n');
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'qt');
    assert.equal(result[0].label, 'myapp');
});

test('aggregateCandidates: detects Makefile as cpp candidate on POSIX', () => {
    if (os.platform() === 'win32') { return; }
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'cpp-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'Makefile'), 'all:\n');
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'cpp');
});

test('aggregateCandidates: detects CMakeLists.txt as cpp candidate', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'cmake-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'cpp');
    assert.equal(result[0].label, 'cmake-ws');
});

test('aggregateCandidates: marks current and configured flags', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'flags-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'QT += core\n');
    const activeProfile = {
        id: 'qt-app-debug-x64',
        name: 'app debug x64',
        kind: 'qt',
        project: 'app.pro',
        mode: 'release',
        arch: 'x64',
        runAt: 'local',
        toolchain: {},
    };
    const savedTargets = [activeProfile];
    const result = aggregateCandidates(workspace, activeProfile, savedTargets);
    assert.equal(result.length, 1);
    assert.equal(result[0].current, true);
    assert.equal(result[0].configured, true);
});
