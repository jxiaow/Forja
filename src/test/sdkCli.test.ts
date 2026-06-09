import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runSdkCli } from '../sdk/cli/index';
import { getSdkDefaultArch } from '../sdk/cli/requirements';

afterEach(() => { process.exitCode = undefined; });

// Capture console.log output
function captureOutput(fn: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    return fn().then(() => { console.log = orig; return lines.join('\n'); })
        .catch(e => { console.log = orig; throw e; });
}

describe('SDK CLI', { concurrency: false }, () => {

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

test('SDK CLI rejects unsupported --arch value on single-arch platforms', async () => {
    if (os.platform() === 'win32') { return; }

    const output = await captureOutput(() => runSdkCli(['status', '--json', '--arch', 'x86']));
    assert.equal(process.exitCode, 1);
    const parsed = JSON.parse(output);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('--arch'));
});

test('SDK CLI rejects extra positional arguments', async () => {
    const output = await captureOutput(() => runSdkCli(['status', '--json', 'extra']));
    assert.equal(process.exitCode, 1);
    const parsed = JSON.parse(output);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('extra'));
});

test('SDK CLI rejects unknown run action', async () => {
    const output = await captureOutput(() => runSdkCli(['run', '--json']));
    assert.equal(process.exitCode, 1);
    const parsed = JSON.parse(output);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('未知动作'));
});

test('SDK CLI accepts use config options', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-use-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        fs.writeFileSync(path.join(ws, 'Makefile'), 'all:\n\t@echo ok\n', 'utf-8');

        const output = await captureOutput(() => runSdkCli([
            'use',
            '--json',
            '--workspace',
            ws,
            '--project',
            'Makefile',
            '--mode',
            'release',
            '--arch',
            'x64'
        ]));
        const parsed = JSON.parse(output);

        assert.equal(parsed.ok, true);
        assert.equal(parsed.action, 'use');
        assert.equal(parsed.resolved.project, 'Makefile');
        assert.equal(parsed.resolved.mode, 'release');
        assert.equal(parsed.resolved.arch, 'x64');
        assert.deepEqual(parsed.nextActions, ['forja sdk status --json']);
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI rejects config options on non-use actions', async () => {
    const restrictedFlags = ['--project', '--mode', '--arch', '--vs-dev-cmd'];
    for (const action of ['init', 'status', 'env', 'projects', 'build', 'rebuild', 'clean']) {
        for (const flag of restrictedFlags) {
            const value = flag === '--mode' ? 'release'
                : flag === '--arch' ? 'x64'
                    : flag === '--vs-dev-cmd' ? '/tmp/VsDevCmd.bat'
                        : 'Makefile';
            const output = await captureOutput(() => runSdkCli([action, '--json', flag, value]));
            const parsed = JSON.parse(output);

            assert.equal(process.exitCode, 1);
            assert.equal(parsed.ok, false);
            assert.ok(parsed.diagnostics[0].message.includes(`${flag} 不能用于 ${action}`));
            process.exitCode = undefined;
        }
    }
});

test('SDK CLI build accepts --plan and routes missing config to status', async () => {
    const output = await captureOutput(() => runSdkCli(['build', '--json', '--plan']));
    const parsed = JSON.parse(output);
    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.action, 'build');
    assert.deepEqual(parsed.nextActions, ['forja sdk status --json']);
});

