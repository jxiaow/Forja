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

test('parseCliArgs rejects build config options on build run and clean', () => {
    const restrictedFlags = ['--project', '--mode', '--arch', '--qt-path', '--vs-dev-shell', '--target'];
    for (const action of ['build', 'run', 'clean']) {
        for (const flag of restrictedFlags) {
            assert.throws(
                () => parseCliArgs([action, flag, 'value']),
                new RegExp(`${flag} 只允许用于 init`)
            );
        }
    }
});

test('parseCliArgs throws on unknown action', () => {
    assert.throws(() => parseCliArgs(['deploy']), /未知命令/);
});
