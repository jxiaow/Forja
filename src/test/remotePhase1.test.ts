import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runRemoteCli } from '../remote/cli';
import { executeRemoteBootstrap, findBootstrapArtifact } from '../remote/core/bootstrap';
import { executeRemoteBridge } from '../remote/core/bridge';
import { buildRemoteDoctor } from '../remote/core/doctor';
import { buildRemoteStatus, buildRemoteTest } from '../remote/core/status';
import { executeRemoteUnlock, unlockRemoteTarget } from '../remote/core/lock';
import { executeRemoteRestore } from '../remote/core/restore';
import { loadRemoteSettings, saveRemoteSettings, saveSyncSettings, DEFAULT_SYNC } from '../core/settingsIO';
import { writeServers } from '../core/serverStore';
import { executeRemoteTransfer } from '../remote/core/transfer';
import { executeRemoteCleanUntracked } from '../remote/core/cleanUntracked';
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

test('remote doctor summarizes blocked readiness with actionable next steps', async () => {
    const workspace = tmpDir('compilot-remote-doctor-');
    const result = await buildRemoteDoctor({ workspace });

    assert.equal(result.ok, false);
    assert.equal(result.action, 'doctor');
    assert.equal(result.overall, 'blocked');
    assert.ok(result.checks.some(check => check.name === 'syncConfig' && check.ok === false));
    assert.deepEqual(result.nextActions, ['配置 sync server 和 remotePath']);
    assert.ok(result.autoFixes.some(fix => fix.name === 'bootstrap' && fix.available === false));
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

test('remote doctor CLI returns JSON and human readiness guidance', async () => {
    const workspace = tmpDir('compilot-remote-doctor-cli-');
    const jsonOutput = await captureStdout(() => runRemoteCli(['doctor', '--workspace', workspace, '--json']));
    const parsed = JSON.parse(jsonOutput);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.action, 'doctor');
    assert.equal(parsed.overall, 'blocked');
    assert.ok(parsed.checks.some((check: { name: string; ok: boolean }) => check.name === 'syncConfig' && check.ok === false));

    process.exitCode = undefined;
    const textOutput = await captureStdout(() => runRemoteCli(['doctor', '--workspace', workspace]));
    assert.match(textOutput, /Remote doctor: blocked/);
    assert.match(textOutput, /blocked: syncConfig/);
    assert.match(textOutput, /next: 配置 sync server 和 remotePath/);
});

test('remote doctor bootstrap refreshes readiness after autofix succeeds', async () => {
    const workspace = tmpDir('compilot-remote-doctor-bootstrap-');
    const root = tmpDir('compilot-remote-doctor-artifact-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: VERSION }), 'utf8');
    const artifactDir = path.join(root, 'dist', `compilot-${VERSION}`, 'cli');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, `compilot-cli-${VERSION}.tgz`), 'current', 'utf8');
    const artifact = findBootstrapArtifact(root);
    assert.equal(artifact.ok, true);

    let publicVersionChecks = 0;
    const result = await buildRemoteDoctor({
        workspace,
        bootstrap: true,
        artifact,
        baseline: false,
        lock: false,
        config: { workspace, server: testServer(), remotePath: '/remote/ws', ignore: [] },
        runner: {
            async run(command: string) {
                if (command.includes('printf compilot-remote-ok')) { return { exitCode: 0, stdout: 'compilot-remote-ok', stderr: '' }; }
                if (command.includes('uname -s')) { return { exitCode: 0, stdout: 'Linux\n', stderr: '' }; }
                if (command.includes('pwd -P')) { return { exitCode: 0, stdout: '/remote/ws\n', stderr: '' }; }
                if (command.includes('$HOME/.compilot/bin/compilot --version')) {
                    publicVersionChecks++;
                    return publicVersionChecks === 1
                        ? { exitCode: 127, stdout: '', stderr: 'not found' }
                        : { exitCode: 0, stdout: VERSION + '\n', stderr: '' };
                }
                if (command.includes('--version')) { return { exitCode: 0, stdout: VERSION + '\n', stderr: '' }; }
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: { async upload() { /* test double */ } }
    });

    assert.equal(result.ok, true);
    assert.equal(result.overall, 'ready');
    assert.ok(result.checks.some(check => check.name === 'bootstrap' && check.ok === true));
    assert.deepEqual(result.nextActions, []);
});

test('bootstrap artifact lookup requires exact current version tgz', () => {
    const root = tmpDir('compilot-remote-artifact-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');
    fs.mkdirSync(path.join(root, 'dist', 'compilot-1.2.2', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'compilot-1.2.2', 'cli', 'compilot-cli-1.2.2.tgz'), 'old', 'utf8');

    const missing = findBootstrapArtifact(root);
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.nextActions, ['npm run build:cli', 'npm run package:all']);

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
        lock: false,
        config: { workspace, server: testServer(), remotePath: '/remote/ws', ignore: [] },
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
        lock: false,
        config: { workspace, server: testServer(), remotePath: '/remote/ws', ignore: [] }
    });

    assert.equal(result.ok, true);
    assert.equal(result.server, 'build-01');
    assert.equal(result.remotePath, '/remote/ws');
    assert.equal(result.overall, 'unknown');
    assert.ok(result.layers.some(layer => layer.name === 'remoteCompilot' && layer.ok === null));
});

