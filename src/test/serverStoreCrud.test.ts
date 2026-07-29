import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    readServers, addServer, removeServer,
    updateServer, getServerById, getServerByName
} from '../core/serverStore';

const SERVERS_PATH = path.join(os.homedir(), '.compilot', 'servers.json');
let backup: string | null = null;

before(() => {
    if (fs.existsSync(SERVERS_PATH)) {
        backup = fs.readFileSync(SERVERS_PATH, 'utf-8');
    }
    // Start with empty
    const dir = path.dirname(SERVERS_PATH);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(SERVERS_PATH, '[]', 'utf-8');
});

after(() => {
    if (backup !== null) {
        fs.writeFileSync(SERVERS_PATH, backup, 'utf-8');
    } else if (fs.existsSync(SERVERS_PATH)) {
        fs.unlinkSync(SERVERS_PATH);
    }
});

test('readServers returns empty array when file has []', () => {
    const servers = readServers();
    assert.deepEqual(servers, []);
});

test('addServer creates server with generated id', () => {
    const s = addServer({ name: 'test-srv', host: '10.0.0.1', port: 22, username: 'dev', authMode: 'key', privateKeyPath: '/key', password: '', remotePath: '/home/dev' });
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

test('getServerByName finds by name', () => {
    const found = getServerByName('test-srv');
    assert.ok(found);
    assert.equal(found.host, '10.0.0.1');
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

test('readServers handles malformed JSON gracefully', () => {
    fs.writeFileSync(SERVERS_PATH, '{invalid json', 'utf-8');
    const servers = readServers();
    assert.deepEqual(servers, []);
});

test('readServers migrates servers without id', () => {
    fs.writeFileSync(SERVERS_PATH, JSON.stringify([
        { name: 'legacy', host: '1.2.3.4', port: 22, username: 'u', authMode: 'key', privateKeyPath: '' }
    ]), 'utf-8');
    const servers = readServers();
    assert.equal(servers.length, 1);
    assert.ok(servers[0].id, 'should have auto-generated id');
    assert.equal(servers[0].name, 'legacy');
    // File should be rewritten with id
    const raw = JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf-8'));
    assert.ok(raw[0].id);
});
