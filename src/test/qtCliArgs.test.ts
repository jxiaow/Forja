import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../qt/cli/args';

test('parseCliArgs --brief sets brief flag', () => {
    const opts = parseCliArgs(['build', '--brief', '--json']);
    assert.equal(opts.brief, true);
    assert.equal(opts.json, true);
    assert.equal(opts.action, 'build');
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

test('parseCliArgs --mode and --arch set correctly', () => {
    const opts = parseCliArgs(['build', '--mode', 'release', '--arch', 'x64']);
    assert.equal(opts.mode, 'release');
    assert.equal(opts.arch, 'x64');
});

test('parseCliArgs throws on unknown action', () => {
    assert.throws(() => parseCliArgs(['deploy']), /未知命令/);
});
