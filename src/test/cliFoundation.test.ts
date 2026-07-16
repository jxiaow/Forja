import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    loadWorkspacesRegistry,
    saveWorkspacesRegistry,
    loadWorkspaceConfig,
    saveWorkspaceConfig,
    resolveWorkroot,
    registerWorkroot,
    isWorkrootRegistered,
    generateTargetId,
    getActiveTarget,
    createEmptyWorkspaceConfig,
    normalizePath,
    type TargetProfile,
} from '../core/workspaceStore';
import { getActiveTarget as getActiveTargetCli, requireActiveTarget } from '../cli/commands/activeTarget';
import { collectTargetCandidates } from '../cli/commands/candidates';
import { resolveLocale, readinessText } from '../cli/commands/types';

const _tmpDirs: string[] = [];
const _oldConfigDir = process.env.FORJA_CONFIG_DIR;
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cli-foundation-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;
_tmpDirs.push(_testConfigDir);

after(() => {
    if (_oldConfigDir === undefined) { delete process.env.FORJA_CONFIG_DIR; }
    else { process.env.FORJA_CONFIG_DIR = _oldConfigDir; }
    for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); }
});

function makeWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cli-ws-'));
    _tmpDirs.push(ws);
    return ws;
}

function makeRegisteredWorkspace(): string {
    const ws = makeWorkspace();
    registerWorkroot(ws);
    return ws;
}

// ── WorkspaceStore registry ──

test('loadWorkspacesRegistry returns empty when no file exists', () => {
    const registry = loadWorkspacesRegistry();
    assert.deepEqual(registry.workroots, []);
});

test('registerWorkroot adds to registry', () => {
    const ws = makeWorkspace();
    registerWorkroot(ws);
    assert.ok(isWorkrootRegistered(ws));
});

test('registerWorkroot is idempotent', () => {
    const ws = makeWorkspace();
    registerWorkroot(ws);
    registerWorkroot(ws);
    const registry = loadWorkspacesRegistry();
    const matches = registry.workroots.filter(w => normalizePath(w) === normalizePath(ws));
    assert.equal(matches.length, 1);
});

// ── WorkspaceStore config ──

test('loadWorkspaceConfig returns empty config when no file exists', () => {
    const ws = makeWorkspace();
    const config = loadWorkspaceConfig(ws);
    assert.equal(config.activeTarget, null);
    assert.deepEqual(config.targets, {});
});

test('saveWorkspaceConfig + loadWorkspaceConfig round-trip', () => {
    const ws = makeWorkspace();
    const config = createEmptyWorkspaceConfig(ws);
    const profile: TargetProfile = {
        id: 'qt-app-debug-x64',
        name: 'app debug x64',
        kind: 'qt',
        project: 'apps/client/client.pro',
        mode: 'debug',
        arch: 'x64',
        runAt: 'local',
        toolchain: { qtPath: '/qt/6.5', vsInstall: '/vs/2019' },
    };
    config.targets[profile.id] = profile;
    config.activeTarget = profile.id;
    saveWorkspaceConfig(config);

    const loaded = loadWorkspaceConfig(ws);
    assert.equal(loaded.activeTarget, 'qt-app-debug-x64');
    assert.equal(loaded.targets['qt-app-debug-x64'].kind, 'qt');
    assert.equal(loaded.targets['qt-app-debug-x64'].project, 'apps/client/client.pro');
    assert.equal(loaded.targets['qt-app-debug-x64'].toolchain.qtPath, '/qt/6.5');
});

test('saveWorkspaceConfig sdk kind round-trip', () => {
    const ws = makeWorkspace();
    const config = createEmptyWorkspaceConfig(ws);
    const profile: TargetProfile = {
        id: 'sdk-lib-release-x86',
        name: 'lib release x86',
        kind: 'cpp',
        project: 'sdk/NemoSDK.sln',
        mode: 'release',
        arch: 'x86',
        runAt: 'remote',
        toolchain: { vsInstall: '/vs/2022' },
    };
    config.targets[profile.id] = profile;
    config.activeTarget = profile.id;
    saveWorkspaceConfig(config);

    const loaded = loadWorkspaceConfig(ws);
    assert.equal(loaded.targets['sdk-lib-release-x86'].kind, 'cpp');
    assert.equal(loaded.targets['sdk-lib-release-x86'].runAt, 'remote');
});

