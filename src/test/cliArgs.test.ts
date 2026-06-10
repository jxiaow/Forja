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

test('parseCliArgs rejects config options on init', () => {
    for (const flag of ['--project', '--mode', '--arch', '--qt-path', '--vs-dev-shell', '--target', '--save-local']) {
        assert.throws(
            () => parseCliArgs(['init', flag, 'value']),
            flag === '--save-local' ? /未知参数: --save-local/ : new RegExp(`${flag} 不能用于 init`)
        );
    }
});

test('parseCliArgs accepts use config options', () => {
    const parsed = parseCliArgs([
        'use',
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

    assert.equal(parsed.action, 'use');
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

test('parseCliArgs rejects config options outside init and use', () => {
    for (const action of ['build', 'run', 'clean', 'qmake', 'status', 'env', 'projects', 'ps', 'stop', 'rcc']) {
        assert.throws(
            () => parseCliArgs([action, '--mode', 'release']),
            new RegExp(`--mode 不能用于 ${action}`)
        );
        assert.throws(
            () => parseCliArgs([action, '--project', 'demo.pro']),
            new RegExp(`--project 不能用于 ${action}`)
        );
    }
});

test('parseCliArgs rejects removed logs action', () => {
    assert.throws(() => parseCliArgs(['logs']), /未知命令/);
});

test('parseCliArgs --plan switches to dryRun mode', () => {
    const parsed = parseCliArgs(['build', '--plan', '--json']);

    assert.equal(parsed.action, 'build');
    assert.equal(parsed.executionMode, 'dryRun');
    assert.equal(parsed.json, true);
});

test('parseCliArgs rejects removed --dry-run alias', () => {
    assert.throws(
        () => parseCliArgs(['build', '--dry-run']),
        /未知参数: --dry-run/
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
