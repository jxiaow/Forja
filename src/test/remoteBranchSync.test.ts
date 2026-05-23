import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRemoteBranchSync } from '../remote/core/branchSync';
import { RepoBaselineState } from '../remote/core/baseline';

function repo(overrides: Partial<RepoBaselineState>): RepoBaselineState {
    return {
        name: 'qt-app',
        mode: 'git',
        branch: 'dev',
        localCommit: 'abc123',
        remoteCommit: 'abc123',
        commitAligned: true,
        preservedTracked: [],
        unknownUntracked: [],
        diagnostics: [],
        ...overrides
    };
}

test('executeRemoteBranchSync restores overlay then fetches checkout pulls and preserves tracked dirty', async () => {
    const commands: string[] = [];
    const result = await executeRemoteBranchSync({
        remotePath: '/remote/ws',
        targetId: 'target-a',
        repos: [repo({ preservedTracked: ['package/config.pri'] })],
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('git status --porcelain -uno')) {
                    return { exitCode: 0, stdout: ' M package/config.pri\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.repos[0].name, 'qt-app');
    assert.equal(result.repos[0].skipped, false);
    assert.deepEqual(result.repos[0].preservedTracked, ['package/config.pri']);
    const joined = commands.join('\n');
    assert.match(joined, /remote-state/);
    assert.match(joined, /overlay\.json/);
    assert.match(joined, /git fetch --prune/);
    assert.match(joined, /git checkout 'dev'/);
    assert.match(joined, /git pull --ff-only/);
    assert.match(joined, /git stash push -m 'compilot-remote-preserve'/);
    assert.ok(joined.indexOf('overlay.json') < joined.indexOf('git fetch --prune'));
    assert.doesNotMatch(joined, /reset --hard|clean -fd|checkout -- \./);
});

test('executeRemoteBranchSync skips files-only repos with warning', async () => {
    const commands: string[] = [];
    const result = await executeRemoteBranchSync({
        remotePath: '/remote/ws',
        targetId: 'target-a',
        repos: [repo({ name: 'sdk-lib', mode: 'files', branch: undefined })],
        runner: {
            async run(command: string) {
                commands.push(command);
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.repos[0].skipped, true);
    assert.match(result.diagnostics[0].message, /files-only/);
    assert.equal(commands.length, 0);
});

test('executeRemoteBranchSync blocks when git repo has no branch', async () => {
    const result = await executeRemoteBranchSync({
        remotePath: '/remote/ws',
        targetId: 'target-a',
        repos: [repo({ branch: undefined })],
        runner: {
            async run() {
                throw new Error('runner should not be called');
            }
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /缺少 target branch/);
});

test('executeRemoteBranchSync stops after fetch failure and reports repo diagnostic', async () => {
    const commands: string[] = [];
    const result = await executeRemoteBranchSync({
        remotePath: '/remote/ws',
        targetId: 'target-a',
        repos: [repo({})],
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('git fetch --prune')) { return { exitCode: 2, stdout: '', stderr: 'fetch failed' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /fetch failed/);
    assert.ok(commands.some(command => command.includes('git fetch --prune')));
    assert.equal(commands.some(command => command.includes('git pull --ff-only')), false);
});


test('executeRemoteBranchSync restores preserved stash when pull fails after stash', async () => {
    const commands: string[] = [];
    const result = await executeRemoteBranchSync({
        remotePath: '/remote/ws',
        targetId: 'target-a',
        repos: [repo({})],
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('git status --porcelain -uno')) { return { exitCode: 0, stdout: ' M package/config.pri\n', stderr: '' }; }
                if (command.includes('git pull --ff-only')) { return { exitCode: 2, stdout: '', stderr: 'pull failed' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /pull failed/);
    const pullIndex = commands.findIndex(command => command.includes('git pull --ff-only'));
    const popIndex = commands.findIndex((command, index) => index > pullIndex && command.includes('git stash pop'));
    assert.ok(pullIndex >= 0);
    assert.ok(popIndex > pullIndex);
});