test('loadWorkspaceConfig sanitizes invalid data', () => {
    const ws = makeWorkspace();
    const config = createEmptyWorkspaceConfig(ws);
    config.targets['bad'] = {
        id: 'bad',
        name: 'bad',
        kind: 'qt',
        project: 'test.pro',
        mode: 'debug',
        arch: 'x64',
        runAt: 'local',
        toolchain: {},
    };
    config.activeTarget = 'bad';
    saveWorkspaceConfig(config);

    // Corrupt the file
    const { workspaceConfigPath } = require('../core/workspaceStore');
    const filePath = workspaceConfigPath(ws);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    raw.targets.bad.kind = 'invalid';
    raw.targets.bad.mode = 'invalid';
    fs.writeFileSync(filePath, JSON.stringify(raw));

    const loaded = loadWorkspaceConfig(ws);
    // Should sanitize to defaults
    assert.equal(loaded.targets['bad'].kind, 'qt'); // 'invalid' → 'qt' (default)
    assert.equal(loaded.targets['bad'].mode, 'debug'); // 'invalid' → 'debug' (default)
});

// ── resolveWorkroot ──

test('resolveWorkroot returns null when no workroots registered', () => {
    const ws = makeWorkspace();
    assert.equal(resolveWorkroot(ws), null);
});

test('resolveWorkroot finds exact match', () => {
    const ws = makeRegisteredWorkspace();
    assert.equal(normalizePath(resolveWorkroot(ws)!), normalizePath(ws));
});

test('resolveWorkroot finds parent workroot from subdirectory', () => {
    const ws = makeRegisteredWorkspace();
    const sub = path.join(ws, 'src', 'app');
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(normalizePath(resolveWorkroot(sub)!), normalizePath(ws));
});

test('resolveWorkroot returns deepest match for nested workroots', () => {
    const outer = makeRegisteredWorkspace();
    const inner = path.join(outer, 'subproject');
    fs.mkdirSync(inner, { recursive: true });
    registerWorkroot(inner);

    const deepSub = path.join(inner, 'src');
    fs.mkdirSync(deepSub, { recursive: true });
    assert.equal(normalizePath(resolveWorkroot(deepSub)!), normalizePath(inner));
});

// ── generateTargetId ──

test('generateTargetId creates expected format', () => {
    const id = generateTargetId('qt', 'app/app.pro', 'debug', 'x64');
    assert.equal(id, 'qt-app-debug-x64');
});

test('generateTargetId appends hash on conflict', () => {
    const existing = new Set(['qt-app-debug-x64']);
    const id = generateTargetId('qt', 'app/app.pro', 'debug', 'x64', existing);
    assert.ok(id.startsWith('qt-app-debug-x64-'));
    assert.ok(id.length > 'qt-app-debug-x64'.length);
});

// ── activeTarget CLI wrapper ──

test('getActiveTarget (CLI) returns null when none saved', () => {
    const ws = makeRegisteredWorkspace();
    assert.equal(getActiveTargetCli(ws), null);
});

test('getActiveTarget (CLI) returns target when saved', () => {
    const ws = makeRegisteredWorkspace();
    const config = loadWorkspaceConfig(ws);
    config.targets['qt-a-debug-x86'] = {
        id: 'qt-a-debug-x86',
        name: 'a debug x86',
        kind: 'qt',
        project: 'a.pro',
        mode: 'debug',
        arch: 'x86',
        runAt: 'local',
        toolchain: { qtPath: '/qt' },
    };
    config.activeTarget = 'qt-a-debug-x86';
    saveWorkspaceConfig(config);

    const t = getActiveTargetCli(ws);
    assert.equal(t?.kind, 'qt');
    assert.equal(t?.project, 'a.pro');
});

test('requireActiveTarget returns error when none', () => {
    const ws = makeRegisteredWorkspace();
    const result = requireActiveTarget(ws);
    assert.ok('error' in result);
    assert.ok(result.nextAction === 'forja use target');
});

