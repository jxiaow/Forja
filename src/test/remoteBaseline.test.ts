import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inspectLocalRepositories, inspectRemoteRepositories, buildRemoteBaselineStatus } from '../remote/core/baseline';
import { buildRemoteStatus } from '../remote/core/status';

const tmpDirs: string[] = [];

test.after(() => {
    for (const dir of tmpDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

function workspaceWithRepos(names: string[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-remote-baseline-'));
    tmpDirs.push(root);
    for (const name of names) {
        fs.mkdirSync(path.join(root, name, '.git'), { recursive: true });
    }
    return root;
}

function fakeGit(outputs: Record<string, { exitCode?: number; stdout?: string; stderr?: string }>) {
    return {
        async exec(cwd: string, args: string[]) {
            const repo = path.basename(cwd);
            const key = repo + ' ' + args.join(' ');
            const output = outputs[key] || outputs[args.join(' ')];
            if (!output) { return { exitCode: 1, stdout: '', stderr: 'unexpected git: ' + key }; }
            return { exitCode: output.exitCode ?? 0, stdout: output.stdout ?? '', stderr: output.stderr ?? '' };
        }
    };
}

test('inspectLocalRepositories blocks detached HEAD before branchSync', async () => {
    const workspace = workspaceWithRepos(['qt-app']);
    const result = await inspectLocalRepositories({
        workspace,
        git: fakeGit({
            'qt-app rev-parse --abbrev-ref HEAD': { stdout: 'HEAD\n' },
            'qt-app rev-parse HEAD': { stdout: 'abc123\n' },
            'qt-app rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dev\n' },
            'qt-app rev-parse @{u}': { stdout: 'abc123\n' },
            'qt-app rev-list --left-right --count HEAD...@{u}': { stdout: '0 0\n' }
        })
    });

    assert.equal(result.ok, false);
    assert.equal(result.repos[0].branch, undefined);
    assert.match(result.diagnostics[0].message, /detached HEAD/);
});

test('inspectLocalRepositories blocks unpushed and behind branches', async () => {
    const workspace = workspaceWithRepos(['qt-app', 'sdk-lib']);
    const result = await inspectLocalRepositories({
        workspace,
        git: fakeGit({
            'qt-app rev-parse --abbrev-ref HEAD': { stdout: 'dev\n' },
            'qt-app rev-parse HEAD': { stdout: 'local-a\n' },
            'qt-app rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dev\n' },
            'qt-app rev-parse @{u}': { stdout: 'remote-a\n' },
            'qt-app rev-list --left-right --count HEAD...@{u}': { stdout: '1 0\n' },
            'sdk-lib rev-parse --abbrev-ref HEAD': { stdout: 'dev\n' },
            'sdk-lib rev-parse HEAD': { stdout: 'local-b\n' },
            'sdk-lib rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dev\n' },
            'sdk-lib rev-parse @{u}': { stdout: 'remote-b\n' },
            'sdk-lib rev-list --left-right --count HEAD...@{u}': { stdout: '0 2\n' }
        })
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.repos.map(repo => repo.name), ['qt-app', 'sdk-lib']);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /未 push/);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /落后 upstream/);
});

