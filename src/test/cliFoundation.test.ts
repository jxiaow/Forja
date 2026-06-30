import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    loadActiveTarget,
    saveActiveTarget,
    ActiveTargetSettings,
} from '../core/settingsIO';
import { getActiveTarget, setActiveTarget, requireActiveTarget } from '../cli/commands/activeTarget';
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

// ── ActiveTarget persistence ──

test('loadActiveTarget returns null when no config exists', () => {
    const ws = makeWorkspace();
    assert.equal(loadActiveTarget(ws), null);
});

test('saveActiveTarget + loadActiveTarget round-trip', () => {
    const ws = makeWorkspace();
    const target: ActiveTargetSettings = {
        kind: 'qt',
        project: 'apps/client/client.pro',
        mode: 'debug',
        arch: 'x64',
        runAt: 'local',
    };
    saveActiveTarget(ws, target);
    const loaded = loadActiveTarget(ws);
    assert.deepEqual(loaded, target);
});

test('saveActiveTarget sdk kind round-trip', () => {
    const ws = makeWorkspace();
    const target: ActiveTargetSettings = {
        kind: 'sdk',
        project: 'sdk/NemoSDK.sln',
        mode: 'release',
        arch: 'x86',
        runAt: 'remote',
    };
    saveActiveTarget(ws, target);
    const loaded = loadActiveTarget(ws);
    assert.deepEqual(loaded, target);
});

test('loadActiveTarget sanitizes invalid kind', () => {
    const ws = makeWorkspace();
    const target: ActiveTargetSettings = {
        kind: 'qt',
        project: 'test.pro',
        mode: 'debug',
        arch: 'x64',
        runAt: 'local',
    };
    saveActiveTarget(ws, target);
    // Find the exact config file for this workspace by recomputing the hash
    const { projectConfigPath: getConfigPath } = require('../core/settingsIO');
    const filePath = getConfigPath(ws, 'activeTarget');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    raw.kind = 'invalid';
    fs.writeFileSync(filePath, JSON.stringify(raw));
    assert.equal(loadActiveTarget(ws), null);
});

// ── activeTarget wrapper ──

test('getActiveTarget returns null when none saved', () => {
    const ws = makeWorkspace();
    assert.equal(getActiveTarget(ws), null);
});

test('setActiveTarget + getActiveTarget round-trip', () => {
    const ws = makeWorkspace();
    setActiveTarget(ws, { kind: 'qt', project: 'a.pro', mode: 'debug', arch: 'x64', runAt: 'local' });
    const t = getActiveTarget(ws);
    assert.equal(t?.kind, 'qt');
    assert.equal(t?.project, 'a.pro');
});

test('requireActiveTarget returns error when none', () => {
    const ws = makeWorkspace();
    const result = requireActiveTarget(ws);
    assert.ok('error' in result);
    assert.ok(result.nextAction === 'forja list targets');
});

test('requireActiveTarget returns target when exists', () => {
    const ws = makeWorkspace();
    setActiveTarget(ws, { kind: 'sdk', project: 'b.sln', mode: 'release', arch: 'x86', runAt: 'local' });
    const result = requireActiveTarget(ws);
    assert.ok('target' in result);
    assert.equal(result.target.kind, 'sdk');
});

// ── Candidates ──

test('collectTargetCandidates finds .pro files', () => {
    const ws = makeWorkspace();
    // Create a .pro file
    const proDir = path.join(ws, 'app');
    fs.mkdirSync(proDir, { recursive: true });
    fs.writeFileSync(path.join(proDir, 'app.pro'), 'TARGET = app\n');
    const candidates = collectTargetCandidates(ws);
    const qtCandidates = candidates.filter(c => c.kind === 'qt');
    assert.ok(qtCandidates.length >= 1);
    assert.ok(qtCandidates.some(c => c.project === 'app/app.pro'));
});

test('collectTargetCandidates marks current target', () => {
    const ws = makeWorkspace();
    const proDir = path.join(ws, 'app');
    fs.mkdirSync(proDir, { recursive: true });
    fs.writeFileSync(path.join(proDir, 'app.pro'), 'TARGET = app\n');
    setActiveTarget(ws, { kind: 'qt', project: 'app/app.pro', mode: 'debug', arch: 'x64', runAt: 'local' });
    const candidates = collectTargetCandidates(ws);
    const current = candidates.find(c => c.current);
    assert.ok(current);
    assert.equal(current.project, 'app/app.pro');
});

test('collectTargetCandidates finds .sln files on Windows', () => {
    if (os.platform() !== 'win32') { return; }
    const ws = makeWorkspace();
    const slnDir = path.join(ws, 'sdk');
    fs.mkdirSync(slnDir, { recursive: true });
    fs.writeFileSync(path.join(slnDir, 'test.sln'), '');
    const candidates = collectTargetCandidates(ws);
    const sdkCandidates = candidates.filter(c => c.kind === 'sdk');
    assert.ok(sdkCandidates.length >= 1);
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
