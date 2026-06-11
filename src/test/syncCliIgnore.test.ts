import test from 'node:test';
import assert from 'node:assert/strict';
import { isIgnored, parseSyncCliArgs } from '../sync/cli';

test('isIgnored returns false for empty ignore list', () => {
    assert.equal(isIgnored('src/main.cpp', []), false);
});

test('isIgnored matches exact directory name', () => {
    assert.equal(isIgnored('build/output.o', ['build']), true);
});

test('isIgnored matches nested path segment', () => {
    assert.equal(isIgnored('src/build/main.o', ['build']), true);
});

test('isIgnored does not match partial segment', () => {
    assert.equal(isIgnored('src/rebuild/main.cpp', ['build']), false);
});

test('isIgnored supports glob wildcard', () => {
    assert.equal(isIgnored('src/main.o', ['*.o']), true);
});

test('isIgnored glob does not match across segments', () => {
    assert.equal(isIgnored('src/lib/test.cpp', ['*.o']), false);
});

test('isIgnored handles Windows backslash paths', () => {
    assert.equal(isIgnored('src\\build\\main.o', ['build']), true);
});

test('isIgnored handles multiple patterns', () => {
    assert.equal(isIgnored('node_modules/pkg/index.js', ['build', 'node_modules', '.git']), true);
});


test('parseSyncCliArgs accepts generic sync flags', () => {
    const parsed = parseSyncCliArgs(['--workspace', '/tmp/app', '--server', 'dev', '--repo', 'frontend', '--file', 'src/main.cpp', '--plan', '--json']);

    assert.equal(parsed.action, 'sync');
    assert.equal(parsed.workspace, '/tmp/app');
    assert.equal(parsed.server, 'dev');
    assert.equal(parsed.repo, 'frontend');
    assert.deepEqual(parsed.files, ['src/main.cpp']);
    assert.equal(parsed.executionMode, 'dryRun');
    assert.equal(parsed.json, true);
});

test('parseSyncCliArgs rejects removed --dry-run alias', () => {
    assert.throws(
        () => parseSyncCliArgs(['--dry-run']),
        /未知参数: --dry-run/
    );
});

test('parseSyncCliArgs accepts repeated file filters', () => {
    const parsed = parseSyncCliArgs(['--file', 'src/main.cpp', '--file', 'include/app.h']);

    assert.deepEqual(parsed.files, ['src/main.cpp', 'include/app.h']);
});

test('parseSyncCliArgs accepts sync status action', () => {
    const parsed = parseSyncCliArgs(['status', '--workspace', '/tmp/app', '--server', 'dev', '--json']);

    assert.equal(parsed.action, 'status');
    assert.equal(parsed.workspace, '/tmp/app');
    assert.equal(parsed.server, 'dev');
    assert.equal(parsed.json, true);
});

test('parseSyncCliArgs accepts sync server management actions', () => {
    const list = parseSyncCliArgs(['servers', '--json']);
    assert.equal(list.action, 'servers');
    assert.equal(list.json, true);

    const show = parseSyncCliArgs(['server', '--server', 'server-1', '--json']);
    assert.equal(show.action, 'server');
    assert.equal(show.server, 'server-1');
    assert.equal(show.json, true);

    const add = parseSyncCliArgs([
        'add-server',
        '--name', 'dev',
        '--host', '127.0.0.1',
        '--port', '2222',
        '--username', 'alice',
        '--auth-mode', 'key',
        '--private-key-path', '/tmp/key',
        '--strict-host-key-checking',
        '--json'
    ]);
    assert.equal(add.action, 'add-server');
    assert.equal(add.serverFields.name, 'dev');
    assert.equal(add.serverFields.host, '127.0.0.1');
    assert.equal(add.serverFields.port, 2222);
    assert.equal(add.serverFields.username, 'alice');
    assert.equal(add.serverFields.authMode, 'key');
    assert.equal(add.serverFields.privateKeyPath, '/tmp/key');
    assert.equal(add.serverFields.strictHostKeyChecking, true);

    const update = parseSyncCliArgs(['update-server', '--server', 'server-1', '--host', '10.0.0.2']);
    assert.equal(update.action, 'update-server');
    assert.equal(update.server, 'server-1');
    assert.equal(update.serverFields.host, '10.0.0.2');

    const remove = parseSyncCliArgs(['remove-server', '--server', 'server-1']);
    assert.equal(remove.action, 'remove-server');
    assert.equal(remove.server, 'server-1');
});

test('parseSyncCliArgs accepts sync use action', () => {
    const parsed = parseSyncCliArgs([
        'use',
        '--workspace', '/tmp/app',
        '--server', 'server-1',
        '--remote-path', '/remote/app',
        '--enable',
        '--json'
    ]);

    assert.equal(parsed.action, 'use');
    assert.equal(parsed.workspace, '/tmp/app');
    assert.equal(parsed.server, 'server-1');
    assert.equal(parsed.remotePath, '/remote/app');
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.json, true);
});

test('parseSyncCliArgs accepts sync test-connection action', () => {
    const parsed = parseSyncCliArgs(['test-connection', '--server', 'server-1', '--json']);

    assert.equal(parsed.action, 'test-connection');
    assert.equal(parsed.server, 'server-1');
    assert.equal(parsed.json, true);
});

test('parseSyncCliArgs accepts sync reset action', () => {
    const parsed = parseSyncCliArgs(['reset', '--workspace', '/tmp/app', '--json']);

    assert.equal(parsed.action, 'reset');
    assert.equal(parsed.workspace, '/tmp/app');
    assert.equal(parsed.json, true);
});

test('parseSyncCliArgs rejects positional args', () => {
    assert.throws(() => parseSyncCliArgs(['deploy']), /不接受子命令或位置参数/);
});