test('remote status includes local remote settings summary without SSH', async () => {
    const workspace = tmpDir('compilot-remote-settings-summary-');
    saveRemoteSettings(workspace, {
        remoteCompilotBin: '/opt/compilot/bin/compilot',
        buildOrder: [
            { target: 'sdk', action: 'build', args: [] },
            { target: 'qt', action: 'build', args: [] }
        ],
        transfer: {
            deployServer: 'deploy-1',
            deployPath: '/opt/app',
            artifacts: ['qt-app/build/app']
        }
    });

    const result = await buildRemoteStatus({
        workspace,
        probe: false,
        baseline: false,
        lock: false,
        config: { workspace, server: testServer(), remotePath: '/remote/ws', ignore: [] }
    });

    assert.equal(result.remoteSettings?.remoteCompilotBin, '/opt/compilot/bin/compilot');
    assert.equal(result.remoteSettings?.buildOrder.configured, true);
    assert.equal(result.remoteSettings?.buildOrder.count, 2);
    assert.equal(result.remoteSettings?.transfer.configured, true);
    assert.equal(result.remoteSettings?.transfer.artifactCount, 1);
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
        config: { workspace: root, server: testServer(), remotePath: '/remote/ws', ignore: [] },
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

test('executeRemoteBridge treats parsed JSON ok false as failed', async () => {
    const result = await executeRemoteBridge({
        target: 'qt',
        action: 'status',
        args: [],
        json: true,
        remotePath: '/remote/ws',
        runner: {
            async run() {
                return { exitCode: 0, stdout: '{"ok":false,"action":"status","diagnostics":[{"level":"error","message":"qt 未初始化"}]}\n', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /qt 未初始化/);
});

test('remote CLI parses qt build prepared action and returns sync config diagnostic', async () => {
    const workspace = tmpDir('compilot-remote-build-missing-sync-');
    const output = await captureStdout(() => runRemoteCli(['qt', 'build', '--workspace', workspace, '--json']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.action, 'preparedAction');
    assert.match(parsed.diagnostics[0].message, /sync 未启用/);
});

test('remote CLI supports qt run detach and rejects foreground run json', async () => {
    const workspace = tmpDir('compilot-remote-run-missing-sync-');
    const detachOutput = await captureStdout(() => runRemoteCli(['qt', 'run', '--detach', '--workspace', workspace, '--json']));
    const detachParsed = JSON.parse(detachOutput);

    assert.equal(process.exitCode, 1);
    assert.equal(detachParsed.ok, false);
    assert.equal(detachParsed.action, 'preparedAction');
    assert.equal(detachParsed.target, 'qt');
    assert.equal(detachParsed.remoteAction, 'run');

    process.exitCode = undefined;
    const foregroundOutput = await captureStdout(() => runRemoteCli(['qt', 'run', '--workspace', workspace, '--json']));
    const foregroundParsed = JSON.parse(foregroundOutput);

    assert.equal(process.exitCode, 1);
    assert.equal(foregroundParsed.ok, false);
    assert.match(foregroundParsed.diagnostics[0].message, /remote qt run --json 仅支持 --detach 模式/);
});

test('remote CLI bridges qt stop and ps without prepared sync', async () => {
    const workspace = tmpDir('compilot-remote-stop-missing-sync-');
    const output = await captureStdout(() => runRemoteCli(['qt', 'ps', '--workspace', workspace, '--json']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.action, 'bridge');
    assert.equal(parsed.target, 'qt');
    assert.equal(parsed.remoteAction, 'ps');
});

test('remote CLI rejects sdk run bridge action', async () => {
    const output = await captureStdout(() => runRemoteCli(['sdk', 'run', '--json']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.match(parsed.diagnostics[0].message, /remote sdk 仅支持 status\/init\/use\/build\/rebuild\/clean\/restore/);
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
    assert.ok(commands.some(command => command.includes('backupPath!==underlayRoot&&backupPath.startsWith')));
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

test('remote CLI accepts reset as precise restore alias', async () => {
    const workspace = tmpDir('compilot-remote-reset-missing-sync-');
    const output = await captureStdout(() => runRemoteCli(['qt', 'reset', '--repo', 'qt-app', '--workspace', workspace, '--json', '--', 'src/main.cpp']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.action, 'reset');
    assert.equal(parsed.target, 'qt');
    assert.match(parsed.diagnostics[0].message, /sync 未启用/);
});

test('remote CLI manages build order in user remote settings', async () => {
    const workspace = tmpDir('compilot-remote-build-order-');
    const setOutput = await captureStdout(() => runRemoteCli(['build-order', 'set', 'sdk:build', 'qt:qmake', 'qt:build', '--workspace', workspace, '--json']));
    const setParsed = JSON.parse(setOutput);

    assert.equal(setParsed.ok, true);
    assert.equal(setParsed.action, 'buildOrder');
    assert.deepEqual(setParsed.buildOrder.map((item: { target: string; action: string }) => item.target + ':' + item.action), ['sdk:build', 'qt:qmake', 'qt:build']);
    assert.deepEqual(loadRemoteSettings(workspace).buildOrder.map(item => item.target + ':' + item.action), ['sdk:build', 'qt:qmake', 'qt:build']);

    const statusOutput = await captureStdout(() => runRemoteCli(['build-order', 'status', '--workspace', workspace, '--json']));
    const statusParsed = JSON.parse(statusOutput);
    assert.deepEqual(statusParsed.buildOrder.map((item: { target: string; action: string }) => item.target + ':' + item.action), ['sdk:build', 'qt:qmake', 'qt:build']);

    const clearOutput = await captureStdout(() => runRemoteCli(['build-order', 'clear', '--workspace', workspace, '--json']));
    const clearParsed = JSON.parse(clearOutput);
    assert.equal(clearParsed.ok, true);
    assert.deepEqual(loadRemoteSettings(workspace).buildOrder, []);
});

test('executeRemoteTransfer copies configured artifacts from build host to deploy host', async () => {
    const commands: string[] = [];
    const result = await executeRemoteTransfer({
        remotePath: '/remote/ws',
        transfer: {
            deployServer: 'deploy-1',
            deployPath: '/opt/app',
            artifacts: ['qt-app/build/app', 'qt-app/conf/app.ini']
        },
        deployServer: {
            ...testServer(),
            id: 'deploy-1',
            name: 'deploy-01',
            host: '10.0.0.8',
            port: 2222,
            username: 'deploy'
        },
        runner: {
            async run(command: string) {
                commands.push(command);
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.transferred.length, 2);
    assert.ok(commands[0].includes('ssh'));
    assert.ok(commands[0].includes('mkdir -p'));
    assert.ok(commands.some(command => command.includes('scp') && command.includes('/remote/ws/qt-app/build/app') && command.includes('deploy@10.0.0.8:/opt/app/app')));
    assert.ok(commands.some(command => command.includes('-P') && command.includes('2222')));
});

test('remote CLI manages transfer settings in user remote settings', async () => {
    const workspace = tmpDir('compilot-remote-transfer-settings-');
    const setOutput = await captureStdout(() => runRemoteCli(['transfer', 'set', '--server', 'deploy-1', '--path', '/opt/app', '--artifact', 'qt-app/build/app', '--artifact', 'qt-app/conf/app.ini', '--workspace', workspace, '--json']));
    const setParsed = JSON.parse(setOutput);

    assert.equal(setParsed.ok, true);
    assert.equal(setParsed.action, 'transfer');
    assert.deepEqual(loadRemoteSettings(workspace).transfer, {
        deployServer: 'deploy-1',
        deployPath: '/opt/app',
        artifacts: ['qt-app/build/app', 'qt-app/conf/app.ini']
    });

    const clearOutput = await captureStdout(() => runRemoteCli(['transfer', 'clear', '--workspace', workspace, '--json']));
    const clearParsed = JSON.parse(clearOutput);
    assert.equal(clearParsed.ok, true);
    assert.equal(loadRemoteSettings(workspace).transfer, null);
});

test('remote transfer status validates local plan without SSH', async () => {
    const workspace = tmpDir('compilot-remote-transfer-status-');
    await captureStdout(() => runRemoteCli(['transfer', 'set', '--server', 'missing-deploy', '--path', '/opt/app', '--artifact', 'qt-app/build/app', '--workspace', workspace, '--json']));
    process.exitCode = undefined;

    const output = await captureStdout(() => runRemoteCli(['transfer', 'status', '--workspace', workspace, '--json']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, undefined);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, 'transfer');
    assert.equal(parsed.status.configured, true);
    assert.equal(parsed.status.ready, false);
    assert.equal(parsed.status.deployServer.exists, false);
    assert.ok(parsed.diagnostics.some((item: { message: string }) => /部署服务器不存在/.test(item.message)));
    assert.ok(parsed.nextActions.includes('检查 ~/.compilot/servers.json'));
});

test('remote transfer status reports ready local plan without SSH', async () => {
    const workspace = tmpDir('compilot-remote-transfer-ready-');
    writeServers([
        {
            ...testServer(),
            id: 'build-1',
            name: 'build-01'
        },
        {
            ...testServer(),
            id: 'deploy-1',
            name: 'deploy-01',
            host: '10.0.0.8',
            username: 'deploy'
        }
    ]);
    saveSyncSettings(workspace, { ...DEFAULT_SYNC, enabled: true, selectedServer: 'build-1', remotePaths: { 'build-1': '/remote/ws' } });
    saveRemoteSettings(workspace, {
        remoteCompilotBin: '',
        buildOrder: [],
        transfer: {
            deployServer: 'deploy-1',
            deployPath: '/opt/app',
            artifacts: ['qt-app/build/app']
        }
    });

    const output = await captureStdout(() => runRemoteCli(['transfer', 'status', '--workspace', workspace, '--json']));
    const parsed = JSON.parse(output);

    assert.equal(parsed.status.ready, true);
    assert.equal(parsed.status.deployServer.name, 'deploy-01');
    assert.deepEqual(parsed.status.plan, [{ source: '/remote/ws/qt-app/build/app', destination: '/opt/app/app' }]);
    assert.deepEqual(parsed.diagnostics, []);
});

test('remote cli human status prints actionable local summary', async () => {
    const workspace = tmpDir('compilot-remote-human-status-');
    saveRemoteSettings(workspace, {
        remoteCompilotBin: '/opt/compilot/bin/compilot',
        buildOrder: [{ target: 'qt', action: 'build', args: [] }],
        transfer: {
            deployServer: 'deploy-1',
            deployPath: '/opt/app',
            artifacts: ['qt-app/build/app']
        }
    });

    const output = await captureStdout(() => runRemoteCli(['status', '--workspace', workspace]));

    assert.match(output, /Remote status: blocked/);
    assert.match(output, /remoteCompilotBin: \/opt\/compilot\/bin\/compilot/);
    assert.match(output, /buildOrder: qt:build/);
    assert.match(output, /transfer: deploy-1 -> \/opt\/app \(1 artifact\)/);
    assert.match(output, /next: 配置 sync server 和 remotePath/);
});

test('remote cli help documents remote utility commands', async () => {
    const output = await captureStdout(() => runRemoteCli(['--help']));

    assert.match(output, /compilot remote doctor/);
    assert.match(output, /compilot remote transfer status/);
    assert.match(output, /compilot remote build-order status/);
    assert.match(output, /compilot remote qt clean-untracked/);
});

test('executeRemoteCleanUntracked removes only explicit untracked paths', async () => {
    const commands: string[] = [];
    const result = await executeRemoteCleanUntracked({
        remotePath: '/remote/ws',
        repo: 'qt-app',
        paths: ['tmp/generated.txt'],
        recursive: false,
        runner: {
            async run(command: string) {
                commands.push(command);
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.cleaned, ['tmp/generated.txt']);
    assert.equal(result.recursive, false);
    assert.ok(commands[0].includes("cd '/remote/ws'/'qt-app'"));
    assert.ok(commands[0].includes('ls-files'));
    assert.ok(commands[0].includes('rmSync'));
    assert.ok(commands[0].includes('tmp/generated.txt'));
    assert.doesNotMatch(commands[0], /git clean/);
});

test('remote CLI accepts clean-untracked with explicit repo and paths', async () => {
    const workspace = tmpDir('compilot-remote-clean-untracked-missing-sync-');
    const output = await captureStdout(() => runRemoteCli(['qt', 'clean-untracked', '--repo', 'qt-app', '--workspace', workspace, '--json', '--', 'tmp/generated.txt']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.action, 'cleanUntracked');
    assert.equal(parsed.target, 'qt');
    assert.match(parsed.diagnostics[0].message, /sync 未启用/);
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
