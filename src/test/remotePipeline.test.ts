import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executePreparedRemoteAction, prepareRemoteWorkspace } from '../remote/core/pipeline';

const tmpDirs: string[] = [];

test.after(() => {
    for (const dir of tmpDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

function workspace(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-remote-pipeline-'));
    tmpDirs.push(root);
    fs.mkdirSync(path.join(root, 'qt-app', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'qt-app', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'qt-app', 'src/main.cpp'), 'main', 'utf8');
    return root;
}

function fakeGit(status = ' M src/main.cpp\n') {
    return {
        async exec(cwd: string, args: string[]) {
            const joined = args.join(' ');
            if (joined === 'rev-parse --abbrev-ref HEAD') { return { exitCode: 0, stdout: 'dev\n', stderr: '' }; }
            if (joined === 'rev-parse HEAD') { return { exitCode: 0, stdout: 'abc123\n', stderr: '' }; }
            if (joined === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') { return { exitCode: 0, stdout: 'origin/dev\n', stderr: '' }; }
            if (joined === 'rev-parse @{u}') { return { exitCode: 0, stdout: 'abc123\n', stderr: '' }; }
            if (joined === 'rev-list --left-right --count HEAD...@{u}') { return { exitCode: 0, stdout: '0 0\n', stderr: '' }; }
            if (joined === 'status --porcelain -uall') { return { exitCode: 0, stdout: status, stderr: '' }; }
            return { exitCode: 1, stdout: '', stderr: 'unexpected git ' + joined + ' in ' + cwd };
        }
    };
}

test('prepareRemoteWorkspace runs stages in order and releases lock on success', async () => {
    const commands: string[] = [];
    const uploads: string[] = [];
    const result = await prepareRemoteWorkspace({
        workspace: workspace(),
        remotePath: '/remote/ws',
        ignore: [],
        owner: 'cli',
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                if (command.includes('mkdir "$lock_dir"')) { return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock-a","targetId":"target-a","owner":"cli","stage":"prepare","remotePath":"/remote/ws","repos":["qt-app"],"startedAt":"2026-05-23T00:00:00.000Z"}\n', stderr: '' }; }
                if (command.includes('lock-id mismatch')) { return { exitCode: 0, stdout: 'removed\n', stderr: '' }; }
                if (command.includes("'qt-app'")) { return { exitCode: 0, stdout: 'mode:git\ncommit:abc123\nstatus:\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: {
            async upload(_localPath: string, remotePath: string) {
                uploads.push(remotePath);
            }
        },
        git: fakeGit()
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.stages.map(stage => stage.stage), ['baselinePrecheck', 'acquireLock', 'branchSync', 'overlaySync', 'baselineCheck', 'releaseLock']);
    assert.equal(result.lock?.lockId, 'lock-a');
    assert.ok(uploads.some(item => item.endsWith('/qt-app/src/main.cpp')));
    assert.ok(commands.some(command => command.includes('rm -rf "$lock_dir"')));
});

test('prepareRemoteWorkspace releases lock when branchSync fails', async () => {
    const commands: string[] = [];
    const result = await prepareRemoteWorkspace({
        workspace: workspace(),
        remotePath: '/remote/ws',
        ignore: [],
        owner: 'cli',
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                if (command.includes('mkdir "$lock_dir"')) { return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock-a","targetId":"target-a","owner":"cli","stage":"prepare","remotePath":"/remote/ws","repos":["qt-app"],"startedAt":"2026-05-23T00:00:00.000Z"}\n', stderr: '' }; }
                if (command.includes('git fetch --prune')) { return { exitCode: 2, stdout: '', stderr: 'fetch failed' }; }
                if (command.includes('lock-id mismatch')) { return { exitCode: 0, stdout: 'removed\n', stderr: '' }; }
                if (command.includes("'qt-app'")) { return { exitCode: 0, stdout: 'mode:git\ncommit:abc123\nstatus:\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: { async upload() { /* not reached */ } },
        git: fakeGit()
    });

    assert.equal(result.ok, false);
    assert.equal(result.failedStage, 'branchSync');
    assert.ok(commands.some(command => command.includes('rm -rf "$lock_dir"')));
});


test('executePreparedRemoteAction runs remote qt build after prepare succeeds', async () => {
    const commands: string[] = [];
    const result = await executePreparedRemoteAction({
        workspace: workspace(),
        remotePath: '/remote/ws',
        ignore: [],
        owner: 'cli',
        target: 'qt',
        action: 'build',
        args: [],
        json: true,
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                if (command.includes('mkdir "$lock_dir"')) { return { exitCode: 0, stdout: 'acquired\n{"lockId":"lock-a","targetId":"target-a","owner":"cli","stage":"prepare","remotePath":"/remote/ws","repos":["qt-app"],"startedAt":"2026-05-23T00:00:00.000Z"}\n', stderr: '' }; }
                if (command.includes('lock-id mismatch')) { return { exitCode: 0, stdout: 'removed\n', stderr: '' }; }
                if (command.includes('$HOME/.compilot/bin/compilot') && command.includes("'qt' 'build'")) { return { exitCode: 0, stdout: '{"ok":true,"action":"build"}\n', stderr: '' }; }
                if (command.includes("'qt-app'")) { return { exitCode: 0, stdout: 'mode:git\ncommit:abc123\nstatus:\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: { async upload() { /* no-op */ } },
        git: fakeGit('')
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, 'preparedAction');
    assert.equal(result.remote?.target, 'qt');
    assert.equal(result.remote?.remoteAction, 'build');
    assert.ok(result.stages.some(stage => stage.stage === 'remoteAction' && stage.ok));
    assert.deepEqual(result.stages.map(stage => stage.stage), ['baselinePrecheck', 'acquireLock', 'branchSync', 'overlaySync', 'baselineCheck', 'remoteAction', 'releaseLock']);
    const actionIndex = commands.findIndex(command => command.includes("'qt' 'build'"));
    const releaseIndex = commands.findIndex((command, index) => index > actionIndex && command.includes('lock-id mismatch'));
    assert.ok(actionIndex >= 0);
    assert.ok(releaseIndex > actionIndex);
});

test('executePreparedRemoteAction does not run action when prepare fails', async () => {
    const commands: string[] = [];
    const result = await executePreparedRemoteAction({
        workspace: workspace(),
        remotePath: '/remote/ws',
        ignore: [],
        owner: 'cli',
        target: 'sdk',
        action: 'build',
        args: [],
        json: true,
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes("'qt-app'")) { return { exitCode: 0, stdout: 'mode:git\ncommit:mismatch\nstatus:\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: { async upload() { throw new Error('not reached'); } },
        git: fakeGit('')
    });

    assert.equal(result.ok, false);
    assert.equal(result.failedStage, 'baselinePrecheck');
    assert.equal(commands.some(command => command.includes("'sdk' 'build'")), false);
});
