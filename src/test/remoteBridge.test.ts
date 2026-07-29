import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRemoteBridge } from '../remote/core/bridge';

test('executeRemoteBridge includes stdout preview when json parsing fails', async () => {
    const result = await executeRemoteBridge({
        target: 'qt',
        action: 'build',
        args: [],
        json: true,
        remotePath: '/remote/app',
        runner: {
            run: async () => ({
                exitCode: 0,
                stdout: 'build started\nnot-json\n',
                stderr: ''
            })
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.stdout, 'build started\nnot-json\n');
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0].message, /JSON 输出解析失败/);
    assert.match(result.diagnostics[0].message, /build started/);
    assert.match(result.diagnostics[0].message, /not-json/);
});
