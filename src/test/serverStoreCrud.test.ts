import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    readServers, addServer, removeServer,
    updateServer, getServerById, rememberServerRemotePath,
} from '../core/serverStore';
import { setOutputWriter, setSilent } from '../core/loggerBase';

// 用临时目录，不碰用户真实的 ~/.forja/servers.json
const tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'forja-test-'));
process.env.FORJA_CONFIG_DIR = tmpDir;
const SERVERS_PATH = path.join(tmpDir, 'servers.json');

before(() => {
    fs.writeFileSync(SERVERS_PATH, '[]', 'utf-8');
});

after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.FORJA_CONFIG_DIR;
});

test('readServers returns empty array when file has []', () => {
    const servers = readServers();
    assert.deepEqual(servers, []);
});

test('addServer creates server with generated id', () => {
    const s = addServer({ name: 'test-srv', host: '10.0.0.1', port: 22, username: 'dev', authMode: 'key', privateKeyPath: '/key', password: '' });
    assert.ok(s.id, 'should have generated id');
    assert.equal(s.name, 'test-srv');
    assert.equal(s.host, '10.0.0.1');
});

test('getServerById finds added server', () => {
    const servers = readServers();
    const id = servers[0].id;
    const found = getServerById(id);
    assert.ok(found);
    assert.equal(found.name, 'test-srv');
});

test('updateServer modifies fields', () => {
    const servers = readServers();
    const id = servers[0].id;
    const ok = updateServer(id, { host: '10.0.0.2', port: 2222 });
    assert.equal(ok, true);
    const updated = getServerById(id)!;
    assert.equal(updated.host, '10.0.0.2');
    assert.equal(updated.port, 2222);
    assert.equal(updated.name, 'test-srv'); // unchanged
});

test('remote path history is persisted, deduplicated, and ordered by recent use', () => {
    const id = readServers()[0].id;
    assert.equal(rememberServerRemotePath(id, ' /srv/projects/app-a '), true);
    assert.equal(rememberServerRemotePath(id, '/srv/projects/app-b'), true);
    assert.equal(rememberServerRemotePath(id, '/srv/projects/app-a'), true);

    assert.deepEqual(getServerById(id)?.remotePathHistory, [
        '/srv/projects/app-a',
        '/srv/projects/app-b',
    ]);
});

test('updateServer returns false for non-existent id', () => {
    assert.equal(updateServer('non-existent-id', { host: 'x' }), false);
});

test('removeServer deletes by id', () => {
    const servers = readServers();
    const id = servers[0].id;
    removeServer(id);
    assert.equal(getServerById(id), null);
    assert.equal(readServers().length, 0);
});

test('strictHostKeyChecking=false survives persistence round-trip', () => {
    const added = addServer({
        name: 'insecure-host-key-test',
        host: '10.0.0.3',
        port: 22,
        username: 'dev',
        authMode: 'key',
        privateKeyPath: '/key',
        password: '',
        strictHostKeyChecking: false,
    });

    assert.equal(getServerById(added.id)?.strictHostKeyChecking, false);
    removeServer(added.id);
});

test('readServers handles malformed JSON gracefully', () => {
    fs.writeFileSync(SERVERS_PATH, '{invalid json', 'utf-8');
    setOutputWriter(() => undefined);
    try {
        const servers = readServers();
        assert.deepEqual(servers, []);
    } finally {
        setOutputWriter(null);
    }
});

test('readServers routes malformed JSON warning through logger output writer', () => {
    fs.writeFileSync(SERVERS_PATH, '{invalid json', 'utf-8');
    const lines: string[] = [];

    setOutputWriter(line => lines.push(line));
    try {
        const servers = readServers();
        assert.deepEqual(servers, []);
    } finally {
        setOutputWriter(null);
    }

    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\]/);
    assert.match(lines[0], /servers\.json 解析失败/);
});

test('readServers does not emit malformed JSON warnings in silent mode', () => {
    fs.writeFileSync(SERVERS_PATH, '{invalid json', 'utf-8');
    const lines: string[] = [];
    const consoleWarnings: unknown[] = [];
    const oldConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => { consoleWarnings.push(args); };

    setSilent(true);
    setOutputWriter(line => lines.push(line));
    try {
        const servers = readServers();
        assert.deepEqual(servers, []);
    } finally {
        setOutputWriter(null);
        setSilent(false);
        console.warn = oldConsoleWarn;
    }

    assert.deepEqual(lines, []);
    assert.deepEqual(consoleWarnings, []);
});

test('readServers ignores servers without id', () => {
    fs.writeFileSync(SERVERS_PATH, JSON.stringify([
        { name: 'legacy', host: '1.2.3.4', port: 22, username: 'u', authMode: 'key', privateKeyPath: '' }
    ]), 'utf-8');
    const servers = readServers();
    assert.deepEqual(servers, []);
    const raw = JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf-8'));
    assert.equal(raw[0].id, undefined);
});