test('SDK CLI rejects removed --dry-run alias', async () => {
    const output = await captureOutput(() => runSdkCli(['build', '--json', '--dry-run']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('未知参数: --dry-run'));
});

test('SDK CLI build plan inherits mode and arch saved by use', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-config-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        fs.writeFileSync(path.join(ws, 'Makefile'), 'all:\n\t@echo ok\n', 'utf-8');

        const initOutput = await captureOutput(() => runSdkCli([
            'init',
            '--json',
            '--workspace',
            ws
        ]));
        const initParsed = JSON.parse(initOutput);
        assert.equal(initParsed.ok, true);

        const useOutput = await captureOutput(() => runSdkCli([
            'use',
            '--json',
            '--workspace',
            ws,
            '--project',
            'Makefile',
            '--mode',
            'release',
            '--arch',
            'x64'
        ]));
        assert.equal(JSON.parse(useOutput).ok, true);

        const output = await captureOutput(() => runSdkCli(['build', '--json', '--plan', '--workspace', ws]));
        const parsed = JSON.parse(output);

        assert.equal(parsed.ok, true);
        assert.equal(parsed.resolved.mode, 'release');
        assert.equal(parsed.resolved.arch, 'x64');
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI use updates only explicit fields and build plan inherits saved settings', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-use-inherit-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        fs.writeFileSync(path.join(ws, 'Makefile'), 'all:\n\t@echo ok\n', 'utf-8');
        fs.mkdirSync(path.join(ws, 'app'));
        fs.writeFileSync(path.join(ws, 'app', 'Makefile'), 'all:\n\t@echo app\n', 'utf-8');

        const initOutput = await captureOutput(() => runSdkCli([
            'init',
            '--json',
            '--workspace',
            ws
        ]));
        assert.equal(JSON.parse(initOutput).ok, true);

        const useOutput = await captureOutput(() => runSdkCli([
            'use',
            '--json',
            '--workspace',
            ws,
            '--project',
            path.join('app', 'Makefile'),
            '--mode',
            'release'
        ]));
        const useParsed = JSON.parse(useOutput);
        assert.equal(useParsed.ok, true);
        assert.equal(useParsed.resolved.project, path.join('app', 'Makefile'));
        assert.equal(useParsed.resolved.mode, 'release');
        assert.equal(useParsed.resolved.arch, getSdkDefaultArch());

        const planOutput = await captureOutput(() => runSdkCli(['build', '--json', '--plan', '--workspace', ws]));
        const planParsed = JSON.parse(planOutput);
        assert.equal(planParsed.ok, true);
        assert.equal(planParsed.project, path.join('app', 'Makefile'));
        assert.equal(planParsed.resolved.mode, 'release');
        assert.equal(planParsed.resolved.arch, getSdkDefaultArch());
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI use rejects a missing project', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-use-missing-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        const output = await captureOutput(() => runSdkCli([
            'use',
            '--json',
            '--workspace',
            ws,
            '--project',
            'MissingMakefile'
        ]));
        const parsed = JSON.parse(output);

        assert.equal(process.exitCode, 1);
        assert.equal(parsed.ok, false);
        assert.ok(parsed.diagnostics[0].message.includes('项目文件不存在'));
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI init uses the platform default arch when no SDK config exists', async () => {
    if (os.platform() === 'win32') { return; }

    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-default-arch-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        const output = await captureOutput(() => runSdkCli(['init', '--json', '--workspace', ws]));
        const parsed = JSON.parse(output);

        assert.equal(parsed.ok, true);
        assert.equal(parsed.resolved.arch, 'x64');
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI use resolves relative --project from workspace', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-project-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        fs.writeFileSync(path.join(ws, 'Makefile'), 'all:\n\t@echo ok\n', 'utf-8');

        const useOutput = await captureOutput(() => runSdkCli([
            'use',
            '--json',
            '--workspace',
            ws,
            '--project',
            'Makefile'
        ]));
        const useParsed = JSON.parse(useOutput);
        assert.equal(useParsed.ok, true);
        assert.equal(useParsed.resolved.project, 'Makefile');

        const planOutput = await captureOutput(() => runSdkCli([
            'build',
            '--json',
            '--plan',
            '--workspace',
            ws
        ]));
        const planParsed = JSON.parse(planOutput);
        assert.equal(planParsed.ok, true);
        assert.equal(planParsed.project, 'Makefile');
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI init rejects explicit project options', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-missing-init-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        const output = await captureOutput(() => runSdkCli([
            'init',
            '--json',
            '--workspace',
            ws,
            '--project',
            'MissingMakefile'
        ]));
        const parsed = JSON.parse(output);

        assert.equal(process.exitCode, 1);
        assert.equal(parsed.ok, false);
        assert.ok(parsed.diagnostics[0].message.includes('--project 不能用于 init'));
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI build plan rejects a stale pinned project instead of building another candidate', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-stale-project-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        const pinnedProject = path.join(ws, 'Makefile');
        fs.writeFileSync(pinnedProject, 'all:\n\t@echo old\n', 'utf-8');

        const initOutput = await captureOutput(() => runSdkCli([
            'init',
            '--json',
            '--workspace',
            ws
        ]));
        assert.equal(JSON.parse(initOutput).ok, true);

        const useOutput = await captureOutput(() => runSdkCli([
            'use',
            '--json',
            '--workspace',
            ws,
            '--project',
            'Makefile'
        ]));
        assert.equal(JSON.parse(useOutput).ok, true);

        fs.unlinkSync(pinnedProject);
        createSdkProjectFile(ws, 'other');

        const output = await captureOutput(() => runSdkCli(['build', '--json', '--plan', '--workspace', ws]));
        const parsed = JSON.parse(output);

        assert.equal(process.exitCode, 1);
        assert.equal(parsed.ok, false);
        assert.ok(parsed.diagnostics[0].message.includes('项目文件不存在'));
        assert.notEqual(parsed.project, path.join('other', os.platform() === 'win32' ? 'App.sln' : 'Makefile'));
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI build plan requires saved SDK config even when one candidate exists', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-no-config-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        fs.writeFileSync(path.join(ws, 'Makefile'), 'all:\n\t@echo ok\n', 'utf-8');

        const output = await captureOutput(() => runSdkCli(['build', '--json', '--plan', '--workspace', ws]));
        const parsed = JSON.parse(output);

        assert.equal(process.exitCode, 1);
        assert.equal(parsed.ok, false);
        assert.deepEqual(parsed.nextActions, ['forja sdk status --json']);
        assert.ok(parsed.diagnostics[0].message.includes('尚未初始化'));
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

