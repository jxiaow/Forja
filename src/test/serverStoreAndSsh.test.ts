import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
    assert.equal(result.env.COMPILOT_SSH_PASS, 'testpass123', 'should set password env var');

    // Cleanup should remove the script file
    result.cleanup();
    const scriptPath = path.join(os.tmpdir(), `compilot-askpass-unit-test${process.platform === 'win32' ? '.ps1' : '.sh'}`);
    assert.equal(fs.existsSync(scriptPath), false, 'script should be cleaned up');
});

test('createAskpassEnv script file exists before cleanup', () => {
    const result = createAskpassEnv('mypass', 'exist-test');
    assert.ok(result);
    const scriptPath = path.join(os.tmpdir(), `compilot-askpass-exist-test${process.platform === 'win32' ? '.ps1' : '.sh'}`);
    assert.equal(fs.existsSync(scriptPath), true, 'script should exist before cleanup');
    result.cleanup();
});
