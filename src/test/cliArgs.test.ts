import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../qt/cli/args';

test('parseCliArgs defaults build to execute mode', () => {
    const parsed = parseCliArgs(['build']);

    assert.equal(parsed.action, 'build');
    assert.equal(parsed.executionMode, 'execute');
    assert.equal(parsed.mode, null);
    assert.equal(parsed.arch, null);
    assert.equal(parsed.workspace, null);
    assert.equal(parsed.json, false);
});

test('parseCliArgs accepts json and typed options', () => {
    const parsed = parseCliArgs([
        'run',
        '--json',
        '--workspace',
        'D:/demo',
        '--project',
        'D:/demo/demo.pro',
        '--mode',
        'release',
        '--arch',
        'x64',
        '--qt-path',
        'D:/Qt',
        '--vs-dev-shell',
        'C:/VS/Launch-VsDevShell.ps1',
        '--target',
        'demo'
    ]);

    assert.equal(parsed.action, 'run');
    assert.equal(parsed.executionMode, 'execute');
    assert.equal(parsed.json, true);
    assert.equal(parsed.workspace, 'D:/demo');
    assert.equal(parsed.project, 'D:/demo/demo.pro');
    assert.equal(parsed.mode, 'release');
    assert.equal(parsed.arch, 'x64');
    assert.equal(parsed.qtPath, 'D:/Qt');
    assert.equal(parsed.vsDevShell, 'C:/VS/Launch-VsDevShell.ps1');
    assert.equal(parsed.target, 'demo');
});

test('parseCliArgs --plan switches to dryRun mode', () => {
    const parsed = parseCliArgs(['build', '--plan', '--json']);

    assert.equal(parsed.action, 'build');
    assert.equal(parsed.executionMode, 'dryRun');
    assert.equal(parsed.json, true);
});

test('parseCliArgs --dry-run is accepted as alias for --plan', () => {
    const parsed = parseCliArgs(['build', '--dry-run']);

    assert.equal(parsed.executionMode, 'dryRun');
});

test('parseCliArgs rejects unknown action', () => {
    assert.throws(
        () => parseCliArgs(['deploy']),
        /未知命令/
    );
});

test('parseCliArgs rejects missing option values', () => {
    assert.throws(
        () => parseCliArgs(['build', '--workspace', '--json']),
        /--workspace 需要一个值/
    );
});

test('parseCliArgs accepts status action', () => {
    const parsed = parseCliArgs(['status', '--json']);

    assert.equal(parsed.action, 'status');
    assert.equal(parsed.json, true);
    assert.equal(parsed.executionMode, 'execute');
});

test('parseCliArgs defaults to status when only flags are provided', () => {
    const parsed = parseCliArgs(['--json']);

    assert.equal(parsed.action, 'status');
    assert.equal(parsed.json, true);
    assert.equal(parsed.executionMode, 'execute');
});

test('parseCliArgs accepts clean action', () => {
    const parsed = parseCliArgs(['clean', '--json']);

    assert.equal(parsed.action, 'clean');
    assert.equal(parsed.executionMode, 'execute');
    assert.equal(parsed.json, true);
});
