/**
 * Setup command behavior tests
 *
 * Covers:
 * - runSetup: local scan, toolchain detection, nextAction
 * - runSetupRemote: no-server / questions protocol
 * - formatSetupText / formatSetupRemoteText: output correctness
 */
import test, { before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-setup-test-'));
const OLD_CONFIG = process.env.FORJA_CONFIG_DIR;
const CONFIG_DIR = path.join(TEST_DIR, 'config');
fs.mkdirSync(CONFIG_DIR);
process.env.FORJA_CONFIG_DIR = CONFIG_DIR;

after(() => {
    process.env.FORJA_CONFIG_DIR = OLD_CONFIG;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// Dynamic imports after env is set
let runSetup: typeof import('../cli/commands/setup').runSetup;
let runSetupRemote: typeof import('../cli/commands/setup').runSetupRemote;
let formatSetupText: typeof import('../cli/commands/setup').formatSetupText;
let formatSetupRemoteText: typeof import('../cli/commands/setup').formatSetupRemoteText;

before(async () => {
    const mod = await import('../cli/commands/setup');
    runSetup = mod.runSetup;
    runSetupRemote = mod.runSetupRemote;
    formatSetupText = mod.formatSetupText;
    formatSetupRemoteText = mod.formatSetupRemoteText;
});

// ── runSetup (local) ──

test('runSetup: empty workspace returns ok with 0 targets', async () => {
    const workspace = path.join(TEST_DIR, 'empty-ws');
    fs.mkdirSync(workspace, { recursive: true });
    const result = await runSetup(workspace, { json: true });
    assert.equal(result.ok, true);
    assert.equal(result.action, 'setup');
    assert.equal(result.local.qtTargets, 0);
    assert.equal(result.local.sdkTargets, 0);
    assert.equal(result.steps.localConfig, 'done');
    assert.equal(result.nextAction, 'forja build');
});

test('runSetup: nonexistent workspace returns failed', async () => {
    const result = await runSetup(path.join(TEST_DIR, 'nonexistent'), { json: true });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics?.length);
    assert.equal(result.steps.localConfig, 'failed');
});

// ── runSetupRemote ──

test('runSetupRemote: no server in --json mode → returns questions', async () => {
    const workspace = path.join(TEST_DIR, 'remote-no-server');
    fs.mkdirSync(workspace, { recursive: true });
    const result = await runSetupRemote(workspace, { json: true });
    // Should return questions since no server and --json mode
    assert.equal(result.ok, false);
    assert.equal(result.status, 'needs-input');
    assert.ok(result.questions);
    assert.ok(result.questions!.length > 0);
    assert.ok(result.questions!.some(q => q.id === 'host'));
    assert.ok(result.questions!.some(q => q.id === 'username'));
    assert.ok(result.nextAction?.includes('--answers'));
});

// ── formatSetupText ──

test('formatSetupText: shows toolchain with checkmarks', () => {
    const text = formatSetupText({
        ok: true, action: 'setup', workspace: '/test',
        local: {
            qtTargets: 1, sdkTargets: 2, configured: true,
            toolchain: { qt: true, vs: true, jom: false, make: false },
        },
        steps: { localConfig: 'done' },
        nextAction: 'forja build',
    });
    assert.ok(text.includes('Qt ✓'));
    assert.ok(text.includes('VS ✓'));
    assert.ok(!text.includes('jom ✓'));
    assert.ok(text.includes('1 Qt + 2 SDK'));
});

test('formatSetupText: configured=false shows failure', () => {
    const text = formatSetupText({
        ok: false, action: 'setup', workspace: '/test',
        local: { qtTargets: 0, sdkTargets: 0, configured: false, toolchain: {} },
        steps: { localConfig: 'failed' },
    });
    assert.ok(text.includes('✗'));
});

test('formatSetupText: needs-input shows questions', () => {
    const text = formatSetupText({
        ok: false, action: 'setup', workspace: '/test',
        status: 'needs-input',
        questions: [
            { id: 'mode', label: 'Build mode', default: 'release', choices: ['debug', 'release'] },
        ],
        local: { qtTargets: 0, sdkTargets: 0, configured: false, toolchain: {} },
        steps: {},
        nextAction: 'forja setup --json --answers <answers.json>',
    });
    assert.ok(text.includes('Build mode'));
    assert.ok(text.includes('debug|release'));
    assert.ok(text.includes('--answers'));
});

// ── formatSetupRemoteText ──

test('formatSetupRemoteText: shows server info and steps', () => {
    const text = formatSetupRemoteText({
        ok: true, action: 'setup-remote', workspace: '/test',
        remote: {
            serverId: 's1', serverName: 'devbox', host: '192.168.1.10',
            remotePath: '/home/dev/project', syncEnabled: true,
            forjaDeployed: true, forjaVersion: '0.7.50',
            executionMode: 'remote', configured: true,
        },
        steps: {
            localConfig: 'done',
            serverSetup: 'done', remoteConfig: 'done', syncSetup: 'done',
            forjaDeploy: 'skipped', remoteInit: 'done', executionSwitch: 'skipped',
        },
        nextAction: 'forja build',
    });
    assert.ok(text.includes('devbox'));
    assert.ok(text.includes('192.168.1.10'));
    assert.ok(text.includes('/home/dev/project'));
    assert.ok(text.includes('✓'));
    assert.ok(text.includes('–')); // skipped steps
    assert.ok(text.includes('forja build'));
});

// ── runSetup with targets ──

test('runSetup: single .pro target auto-selects and saves', async () => {
    const workspace = path.join(TEST_DIR, 'single-target');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'myapp.pro'), 'SOURCES = main.cpp\n');
    const result = await runSetup(workspace, { json: true });
    assert.equal(result.ok, true);
    assert.equal(result.local.qtTargets, 1);
    assert.equal(result.local.configured, true);
    assert.equal(result.steps.localConfig, 'done');
    assert.equal(result.nextAction, 'forja build');
});

