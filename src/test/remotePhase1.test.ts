import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runRemoteCli } from '../remote/cli';
import { executeRemoteBootstrap, findBootstrapArtifact } from '../remote/core/bootstrap';
import { executeRemoteBridge } from '../remote/core/bridge';
import { buildRemoteStatus, buildRemoteTest } from '../remote/core/status';
import { executeRemoteUnlock, unlockRemoteTarget } from '../remote/core/lock';
import { executeRemoteRestore } from '../remote/core/restore';
import { VERSION } from '../version';


const tmpDirs: string[] = [];
after(() => {
    for (const dir of tmpDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});
afterEach(() => { process.exitCode = undefined; });

function tmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

function testServer() {
    return {
        id: 'server-1',
        name: 'build-01',
        host: '127.0.0.1',
        port: 22,
        username: 'dev',
        authMode: 'key' as const,
        privateKeyPath: '',
        password: ''
    };
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
    const chunks: string[] = [];
    const oldLog = console.log;
    console.log = (message?: unknown) => { chunks.push(String(message ?? '')); };
    try {
        await fn();
    } finally {
        console.log = oldLog;
    }
    return chunks.join('\n');
}

test('remote status reports missing sync configuration without SSH', async () => {
    const workspace = tmpDir('compilot-remote-status-');
    const result = await buildRemoteStatus({ workspace });

    assert.equal(result.ok, true);
    assert.equal(result.action, 'status');
    assert.equal(result.overall, 'blocked');
    assert.equal(result.layers[0].name, 'syncConfig');
    assert.equal(result.layers[0].ok, false);
    assert.deepEqual(result.nextActions, ['配置 sync server 和 remotePath']);
});

test('remote test CLI returns JSON error when sync is disabled', async () => {
    const workspace = tmpDir('compilot-remote-cli-');
    const output = await captureStdout(() => runRemoteCli(['test', '--workspace', workspace, '--json']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.action, 'test');
    assert.equal(parsed.failedLayer, 'syncConfig');
});

test('bootstrap artifact lookup requires exact current version tgz', () => {
    const root = tmpDir('compilot-remote-artifact-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');
    fs.mkdirSync(path.join(root, 'dist', 'compilot-1.2.2', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'compilot-1.2.2', 'cli', 'compilot-cli-1.2.2.tgz'), 'old', 'utf8');

    const missing = findBootstrapArtifact(root);
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.nextActions, ['npm run package:all']);

    const expectedDir = path.join(root, 'dist', 'compilot-1.2.3', 'cli');
    fs.mkdirSync(expectedDir, { recursive: true });
    const expectedPath = path.join(expectedDir, 'compilot-cli-1.2.3.tgz');
    fs.writeFileSync(expectedPath, 'current', 'utf8');

    const found = findBootstrapArtifact(root);
    assert.equal(found.ok, true);
    assert.equal(found.artifactPath, expectedPath);
    assert.equal(found.version, '1.2.3');
});

test('unlock requires force and matching lock id', () => {
    const stateRoot = tmpDir('compilot-remote-state-');
    const lockDir = path.join(stateRoot, 'locks', 'target-a');
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'lock.json'), JSON.stringify({ lockId: 'abc', targetId: 'target-a' }), 'utf8');

    const withoutForce = unlockRemoteTarget({ stateRoot, targetId: 'target-a', lockId: 'abc', force: false });
    assert.equal(withoutForce.ok, false);

    const mismatch = unlockRemoteTarget({ stateRoot, targetId: 'target-a', lockId: 'wrong', force: true });
    assert.equal(mismatch.ok, false);
    assert.equal(fs.existsSync(lockDir), true);

    const unlocked = unlockRemoteTarget({ stateRoot, targetId: 'target-a', lockId: 'abc', force: true });
    assert.equal(unlocked.ok, true);
    assert.equal(unlocked.removed, true);
    assert.equal(fs.existsSync(lockDir), false);
});