test('SDK CLI status requires a saved project after init even when one candidate exists', async () => {
    const oldHome = process.env.HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-status-one-unsaved-'));
    _tmpDirs.push(tempHome);
    _tmpDirs.push(ws);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;

    try {
        createSdkProjectFile(ws, '.');

        const initOutput = await captureOutput(() => runSdkCli(['init', '--json', '--workspace', ws]));
        assert.equal(JSON.parse(initOutput).ok, true);

        const output = await captureOutput(() => runSdkCli(['status', '--json', '--workspace', ws]));
        const parsed = JSON.parse(output);

        assert.equal(parsed.ok, true);
        const projectName = os.platform() === 'win32' ? 'App.sln' : 'Makefile';
        assert.equal(parsed.ready, true);
        assert.equal(parsed.project, projectName);
        assert.equal(parsed.nextAction, 'build');

        const planOutput = await captureOutput(() => runSdkCli(['build', '--json', '--plan', '--workspace', ws]));
        const planParsed = JSON.parse(planOutput);
        assert.equal(planParsed.ok, true);
        assert.equal(planParsed.project, projectName);
    } finally {
        if (oldHome === undefined) { delete process.env.HOME; }
        else { process.env.HOME = oldHome; }
        if (oldUserProfile === undefined) { delete process.env.USERPROFILE; }
        else { process.env.USERPROFILE = oldUserProfile; }
    }
});

function createSdkProjectFile(workspace: string, relativeDir: string): string {
    const dir = path.join(workspace, relativeDir);
    fs.mkdirSync(dir, { recursive: true });
    const filename = os.platform() === 'win32' ? 'App.sln' : 'Makefile';
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, os.platform() === 'win32' ? '' : 'all:\n\t@echo ok\n', 'utf-8');
    return filePath;
}

test('SDK CLI status reports missing project without failing', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-status-empty-'));
    _tmpDirs.push(ws);

    const output = await captureOutput(() => runSdkCli(['status', '--json', '--workspace', ws]));
    const parsed = JSON.parse(output);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ready, false);
    assert.equal(parsed.project, null);
    assert.deepEqual(parsed.candidates, []);
    assert.ok(parsed.missing.includes('project'));
});

test('SDK CLI status reports candidate projects when workspace has multiple projects', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-sdk-status-multi-'));
    _tmpDirs.push(ws);
    createSdkProjectFile(ws, 'app');
    createSdkProjectFile(ws, 'lib');

    const output = await captureOutput(() => runSdkCli(['status', '--json', '--workspace', ws]));
    const parsed = JSON.parse(output);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ready, false);
    assert.equal(parsed.project, null);
    assert.equal(parsed.candidates.length, 2);
    assert.ok(parsed.missing.includes('project'));
    assert.ok(parsed.diagnostics.some((d: { message: string }) => d.message.includes('发现 2 个项目文件')));
});

});


// ── scanProjects ──
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanProjects } from '../sdk/cli/index';

const _tmpDirs: string[] = [];
import { after } from 'node:test';
async function rmTmpDir(dir: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            return;
        } catch (e) {
            if (attempt === 4) { throw e; }
            await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
        }
    }
}
after(async () => { for (const d of _tmpDirs) { await rmTmpDir(d); } });

test('scanProjects finds .sln files on Windows', () => {
    if (os.platform() !== 'win32') { return; } // Windows-only
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-scan-'));
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
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-scan-'));
    _tmpDirs.push(ws);
    fs.mkdirSync(path.join(ws, 'node_modules'));
    fs.writeFileSync(path.join(ws, 'node_modules', 'pkg.sln'), '', 'utf-8');
    fs.mkdirSync(path.join(ws, '.git'));
    fs.writeFileSync(path.join(ws, '.git', 'config.sln'), '', 'utf-8');
    const results = scanProjects(ws);
    assert.equal(results.length, 0);
});

test('scanProjects returns empty for non-existent dir', () => {
    const results = scanProjects(path.join(os.tmpdir(), 'forja-nonexist-' + Date.now()));
    assert.deepEqual(results, []);
});
