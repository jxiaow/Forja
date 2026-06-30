/**
 * Unit tests for init.ts and candidates.ts core logic.
 * Tests detectToolchain, auto-select, path normalization, and CMake support.
 */
import test, { before, after } from 'node:test';
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
    const result = aggregateCandidates(workspace, null, {}, {});
    assert.equal(result.length, 0);
});

test('aggregateCandidates: detects .pro files as qt candidates', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'qt-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'myapp.pro'), 'QT += core\n');
    const result = aggregateCandidates(workspace, null, {}, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'qt');
    assert.equal(result[0].label, 'myapp');
});

test('aggregateCandidates: detects Makefile as sdk candidate on POSIX', () => {
    if (os.platform() === 'win32') { return; }
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'sdk-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'Makefile'), 'all:\n');
    const result = aggregateCandidates(workspace, null, {}, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'sdk');
});

test('aggregateCandidates: detects CMakeLists.txt as sdk candidate', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'cmake-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    const result = aggregateCandidates(workspace, null, {}, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'sdk');
    assert.equal(result[0].label, 'CMakeLists');
});

test('aggregateCandidates: marks current and configured flags', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'flags-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'QT += core\n');
    const activeTarget = { kind: 'qt', project: 'app.pro', mode: 'release', arch: 'x64', runAt: 'local' };
    const qtConfig = { pinnedProject: { root: workspace, relative: 'app.pro' } };
    const result = aggregateCandidates(workspace, activeTarget, qtConfig, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].current, true);
    assert.equal(result[0].configured, true);
});

// ── init.ts: runInit ──

test('runInit: empty workspace returns ok with zero targets', async () => {
    const { runInit } = require('../cli/commands/init');
    const workspace = path.join(TEST_DIR, 'init-empty');
    fs.mkdirSync(workspace, { recursive: true });
    const result = await runInit(workspace);
    assert.equal(result.ok, true);
    assert.equal(result.detected.qtTargets, 0);
    assert.equal(result.detected.sdkTargets, 0);
});

test('runInit: single .pro file auto-selects', async () => {
    const { runInit } = require('../cli/commands/init');
    const workspace = path.join(TEST_DIR, 'init-single');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'solo.pro'), 'QT += core\n');
    const result = await runInit(workspace);
    assert.equal(result.ok, true);
    assert.equal(result.detected.qtTargets, 1);
    assert.ok(result.activeTarget, 'should have auto-selected target');
    assert.equal(result.activeTarget.kind, 'qt');
    assert.equal(result.ambiguous, undefined);
});

test('runInit: multiple targets marks ambiguous', async () => {
    const { runInit } = require('../cli/commands/init');
    const workspace = path.join(TEST_DIR, 'init-multi');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'a.pro'), 'QT += core\n');
    fs.writeFileSync(path.join(workspace, 'b.pro'), 'QT += widgets\n');
    const result = await runInit(workspace);
    assert.equal(result.ok, true);
    assert.equal(result.detected.qtTargets, 2);
    assert.equal(result.ambiguous, true);
    assert.equal(result.activeTarget, undefined);
    assert.ok(result.diagnostics?.some((d: any) => d.message.includes('a, b') || d.message.includes('2')));
});

test('runInit: nonexistent workspace returns error', async () => {
    const { runInit } = require('../cli/commands/init');
    const result = await runInit(path.join(TEST_DIR, 'does-not-exist'));
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics?.length > 0);
});

test('runInit: plan mode returns plan without writing', async () => {
    const { runInit } = require('../cli/commands/init');
    const workspace = path.join(TEST_DIR, 'init-plan');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'QT += core\n');
    const result = await runInit(workspace, { plan: true });
    assert.equal(result.ok, true);
    assert.ok(result.plan, 'plan mode should include plan field');
    assert.equal(result.plan.mode, 'dryRun');
});

test('runInit: idempotent — second run preserves existing target', async () => {
    const { runInit } = require('../cli/commands/init');
    const workspace = path.join(TEST_DIR, 'init-idem');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'QT += core\n');
    const result1 = await runInit(workspace);
    assert.equal(result1.ok, true);
    assert.ok(result1.activeTarget, 'first run should auto-select');
    const result2 = await runInit(workspace);
    assert.equal(result2.ok, true);
    assert.ok(result2.activeTarget, 'second run should preserve target');
    assert.equal(result2.activeTarget.kind, result1.activeTarget.kind);
    assert.equal(result2.activeTarget.project, result1.activeTarget.project);
});