test('remote status uses configured remote compilot bin during probe', async () => {
    const workspace = tmpDir('compilot-remote-bin-');
    const commands: string[] = [];
    const result = await buildRemoteStatus({
        workspace,
        remoteCompilotBin: '/opt/compilot/bin/compilot',
        baseline: false,
        config: { workspace, server: testServer(), remotePath: '/remote/ws' },
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('printf compilot-remote-ok')) { return { exitCode: 0, stdout: 'compilot-remote-ok', stderr: '' }; }
                if (command.includes('uname -s')) { return { exitCode: 0, stdout: 'Linux\n', stderr: '' }; }
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/remote/ws\n', stderr: '' }; }
                if (command.includes('/opt/compilot/bin/compilot')) { return { exitCode: 0, stdout: '0.7.41\n', stderr: '' }; }
                return { exitCode: 1, stdout: '', stderr: 'unexpected command' };
            }
        }
    });

    assert.equal(result.overall, 'ready');
    assert.ok(commands.some(command => command.includes('/opt/compilot/bin/compilot')));
});

test('remote status includes configured server and remote path without probing when runner is omitted', async () => {
    const workspace = tmpDir('compilot-remote-config-');
    const result = await buildRemoteStatus({
        workspace,
        probe: false,
        baseline: false,
        config: { workspace, server: testServer(), remotePath: '/remote/ws' }
    });

    assert.equal(result.ok, true);
    assert.equal(result.server, 'build-01');
    assert.equal(result.remotePath, '/remote/ws');
    assert.equal(result.overall, 'unknown');
    assert.ok(result.layers.some(layer => layer.name === 'remoteCompilot' && layer.ok === null));
});