test('runSetup: multiple targets → ambiguous, nextAction = list targets', async () => {
    const workspace = path.join(TEST_DIR, 'multi-target');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'SOURCES = a.cpp\n');
    fs.writeFileSync(path.join(workspace, 'lib.pro'), 'SOURCES = b.cpp\n');
    const result = await runSetup(workspace, { json: true, project: 'app.pro' });
    // With --project resolving ambiguity, should succeed
    assert.equal(result.ok, true);
    assert.equal(result.local.qtTargets, 2);
    assert.equal(result.nextAction, 'forja build');
    // Without --project, --json returns needs-input
    const result2 = await runSetup(workspace, { json: true });
    assert.equal(result2.ok, false);
    assert.equal(result2.status, 'needs-input');
    assert.ok(result2.questions?.some(q => q.id === 'target'));
});

test('runSetup: --project flag selects specific target', async () => {
    const workspace = path.join(TEST_DIR, 'project-flag');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'SOURCES = a.cpp\n');
    fs.writeFileSync(path.join(workspace, 'lib.pro'), 'SOURCES = b.cpp\n');
    const result = await runSetup(workspace, { json: true, project: 'app.pro' });
    assert.equal(result.ok, true);
    assert.equal(result.local.qtTargets, 2);
    assert.equal(result.nextAction, 'forja build');
});

// ── runSetup --reset ──

test('runSetup: --reset on configured workspace re-runs init', async () => {
    const workspace = path.join(TEST_DIR, 'reset-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'SOURCES = a.cpp\n');
    // First run: configure
    const first = await runSetup(workspace, { json: true });
    assert.equal(first.ok, true);
    assert.equal(first.steps.localConfig, 'done');
    // Second run with --reset: should still succeed
    const second = await runSetup(workspace, { json: true, reset: true });
    assert.equal(second.ok, true);
    assert.equal(second.steps.localConfig, 'done');
});

// ── loadAnswers edge cases ──

test('runSetup: --answers with invalid JSON → error', async () => {
    const workspace = path.join(TEST_DIR, 'bad-answers');
    fs.mkdirSync(workspace, { recursive: true });
    const badFile = path.join(TEST_DIR, 'bad-answers.json');
    fs.writeFileSync(badFile, 'not json{{{');
    const result = await runSetup(workspace, { json: true, answers: badFile });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics?.some(d => d.message.includes('answers file') || d.message.includes('答案文件')));
});

test('runSetup: --answers with valid JSON applies answers', async () => {
    const workspace = path.join(TEST_DIR, 'good-answers');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'SOURCES = a.cpp\n');
    const answersFile = path.join(TEST_DIR, 'good-answers.json');
    fs.writeFileSync(answersFile, JSON.stringify({ mode: 'debug', arch: 'x64' }));
    const result = await runSetup(workspace, { json: true, answers: answersFile });
    assert.equal(result.ok, true);
    assert.equal(result.steps.localConfig, 'done');
});

// ── formatSetupRemoteText edge cases ──

test('formatSetupRemoteText: failed steps show ✗', () => {
    const text = formatSetupRemoteText({
        ok: false, action: 'setup-remote', workspace: '/test',
        remote: {
            serverId: 's1', serverName: 'devbox', host: '10.0.0.1',
            remotePath: '/home/dev/proj', syncEnabled: false,
            forjaDeployed: false,
            executionMode: 'local', configured: false,
        },
        steps: {
            localConfig: 'done',
            serverSetup: 'done', remoteConfig: 'done', syncSetup: 'done',
            forjaDeploy: 'failed', remoteInit: 'skipped', executionSwitch: 'skipped',
        },
    });
    assert.ok(text.includes('✗'));
    assert.ok(text.includes('–')); // skipped
    assert.ok(text.includes('devbox'));
});

