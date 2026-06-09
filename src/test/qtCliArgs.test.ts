import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../qt/cli/args';

test('parseCliArgs rejects --brief as unknown', () => {
    assert.throws(() => parseCliArgs(['build', '--brief', '--json']), /未知参数/);
});

test('parseCliArgs --detach sets detach flag', () => {
    const opts = parseCliArgs(['run', '--detach']);
    assert.equal(opts.detach, true);
    assert.equal(opts.action, 'run');
});

test('parseCliArgs accepts ps action', () => {
    const opts = parseCliArgs(['ps', '--workspace', '/tmp/app', '--json']);

    assert.equal(opts.action, 'ps');
    assert.equal(opts.workspace, '/tmp/app');
    assert.equal(opts.json, true);
});

test('parseCliArgs defaults to status when no action given', () => {
    const opts = parseCliArgs(['--json']);
    assert.equal(opts.action, 'status');
    assert.equal(opts.json, true);
});

test('parseCliArgs --mode and --arch are use options', () => {
    const opts = parseCliArgs(['use', '--mode', 'release', '--arch', 'x64']);
    assert.equal(opts.action, 'use');
    assert.equal(opts.mode, 'release');
    assert.equal(opts.arch, 'x64');
});

test('parseCliArgs accepts use config options', () => {
    const opts = parseCliArgs(['use', '--project', 'demo.pro', '--mode', 'release', '--arch', 'x64', '--target', 'demo', '--qmake-args', 'DEFINES+=FEATURE_X CONFIG+=qml_debug']);

    assert.equal(opts.action, 'use');
    assert.equal(opts.project, 'demo.pro');
    assert.equal(opts.mode, 'release');
    assert.equal(opts.arch, 'x64');
    assert.equal(opts.target, 'demo');
    assert.equal(opts.qmakeArgs, 'DEFINES+=FEATURE_X CONFIG+=qml_debug');
});

test('parseCliArgs rejects build config options on execution and read-only actions', () => {
    const restrictedFlags = ['--project', '--mode', '--arch', '--qt-path', '--vs-dev-shell', '--target', '--qmake-args'];
    for (const action of ['init', 'build', 'run', 'clean', 'qmake', 'status', 'env', 'projects', 'ps', 'stop', 'rcc']) {
        for (const flag of restrictedFlags) {
            assert.throws(
                () => parseCliArgs([action, flag, 'value']),
                new RegExp(`${flag} 不能用于 ${action}`)
            );
        }
    }
});

test('parseCliArgs rejects removed init-only save-local flag', () => {
    assert.throws(
        () => parseCliArgs(['init', '--save-local']),
        /未知参数: --save-local/
    );
});

test('parseCliArgs rejects sync action and sync-only flags in qt cli', () => {
    assert.throws(() => parseCliArgs(['sync']), /未知命令/);
    assert.throws(() => parseCliArgs(['build', '--server', 'dev']), /未知参数: --server/);
    assert.throws(() => parseCliArgs(['build', '--repo', 'app']), /未知参数: --repo/);
});

test('parseCliArgs only accepts detach on run', () => {
    assert.equal(parseCliArgs(['run', '--detach']).detach, true);
    assert.throws(() => parseCliArgs(['build', '--detach']), /--detach 不能用于 build/);
});

test('parseCliArgs throws on unknown action', () => {
    assert.throws(() => parseCliArgs(['deploy']), /未知命令/);
});

test('parseCliArgs rejects removed logs action', () => {
    assert.throws(() => parseCliArgs(['logs']), /未知命令/);
});
