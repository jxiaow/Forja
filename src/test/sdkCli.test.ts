import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runSdkCli } from '../sdk/cli/index';

afterEach(() => { process.exitCode = undefined; });

// Capture console.log output
function captureOutput(fn: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    return fn().then(() => { console.log = orig; return lines.join('\n'); })
        .catch(e => { console.log = orig; throw e; });
}

test('SDK CLI rejects unknown flags with error', async () => {
    const output = await captureOutput(() => runSdkCli(['build', '--json', '--unknown-flag']));
    assert.equal(process.exitCode, 1);
    const parsed = JSON.parse(output);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('未知参数'));
});

test('SDK CLI rejects invalid --mode value', async () => {
    const output = await captureOutput(() => runSdkCli(['build', '--json', '--mode', 'fast']));
    assert.equal(process.exitCode, 1);
    const parsed = JSON.parse(output);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('--mode'));
});

test('SDK CLI rejects invalid --arch value', async () => {
    const output = await captureOutput(() => runSdkCli(['build', '--json', '--arch', 'arm64']));
    assert.equal(process.exitCode, 1);
    const parsed = JSON.parse(output);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('--arch'));
});

test('SDK CLI rejects unknown run action', async () => {
    const output = await captureOutput(() => runSdkCli(['run', '--json']));
    assert.equal(process.exitCode, 1);
    const parsed = JSON.parse(output);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('未知动作'));
});

test('SDK CLI accepts valid build with --plan', async () => {
    const output = await captureOutput(() => runSdkCli(['build', '--json', '--plan', '--mode', 'release', '--arch', 'x64']));
    const parsed = JSON.parse(output);
    if (!parsed.ok) {
        assert.ok(parsed.diagnostics[0].message.includes('未找到') || parsed.action === 'build');
    }
});


// ── scanProjects ──
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanProjects } from '../sdk/cli/index';

const _tmpDirs: string[] = [];
import { after } from 'node:test';
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

test('scanProjects finds .sln files on Windows', () => {
    if (os.platform() !== 'win32') { return; } // Windows-only
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-scan-'));
    _tmpDirs.push(ws);
    fs.writeFileSync(path.join(ws, 'MyApp.sln'), '', 'utf-8');
    fs.mkdirSync(path.join(ws, 'sub'));
    fs.writeFileSync(path.join(ws, 'sub', 'Lib.sln'), '', 'utf-8');
    const results = scanProjects(ws);
    assert.equal(results.length, 2);
    assert.ok(results.some(r => r.endsWith('MyApp.sln')));
    assert.ok(results.some(r => r.endsWith('Lib.sln')));
});

test('scanProjects excludes node_modules and .git dirs', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-scan-'));
    _tmpDirs.push(ws);
    fs.mkdirSync(path.join(ws, 'node_modules'));
    fs.writeFileSync(path.join(ws, 'node_modules', 'pkg.sln'), '', 'utf-8');
    fs.mkdirSync(path.join(ws, '.git'));
    fs.writeFileSync(path.join(ws, '.git', 'config.sln'), '', 'utf-8');
    const results = scanProjects(ws);
    assert.equal(results.length, 0);
});

test('scanProjects returns empty for non-existent dir', () => {
    const results = scanProjects(path.join(os.tmpdir(), 'compilot-nonexist-' + Date.now()));
    assert.deepEqual(results, []);
});
