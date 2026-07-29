import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('vscode qt run stops the previous executable before building', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'buildManager.ts'), 'utf8');
    const runStart = source.indexOf('export async function run()');
    const rccStart = source.indexOf('export function rcc()', runStart);
    const runSource = source.slice(runStart, rccStart);

    const killIndex = runSource.indexOf('terminateExecutable(');
    const buildIndex = runSource.indexOf('builder.buildCommands(cfg)');

    assert.notEqual(killIndex, -1, 'run must call terminateExecutable');
    assert.notEqual(buildIndex, -1);
    assert.ok(killIndex < buildIndex, 'run must stop the old executable before the build starts');
});

test('vscode qt pre-run kill uses path-based terminateExecutable', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'buildManager.ts'), 'utf8');

    // _killApp removed — now uses terminateExecutable from commandRunner (PID-based)
    assert.doesNotMatch(source, /function _killApp\(/);
    assert.match(source, /terminateExecutable\(mfInfo\.exePath\)/);
    // No name-based kill patterns
    assert.doesNotMatch(source, /taskkill \/F \/IM/);
    assert.doesNotMatch(source, /pkill -x/);
});

test('vscode qt stop is unified via runStop (not buildManager)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'buildManager.ts'), 'utf8');

    // stop() and stopCurrentTarget() removed — stop is now unified via runStop (PID-based)
    assert.doesNotMatch(source, /export function stop\(\)/);
    assert.doesNotMatch(source, /export function stopCurrentTarget\(\)/);
    // getRuntimeProcessName no longer imported (was only used by stop and name-based kill)
    assert.doesNotMatch(source, /getRuntimeProcessName/);
});

test('vscode Qt run writes the same PID state consumed by forja stop', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'buildManager.ts'), 'utf8');

    assert.match(source, /waitForNewExecutablePid\(mfInfo\.exePath, previousPids\)/);
    assert.match(source, /writeRunState\(runWorkspace/);
    assert.match(source, /clearRunState\(runWorkspace\)/);
    assert.match(source, /setState\('isRunning', true\);\s+const pid = await waitForNewExecutablePid/);
});

test('vscode debug updates runtime state and clears it when the session ends', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'build', 'debugger.ts'), 'utf8');

    assert.match(source, /setState\('isRunning', true\)/);
    assert.match(source, /writeRunState\(debugWorkspace/);
    assert.match(source, /clearRunState\(resolveProjectRoot\(\)\)/);
    assert.match(source, /DEBUG_RUN_ID_KEY/);
});