test('formatSetupRemoteText: needs-input shows questions', () => {
    const text = formatSetupRemoteText({
        ok: false, action: 'setup-remote', workspace: '/test',
        status: 'needs-input',
        questions: [
            { id: 'host', label: 'Host', required: true },
            { id: 'username', label: 'Username', required: true },
        ],
        steps: {},
        nextAction: 'forja setup remote --json --answers <answers.json>',
    });
    assert.ok(text.includes('Host'));
    assert.ok(text.includes('Username'));
    assert.ok(text.includes('--answers'));
});

// ── Issue #5 fix: result.remote populated even on failure ──

test('formatSetupRemoteText: failed steps still show remote info', () => {
    const text = formatSetupRemoteText({
        ok: false, action: 'setup-remote', workspace: '/test',
        remote: {
            serverId: 's1', serverName: 'devbox', host: '10.0.0.1',
            remotePath: '/home/dev/proj', syncEnabled: true,
            forjaDeployed: false,
            executionMode: 'local', configured: false,
        },
        steps: {
            localConfig: 'done',
            serverSetup: 'done', remoteConfig: 'done', syncSetup: 'done',
            forjaDeploy: 'failed', remoteInit: 'skipped', executionSwitch: 'skipped',
        },
    });
    // Should still show remote section with server info
    assert.ok(text.includes('devbox'));
    assert.ok(text.includes('10.0.0.1'));
    assert.ok(text.includes('/home/dev/proj'));
    assert.ok(text.includes('✗')); // failed step
});

// ── Issue #3 fix: setup remote accepts toolchain flags ──

test('runSetupRemote: accepts toolchain flags (qtPath, vsInstall, jomPath)', async () => {
    const workspace = path.join(TEST_DIR, 'remote-toolchain');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'SOURCES = a.cpp\n');
    // This test verifies the flags are accepted without error
    // Actual toolchain detection is tested in init tests
    const result = await runSetupRemote(workspace, {
        json: true,
        qtPath: '/fake/qt/path',
        vsInstall: '/fake/vs/path',
        jomPath: '/fake/jom/path',
    });
    // Should not fail due to unknown flags
    assert.equal(result.action, 'setup-remote');
    // Will fail due to no server, but that's expected
    assert.equal(result.ok, false);
});

// ── #6: needs-input takes priority over remote section ──

test('formatSetupRemoteText: needs-input with remote populated shows questions, not remote', () => {
    const text = formatSetupRemoteText({
        ok: false, action: 'setup-remote', workspace: '/test',
        status: 'needs-input',
        questions: [
            { id: 'host', label: 'Host', required: true },
        ],
        remote: {
            serverId: 's1', serverName: 'devbox', host: '10.0.0.1',
            remotePath: '/home/dev/proj', syncEnabled: false,
            forjaDeployed: false,
            executionMode: 'local', configured: false,
        },
        steps: {},
        nextAction: 'forja setup remote --json --answers <answers.json>',
    });
    assert.ok(text.includes('Host'));
    assert.ok(text.includes('--answers'));
    assert.ok(!text.includes('10.0.0.1'));
});

// ── #10: runSetupRemote with --answers ──

test('runSetupRemote: --answers with valid JSON applies answers', async () => {
    const workspace = path.join(TEST_DIR, 'remote-good-answers');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'SOURCES = a.cpp\n');
    const answersFile = path.join(TEST_DIR, 'remote-good-answers.json');
    fs.writeFileSync(answersFile, JSON.stringify({ mode: 'debug', arch: 'x64' }));
    const result = await runSetupRemote(workspace, { json: true, answers: answersFile });
    assert.equal(result.action, 'setup-remote');
    assert.equal(result.steps.localConfig, 'done');
    // Will fail at server resolution (no server), but local init should succeed
    assert.equal(result.ok, false);
    // With answers provided, status is not 'needs-input' (answers already supplied)
    assert.equal(result.status, undefined);
});

test('runSetupRemote: --answers with invalid JSON → error', async () => {
    const workspace = path.join(TEST_DIR, 'remote-bad-answers');
    fs.mkdirSync(workspace, { recursive: true });
    const badFile = path.join(TEST_DIR, 'remote-bad-answers.json');
    fs.writeFileSync(badFile, '{broken');
    const result = await runSetupRemote(workspace, { json: true, answers: badFile });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics?.some(d => d.message.includes('answers file') || d.message.includes('答案文件')));
});
