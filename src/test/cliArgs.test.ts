import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../cli/args';

test('parseCliArgs defaults build to dryRun and current workspace marker', () => {
    const parsed = parseCliArgs(['build']);

    assert.equal(parsed.action, 'build');
    assert.equal(parsed.executionMode, 'dryRun');
    assert.equal(parsed.mode, null);
    assert.equal(parsed.arch, null);
    assert.equal(parsed.workspace, null);
    assert.equal(parsed.json, false);
});

test('parseCliArgs accepts execute json and typed options', () => {
    const parsed = parseCliArgs([
        'run',
        '--execute',
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

test('parseCliArgs rejects dry-run and execute together', () => {
    assert.throws(
        () => parseCliArgs(['build', '--dry-run', '--execute']),
        /不能同时使用 --dry-run 和 --execute/
    );
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
    assert.equal(parsed.executionMode, 'dryRun');
});

test('parseCliArgs defaults to status when only flags are provided', () => {
    const parsed = parseCliArgs(['--json']);

    assert.equal(parsed.action, 'status');
    assert.equal(parsed.json, true);
    assert.equal(parsed.executionMode, 'dryRun');
});
