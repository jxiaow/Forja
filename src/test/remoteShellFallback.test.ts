import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRemoteShellFallback, supportsRemoteShellFallback } from '../remote/core/remoteShellFallback';
import { RemoteRunner } from '../remote/core/types';

test('remote shell fallback supports qt run stop and ps', () => {
    assert.equal(supportsRemoteShellFallback('qt', 'run'), true);
    assert.equal(supportsRemoteShellFallback('qt', 'ps'), true);
    assert.equal(supportsRemoteShellFallback('qt', 'stop'), true);
});

test('remote shell fallback qt run starts a detached executable and returns parsed json', async () => {
    let captured = '';
    const runner: RemoteRunner = {
        async run(command: string) {
            captured = command;
            return {
                exitCode: 0,
                stdout: '{"ok":true,"action":"run","pid":123,"logFile":"/remote/app/.forja/run.log","executablePath":"/remote/app/demo"}\n',
                stderr: ''
            };
        }
    };

    const result = await executeRemoteShellFallback({
        target: 'qt',
        action: 'run',
        remotePath: '/remote/app',
        runner
    });

    assert.equal(result.ok, true);
    assert.equal((result.result as { pid: number }).pid, 123);
    assert.match(captured, /nohup/);
    assert.match(captured, /run-state/);
});

test('remote shell fallback qmake keeps project and qmake arguments', async () => {
    let captured = '';
    const runner: RemoteRunner = {
        async run(command: string) {
            captured = command;
            return { exitCode: 0, stdout: 'qmake ok\n', stderr: '' };
        }
    };

    const result = await executeRemoteShellFallback({
        target: 'qt',
        action: 'qmake',
        remotePath: '/remote/app',
        args: ['--project', 'qt_client/app.pro', '--qmake-args', 'INCLUDEPATH+=../../cpp-sdk-extend/include'],
        runner
    });

    assert.equal(result.ok, true);
    assert.match(captured, /qt_client\/app\.pro/);
    assert.match(captured, /INCLUDEPATH\+=\.\.\/\.\.\/cpp-sdk-extend\/include/);
    assert.doesNotMatch(captured, /find \. -maxdepth 4 -name "\*\.pro"/);
});

test('remote shell fallback uses Qt runtime library path when qt path is provided', async () => {
    const commands: string[] = [];
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        }
    };

    await executeRemoteShellFallback({
        target: 'qt',
        action: 'qmake',
        remotePath: '/remote/app',
        args: ['--project', 'qt_client/app.pro', '--qt', '/usr/local/qt5.13.2'],
        runner
    });
    await executeRemoteShellFallback({
        target: 'qt',
        action: 'build',
        remotePath: '/remote/app',
        args: ['--qt', '/usr/local/qt5.13.2'],
        runner
    });

    for (const command of commands) {
        assert.match(command, /export PATH='\/usr\/local\/qt5\.13\.2\/bin':"\$PATH"/);
        assert.match(command, /export LD_LIBRARY_PATH='\/usr\/local\/qt5\.13\.2\/lib':"\$HOME\/\.forja\/compat\/icu55\/lib":"\$LD_LIBRARY_PATH"/);
    }
});

test('remote shell fallback qt ps reads managed run state', async () => {
    let captured = '';
    const runner: RemoteRunner = {
        async run(command: string) {
            captured = command;
            return {
                exitCode: 0,
                stdout: '{"ok":true,"action":"ps","running":true,"pid":123,"logFile":"/remote/app/.forja/run.log","executablePath":"/remote/app/demo"}\n',
                stderr: ''
            };
        }
    };

    const result = await executeRemoteShellFallback({
        target: 'qt',
        action: 'ps',
        remotePath: '/remote/app',
        runner
    });

    assert.equal(result.ok, true);
    assert.equal((result.result as { running: boolean }).running, true);
    assert.match(captured, /run-state/);
    assert.match(captured, /kill -0/);
});

test('remote shell fallback qt stop clears managed run state', async () => {
    let captured = '';
    const runner: RemoteRunner = {
        async run(command: string) {
            captured = command;
            return {
                exitCode: 0,
                stdout: '{"ok":true,"action":"stop","stopped":true,"pid":123}\n',
                stderr: ''
            };
        }
    };

    const result = await executeRemoteShellFallback({
        target: 'qt',
        action: 'stop',
        remotePath: '/remote/app',
        runner
    });

    assert.equal(result.ok, true);
    assert.equal((result.result as { stopped: boolean }).stopped, true);
    assert.match(captured, /rm -f "\$state_file"/);
});
