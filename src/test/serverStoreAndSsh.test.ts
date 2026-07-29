import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { createAskpassEnv } from '../core/ssh';

test('createAskpassEnv returns undefined for null password', () => {
    const result = createAskpassEnv(null);
    assert.equal(result, undefined);
});

test('createAskpassEnv returns undefined for empty password', () => {
    const result = createAskpassEnv('');
    assert.equal(result, undefined);
});

test('createAskpassEnv creates script and returns env with cleanup', () => {
    const result = createAskpassEnv('testpass123', 'unit-test');
    assert.ok(result, 'should return AskpassEnv');
    assert.ok(result.env.SSH_ASKPASS, 'should set SSH_ASKPASS');
    assert.equal(result.env.SSH_ASKPASS_REQUIRE, 'force');
    assert.equal(result.env.FORJA_SSH_PASS, 'testpass123', 'should set password env var');

    // Cleanup should remove the script file
    result.cleanup();
    const scriptPath = path.join(os.tmpdir(), `forja-askpass-unit-test${process.platform === 'win32' ? '.cmd' : '.sh'}`);
    assert.equal(fs.existsSync(scriptPath), false, 'script should be cleaned up');
});

test('createAskpassEnv script file exists before cleanup', () => {
    const result = createAskpassEnv('mypass', 'exist-test');
    assert.ok(result);
    const scriptPath = path.join(os.tmpdir(), `forja-askpass-exist-test${process.platform === 'win32' ? '.cmd' : '.sh'}`);
    assert.equal(fs.existsSync(scriptPath), true, 'script should exist before cleanup');
    result.cleanup();
});

test('createAskpassEnv exposes a directly spawnable askpass path on Windows', () => {
    const result = createAskpassEnv('mypass', 'spawnable-test');
    assert.ok(result);
    try {
        if (process.platform === 'win32') {
            assert.equal(path.extname(result.env.SSH_ASKPASS || ''), '.cmd');
            assert.equal(result.env.SSH_ASKPASS, result.env.GIT_ASKPASS);
        }
    } finally {
        result.cleanup();
    }
});

test('createAskpassEnv askpass command prints password and exits successfully', () => {
    const result = createAskpassEnv('mypass', 'exit-test');
    assert.ok(result);
    try {
        const output = cp.spawnSync(result.env.SSH_ASKPASS || '', [], {
            env: result.env,
            encoding: 'utf8',
            windowsHide: true
        });
        assert.equal(output.status, 0);
        assert.equal(output.stdout, 'mypass');
    } finally {
        result.cleanup();
    }
});
