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

test('parseCliArgs defaults to status when no action given', () => {
    const opts = parseCliArgs(['--json']);
    assert.equal(opts.action, 'status');
    assert.equal(opts.json, true);
});

test('parseCliArgs --mode and --arch are init options', () => {
    const opts = parseCliArgs(['init', '--mode', 'release', '--arch', 'x64']);
    assert.equal(opts.action, 'init');
    assert.equal(opts.mode, 'release');
    assert.equal(opts.arch, 'x64');
});

test('parseCliArgs accepts use config options', () => {
    const opts = parseCliArgs(['use', '--project', 'demo.pro', '--mode', 'release', '--arch', 'x64', '--target', 'demo']);

    assert.equal(opts.action, 'use');
    assert.equal(opts.project, 'demo.pro');
    assert.equal(opts.mode, 'release');
    assert.equal(opts.arch, 'x64');
    assert.equal(opts.target, 'demo');
});

test('parseCliArgs rejects build config options on execution and read-only actions', () => {
    const restrictedFlags = ['--project', '--mode', '--arch', '--qt-path', '--vs-dev-shell', '--target'];
    for (const action of ['build', 'run', 'clean', 'qmake', 'status', 'env', 'projects', 'sync', 'logs', 'stop', 'rcc']) {
        for (const flag of restrictedFlags) {
            assert.throws(
                () => parseCliArgs([action, flag, 'value']),
                new RegExp(`${flag} 不能用于 ${action}`)
            );
        }
    }
});

test('parseCliArgs only accepts sync flags on sync', () => {
    const opts = parseCliArgs(['sync', '--server', 'dev', '--repo', 'app', '--dry-run']);

    assert.equal(opts.action, 'sync');
    assert.equal(opts.server, 'dev');
    assert.equal(opts.repo, 'app');
    assert.equal(opts.executionMode, 'dryRun');
    assert.throws(() => parseCliArgs(['build', '--server', 'dev']), /--server 不能用于 build/);
});

test('parseCliArgs only accepts detach on run', () => {
    assert.equal(parseCliArgs(['run', '--detach']).detach, true);
    assert.throws(() => parseCliArgs(['build', '--detach']), /--detach 不能用于 build/);
});

test('parseCliArgs throws on unknown action', () => {
    assert.throws(() => parseCliArgs(['deploy']), /未知命令/);
});