test('inspectRemoteRepositories classifies git and files repos without destructive commands', async () => {
    const commands: string[] = [];
    const result = await inspectRemoteRepositories({
        remotePath: '/remote/ws',
        repos: [{ name: 'qt-app' }, { name: 'sdk-lib' }],
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes("'qt-app'")) {
                    return { exitCode: 0, stdout: 'mode:git\ncommit:abc123\nstatus:\n M src/main.cpp\n?? tmp/cache.txt\n', stderr: '' };
                }
                return { exitCode: 0, stdout: 'mode:files\n', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.repos[0].mode, 'git');
    assert.equal(result.repos[0].remoteCommit, 'abc123');
    assert.deepEqual(result.repos[0].preservedTracked, ['src/main.cpp']);
    assert.deepEqual(result.repos[0].unknownUntracked, ['tmp/cache.txt']);
    assert.equal(result.repos[1].mode, 'files');
    const allCommands = commands.join('\n');
    assert.match(allCommands, /repo_dir='\/remote\/ws'\/'qt-app'; if/);
    assert.doesNotMatch(allCommands, /reset --hard|clean -fd|checkout -- \./);
});

test('buildRemoteBaselineStatus blocks commit mismatch and degrades files-only repos', async () => {
    const workspace = workspaceWithRepos(['qt-app', 'sdk-lib']);
    const result = await buildRemoteBaselineStatus({
        workspace,
        remotePath: '/remote/ws',
        git: fakeGit({
            'qt-app rev-parse --abbrev-ref HEAD': { stdout: 'dev\n' },
            'qt-app rev-parse HEAD': { stdout: 'abc123\n' },
            'qt-app rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dev\n' },
            'qt-app rev-parse @{u}': { stdout: 'abc123\n' },
            'qt-app rev-list --left-right --count HEAD...@{u}': { stdout: '0 0\n' },
            'sdk-lib rev-parse --abbrev-ref HEAD': { stdout: 'dev\n' },
            'sdk-lib rev-parse HEAD': { stdout: 'def456\n' },
            'sdk-lib rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dev\n' },
            'sdk-lib rev-parse @{u}': { stdout: 'def456\n' },
            'sdk-lib rev-list --left-right --count HEAD...@{u}': { stdout: '0 0\n' }
        }),
        runner: {
            async run(command: string) {
                if (command.includes("'qt-app'")) { return { exitCode: 0, stdout: 'mode:git\ncommit:zzz999\nstatus:\n', stderr: '' }; }
                return { exitCode: 0, stdout: 'mode:files\n', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.overall, 'blocked');
    assert.equal(result.repos[0].commitAligned, false);
    assert.equal(result.repos[1].mode, 'files');
    assert.equal(result.repos[1].commitAligned, undefined);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /commit 不一致/);
});


test('remote status includes repo baseline snapshot after readiness probes', async () => {
    const workspace = workspaceWithRepos(['qt-app']);
    const commands: string[] = [];
    const result = await buildRemoteStatus({
        workspace,
        config: {
            workspace,
            server: {
                id: 'server-1',
                name: 'build-01',
                host: '127.0.0.1',
                port: 22,
                username: 'dev',
                authMode: 'key',
                privateKeyPath: '',
                password: ''
            },
            remotePath: '/remote/ws',
            ignore: []
        },
        git: fakeGit({
            'qt-app rev-parse --abbrev-ref HEAD': { stdout: 'dev\n' },
            'qt-app rev-parse HEAD': { stdout: 'abc123\n' },
            'qt-app rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dev\n' },
            'qt-app rev-parse @{u}': { stdout: 'abc123\n' },
            'qt-app rev-list --left-right --count HEAD...@{u}': { stdout: '0 0\n' }
        }),
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('printf compilot-remote-ok')) { return { exitCode: 0, stdout: 'compilot-remote-ok', stderr: '' }; }
                if (command.includes('uname -s')) { return { exitCode: 0, stdout: 'Linux\n', stderr: '' }; }
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/remote/ws\n', stderr: '' }; }
                if (command.includes('$HOME/.compilot/bin/compilot --version')) { return { exitCode: 0, stdout: '0.7.41\n', stderr: '' }; }
                if (command.includes('lock.json')) { return { exitCode: 0, stdout: 'absent\n', stderr: '' }; }
                if (command.includes("'qt-app'")) { return { exitCode: 0, stdout: 'mode:git\ncommit:abc123\nstatus:\n M generated/version.h\n', stderr: '' }; }
                return { exitCode: 1, stdout: '', stderr: 'unexpected command' };
            }
        }
    });

    assert.equal(result.overall, 'ready');
    assert.ok(result.layers.some(layer => layer.name === 'repoDiscovery' && layer.ok === true));
    assert.ok(result.layers.some(layer => layer.name === 'targetLock' && layer.ok === true));
    assert.ok(result.layers.some(layer => layer.name === 'baselinePrecheck' && layer.ok === true));
    assert.equal(result.repos?.[0].name, 'qt-app');
    assert.equal(result.repos?.[0].commitAligned, true);
    assert.deepEqual(result.repos?.[0].preservedTracked, ['generated/version.h']);
    assert.ok(commands.some(command => command.includes('git status --porcelain -uall')));
});
