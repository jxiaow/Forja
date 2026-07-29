import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRemoteRepositories } from '../remote/core/baseline';
import { RemoteRunner } from '../remote/core/types';

test('remote repo probe separates git status before elif for POSIX shells', async () => {
    let command = '';
    const runner: RemoteRunner = {
        async run(nextCommand: string) {
            command = nextCommand;
            return {
                exitCode: 0,
                stdout: 'mode:git\ncommit:abc123\nstatus:\n',
                stderr: ''
            };
        }
    };

    const result = await inspectRemoteRepositories({
        remotePath: '/tmp/workspace',
        repos: [{ name: 'app' }],
        runner
    });

    assert.equal(result.ok, true);
    assert.doesNotMatch(command, /git status --porcelain -uall\s+elif\b/);
    assert.match(command, /git status --porcelain -uall\s*;\s*elif\b/);
    assert.doesNotMatch(command, /printf "mode:files\\n"\s+else\b/);
    assert.match(command, /printf "mode:files\\n"\s*;\s*else\b/);
    assert.doesNotMatch(command, /printf "mode:files\\nmissing:true\\n"\s+fi\b/);
    assert.match(command, /printf "mode:files\\nmissing:true\\n"\s*;\s*fi\b/);
});

test('remote repo probe accepts remotePath as a single repository root', async () => {
    let command = '';
    const runner: RemoteRunner = {
        async run(nextCommand: string) {
            command = nextCommand;
            return {
                exitCode: 0,
                stdout: 'path:/home/xw/workspace/dev\nmode:git\ncommit:abc123\nstatus:\n',
                stderr: ''
            };
        }
    };

    const result = await inspectRemoteRepositories({
        remotePath: '/home/xw/workspace/dev',
        repos: [{ name: 'forja' }],
        runner
    });

    assert.equal(result.ok, true);
    assert.equal((result.repos[0] as { remotePath?: string }).remotePath, '/home/xw/workspace/dev');
    assert.match(command, /single_repo=1/);
    assert.match(command, /if \[ "\$single_repo" = "1" \] && \[ -d "\$base_dir\/\.git" \]; then repo_dir="\$base_dir"/);
});

test('remote repo probe reports missing repository as an error', async () => {
    const runner: RemoteRunner = {
        async run() {
            return {
                exitCode: 0,
                stdout: 'path:/home/xw/workspace/dev/forja\nmode:files\nmissing:true\n',
                stderr: ''
            };
        }
    };

    const result = await inspectRemoteRepositories({
        remotePath: '/home/xw/workspace/dev',
        repos: [{ name: 'forja' }],
        runner
    });

    assert.equal(result.ok, false);
    assert.equal((result.repos[0] as { missing?: boolean }).missing, true);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /远端仓库不存在/);
});