test('requireActiveTarget returns target when exists', () => {
    const ws = makeRegisteredWorkspace();
    const config = loadWorkspaceConfig(ws);
    config.targets['sdk-b-release-x86'] = {
        id: 'sdk-b-release-x86',
        name: 'b release x86',
        kind: 'cpp',
        project: 'b.sln',
        mode: 'release',
        arch: 'x86',
        runAt: 'local',
        toolchain: {},
    };
    config.activeTarget = 'sdk-b-release-x86';
    saveWorkspaceConfig(config);

    const result = requireActiveTarget(ws);
    assert.ok('target' in result);
    assert.equal(result.target.kind, 'cpp');
});

// ── Candidates ──

test('collectTargetCandidates finds .pro files', () => {
    const ws = makeWorkspace();
    const proDir = path.join(ws, 'app');
    fs.mkdirSync(proDir, { recursive: true });
    fs.writeFileSync(path.join(proDir, 'app.pro'), 'TARGET = app\n');
    const candidates = collectTargetCandidates(ws);
    const qtCandidates = candidates.filter(c => c.kind === 'qt');
    assert.ok(qtCandidates.length >= 1);
    assert.ok(qtCandidates.some(c => c.project === 'app/app.pro'));
});

test('collectTargetCandidates marks current target from workspaceStore', () => {
    const ws = makeRegisteredWorkspace();
    const proDir = path.join(ws, 'app');
    fs.mkdirSync(proDir, { recursive: true });
    fs.writeFileSync(path.join(proDir, 'app.pro'), 'TARGET = app\n');

    const config = loadWorkspaceConfig(ws);
    config.targets['qt-app-debug-x64'] = {
        id: 'qt-app-debug-x64',
        name: 'app debug x64',
        kind: 'qt',
        project: 'app/app.pro',
        mode: 'debug',
        arch: 'x64',
        runAt: 'local',
        toolchain: {},
    };
    config.activeTarget = 'qt-app-debug-x64';
    saveWorkspaceConfig(config);

    const candidates = collectTargetCandidates(ws);
    const current = candidates.find(c => c.current);
    assert.ok(current);
    assert.equal(current.project, 'app/app.pro');
});

test('collectTargetCandidates finds .sln files on Windows', () => {
    if (os.platform() !== 'win32') { return; }
    const ws = makeWorkspace();
    const slnDir = path.join(ws, 'cpp');
    fs.mkdirSync(slnDir, { recursive: true });
    fs.writeFileSync(path.join(slnDir, 'test.sln'), '');
    const candidates = collectTargetCandidates(ws);
    const cppCandidates = candidates.filter(c => c.kind === 'cpp');
    assert.ok(cppCandidates.length >= 1);
});

// ── Locale ──

test('resolveLocale defaults based on system locale', () => {
    const oldLang = process.env.FORJA_LANG;
    const oldLcAll = process.env.LC_ALL;
    const oldLang2 = process.env.LANG;
    delete process.env.FORJA_LANG;
    delete process.env.LC_ALL;
    delete process.env.LANG;
    try {
        const result = resolveLocale();
        assert.ok(result === 'en' || result === 'zh', `resolveLocale should return 'en' or 'zh', got '${result}'`);
    } finally {
        if (oldLang !== undefined) { process.env.FORJA_LANG = oldLang; }
        if (oldLcAll !== undefined) { process.env.LC_ALL = oldLcAll; }
        if (oldLang2 !== undefined) { process.env.LANG = oldLang2; }
    }
});

test('resolveLocale respects flag', () => {
    assert.equal(resolveLocale('zh'), 'zh');
    assert.equal(resolveLocale('en'), 'en');
});

test('readinessText returns correct text', () => {
    assert.equal(readinessText('ready', 'en'), 'Ready');
    assert.equal(readinessText('ready', 'zh'), '就绪');
    assert.equal(readinessText('not-selected', 'en'), 'Not selected');
    assert.equal(readinessText('not-selected', 'zh'), '未选择');
});