test('executeRemoteBootstrap uploads artifact and runs remote install steps', async () => {
    const root = tmpDir('compilot-remote-bootstrap-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');
    const artifactDir = path.join(root, 'dist', 'compilot-1.2.3', 'cli');
    fs.mkdirSync(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, 'compilot-cli-1.2.3.tgz');
    fs.writeFileSync(artifactPath, 'current', 'utf8');
    const artifact = findBootstrapArtifact(root);
    assert.equal(artifact.ok, true);

    const uploads: Array<{ localPath: string; remotePath: string }> = [];
    const commands: string[] = [];
    const result = await executeRemoteBootstrap({
        artifact,
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('--version')) { return { exitCode: 0, stdout: '1.2.3\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: {
            async upload(localPath: string, remotePath: string) {
                uploads.push({ localPath, remotePath });
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.version, '1.2.3');
    assert.equal(uploads[0].localPath, artifactPath);
    assert.ok(commands.some(command => command.includes('npm install -g --prefix')));
    assert.ok(commands.some(command => command.includes('.compilot/bin/compilot')));
});

test('remote test bootstrap installs compilot and retests remote version', async () => {
    const root = tmpDir('compilot-remote-test-bootstrap-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: VERSION }), 'utf8');
    const artifactDir = path.join(root, 'dist', `compilot-${VERSION}`, 'cli');
    fs.mkdirSync(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, `compilot-cli-${VERSION}.tgz`);
    fs.writeFileSync(artifactPath, 'current', 'utf8');
    const artifact = findBootstrapArtifact(root);
    assert.equal(artifact.ok, true);

    const uploads: Array<{ localPath: string; remotePath: string }> = [];
    const commands: string[] = [];
    let versionProbeCount = 0;
    const result = await buildRemoteTest({
        workspace: root,
        bootstrap: true,
        artifact,
        config: { workspace: root, server: testServer(), remotePath: '/remote/ws' },
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('printf compilot-remote-ok')) { return { exitCode: 0, stdout: 'compilot-remote-ok', stderr: '' }; }
                if (command.includes('uname -s')) { return { exitCode: 0, stdout: 'Linux\n', stderr: '' }; }
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/remote/ws\n', stderr: '' }; }
                if (command.includes('$HOME/.compilot/bin/compilot --version')) {
                    versionProbeCount++;
                    return { exitCode: 0, stdout: versionProbeCount === 1 ? '0.0.0\n' : VERSION + '\n', stderr: '' };
                }
                if (command.includes('--version')) { return { exitCode: 0, stdout: VERSION + '\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: {
            async upload(localPath: string, remotePath: string) {
                uploads.push({ localPath, remotePath });
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(uploads[0].localPath, artifactPath);
    assert.ok(result.stages?.some(stage => stage.stage === 'bootstrap' && stage.ok));
    assert.ok(commands.filter(command => command.includes('$HOME/.compilot/bin/compilot --version')).length >= 2);
});

test('executeRemoteBridge runs qt status under remote workspace and parses JSON', async () => {
    const commands: string[] = [];
    const result = await executeRemoteBridge({
        target: 'qt',
        action: 'status',
        args: [],
        json: true,
        remotePath: '/remote/ws',
        runner: {
            async run(command: string) {
                commands.push(command);
                return { exitCode: 0, stdout: '{"ok":true,"action":"status"}\n', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { ok: true, action: 'status' });
    assert.ok(commands[0].includes("cd '/remote/ws'"));
    assert.ok(commands[0].includes('$HOME/.compilot/bin/compilot'));
    assert.ok(commands[0].includes("'qt' 'status'"));
    assert.ok(commands[0].includes("'--workspace' '/remote/ws'"));
    assert.ok(commands[0].includes("'--json'"));
});

test('remote CLI rejects sdk run bridge action', async () => {
    const output = await captureStdout(() => runRemoteCli(['sdk', 'run', '--json']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.match(parsed.diagnostics[0].message, /remote sdk 仅支持 status\/init\/use/);
});

test('executeRemoteRestore restores tracked paths inside selected repo', async () => {
    const commands: string[] = [];
    const result = await executeRemoteRestore({
        remotePath: '/remote/ws',
        repo: 'qt-app',
        paths: ['src/main.cpp', 'generated/version.h'],
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.restored, ['src/main.cpp', 'generated/version.h']);
    assert.ok(commands.some(command => command.includes("cd '/remote/ws'/'qt-app'"))); 
    assert.ok(commands.some(command => command.includes('git ls-files --error-unmatch')));
    assert.ok(commands.some(command => command.includes('git restore --')));
    assert.ok(commands.some(command => command.includes("'src/main.cpp'")));
});

test('executeRemoteRestore cleans overlay manifest and underlay backup after git restore', async () => {
    const commands: string[] = [];
    const result = await executeRemoteRestore({
        remotePath: '/remote/ws',
        repo: 'qt-app',
        paths: ['src/main.cpp'],
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.stateCleaned, true);
    assert.ok(result.targetId);
    assert.ok(result.targetId.length > 20);
    assert.ok(commands.some(command => command.includes('remote-state')));
    assert.ok(commands.some(command => command.includes('overlay.json')));
    assert.ok(commands.some(command => command.includes('underlay')));
    assert.ok(commands.some(command => command.includes('src/main.cpp')));
});

test('executeRemoteRestore fails when overlay state cleanup fails after restore', async () => {
    const result = await executeRemoteRestore({
        remotePath: '/remote/ws',
        repo: 'qt-app',
        paths: ['src/main.cpp'],
        runner: {
            async run(command: string) {
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                if (command.includes('overlay.json')) { return { exitCode: 2, stdout: '', stderr: 'cleanup failed' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.restored.length, 0);
    assert.match(result.diagnostics[0].message, /cleanup failed/);
});

test('executeRemoteRestore rejects unsafe repo relative paths', async () => {
    const result = await executeRemoteRestore({
        remotePath: '/remote/ws',
        repo: 'qt-app',
        paths: ['../secret.txt'],
        runner: {
            async run() {
                throw new Error('runner should not be called');
            }
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /非法 restore 路径/);
});

test('remote CLI rejects restore without repo', async () => {
    const output = await captureStdout(() => runRemoteCli(['qt', 'restore', '--json', '--', 'src/main.cpp']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.match(parsed.diagnostics[0].message, /remote restore 需要 --repo/);
});

test('executeRemoteUnlock removes matching remote lock by canonical remote path target id', async () => {
    const commands: string[] = [];
    const result = await executeRemoteUnlock({
        remotePath: '/remote/ws',
        lockId: 'abc',
        force: true,
        runner: {
            async run(command: string) {
                commands.push(command);
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/canonical/ws\n', stderr: '' }; }
                if (command.includes('lock.json')) { return { exitCode: 0, stdout: 'removed\n', stderr: '' }; }
                return { exitCode: 1, stdout: '', stderr: 'unexpected command' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.removed, true);
    assert.ok(result.targetId.length > 20);
    assert.ok(commands.some(command => command.includes('rm -rf')));
});
