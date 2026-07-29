import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkspaceLinks } from '../remote/core/workspaceLink';
import { RemoteRepoPlan } from '../remote/core/repoStrategy';
import { RemoteRunner } from '../remote/core/types';

test('creates symlinks for remote-only dependencies inside the staged workspace', async () => {
    const commands: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };

    const result = await executeWorkspaceLinks({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        plans: [repoPlan()],
        runner
    });

    assert.equal(result.ok, true);
    assert.equal(commands.length, 1);
    assert.match(commands[0], /ln -sfn/);
    assert.match(commands[0], /xylib_arm64/);
});

test('blocks remote-only symlink when remotePath is missing', async () => {
    const runner: RemoteRunner = {
        async run() {
            throw new Error('runner should not be called');
        }
    };

    const result = await executeWorkspaceLinks({
        stagedWorkspace: '/home/xw/workspace/forja-remote/release',
        plans: [repoPlan({ remotePath: undefined })],
        runner
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /remotePath/);
});

function repoPlan(overrides: Partial<RemoteRepoPlan> = {}): RemoteRepoPlan {
    return {
        localName: 'xylib_win32',
        remoteName: 'xylib_arm64',
        role: 'remote-only',
        strategy: 'status-only',
        overlayAllowed: false,
        staged: false,
        remotePath: '/home/xw/workspace/dev/xylib_arm64',
        mount: 'symlink',
        diagnostics: [],
        ...overrides
    };
}
