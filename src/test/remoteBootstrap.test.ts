import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addServer } from '../core/serverStore';
import { loadRemoteSettings, saveRemoteSettings } from '../core/settingsIO';
import { executeRemoteBootstrap, findBootstrapArtifact, findPackageRoot, RemoteUploader } from '../remote/core/bootstrap';
import { resolveRemoteConfig, resolveRemoteServer } from '../remote/core/config';
import { RemoteRunner } from '../remote/core/types';

test('remote bootstrap stops before upload when node or npm is unavailable', async () => {
    const commands: string[] = [];
    let uploaded = false;
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('command -v node')) {
                return { exitCode: 1, stdout: '', stderr: 'node: not found' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload() {
            uploaded = true;
        }
    };

    const result = await executeRemoteBootstrap({
        artifact: {
            ok: true,
            version: '0.1.0',
            artifactPath: '/tmp/forja-cli-0.1.0.tgz',
            sha256: 'abc',
            diagnostics: []
        },
        runner,
        uploader
    });

    assert.equal(result.ok, false);
    assert.equal(uploaded, false);
    assert.equal(commands.length, 1);
    assert.equal(result.stages[0].name, 'preflight');
    assert.match(result.diagnostics.map(item => item.message).join('\n'), /node.*npm|npm.*node/);
    assert.ok(!!result.nextAction);
});

test('remote bootstrap installs the CLI in the standard user prefix and verifies it outside the install directory', async () => {
    const commands: string[] = [];
    const uploads: string[] = [];
    const version = '0.1.0';
    const runner: RemoteRunner = {
        async run(command: string) {
            commands.push(command);
            if (command.includes('$HOME/.local/bin/forja --version') || command.includes('command -v forja')) {
                return { exitCode: 0, stdout: version + '\n', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };
    const uploader: RemoteUploader = {
        async upload(_localPath, remotePath) {
            uploads.push(remotePath);
        }
    };

    const result = await executeRemoteBootstrap({
        artifact: {
            ok: true,
            version,
            artifactPath: '/tmp/forja-cli-0.1.0.tgz',
            sha256: 'abc',
            diagnostics: []
        },
        runner,
        uploader
    });

    assert.equal(result.ok, true);
    assert.equal(result.remoteBin, '$HOME/.local/bin/forja');
    assert.deepEqual(uploads, ['.forja/bootstrap/forja-cli-0.1.0.tgz']);
    assert.ok(commands.some(command => command.includes('npm install -g --prefix $HOME/.local ')));
    assert.ok(commands.some(command => command === 'cd /tmp && $HOME/.local/bin/forja --version'));
    assert.ok(commands.some(command => command === 'rm -f $HOME/.forja/bin/forja'));
    assert.ok(commands.some(command => command === 'cd /tmp && command -v forja >/dev/null 2>&1 && forja --version'));
    assert.equal(commands.some(command => command.includes('.forja/runtime')), false);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.nextAction, undefined);
});

test('remote bootstrap reports how to enable the user bin directory when it is absent from PATH', async () => {
    const version = '0.1.0';
    const runner: RemoteRunner = {
        async run(command: string) {
            if (command.includes('command -v forja')) {
                return { exitCode: 1, stdout: '', stderr: '' };
            }
            if (command.includes('$HOME/.local/bin/forja --version')) {
                return { exitCode: 0, stdout: version + '\n', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
        }
    };

    const result = await executeRemoteBootstrap({
        artifact: {
            ok: true,
            version,
            artifactPath: '/tmp/forja-cli-0.1.0.tgz',
            sha256: 'abc',
            diagnostics: []
        },
        runner,
        uploader: { async upload() {} }
    });

    assert.equal(result.ok, true);
    assert.match(result.diagnostics[0]?.message || '', /\.local\/bin.*PATH/);
    assert.match(result.nextAction || '', /\.local\/bin.*PATH/);
    assert.equal(result.stages.find(stage => stage.name === 'verifyPath')?.ok, false);
});

test('remote bootstrap server resolution does not require a project remote path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bootstrap-server-'));
    const oldConfigDir = process.env.FORJA_CONFIG_DIR;
    process.env.FORJA_CONFIG_DIR = path.join(root, 'config');
    try {
        const workspace = path.join(root, 'workspace');
        fs.mkdirSync(workspace);
        const server = addServer({
            name: 'bootstrap-only',
            host: '127.0.0.1',
            port: 22,
            username: 'dev',
            authMode: 'key',
            privateKeyPath: 'id_rsa',
            password: '',
        });
        const settings = loadRemoteSettings(workspace);
        settings.selectedServer = server.id;
        saveRemoteSettings(workspace, settings);

        const bootstrapServer = resolveRemoteServer(workspace);
        assert.equal(bootstrapServer.server?.id, server.id);
        assert.equal(bootstrapServer.diagnostics.length, 0);

        const projectRemote = resolveRemoteConfig(workspace);
        assert.equal(projectRemote.config, undefined);
        assert.match(projectRemote.diagnostics[0].message, /remotePath not configured/);
    } finally {
        if (oldConfigDir === undefined) {
            delete process.env.FORJA_CONFIG_DIR;
        } else {
            process.env.FORJA_CONFIG_DIR = oldConfigDir;
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('bootstrap artifact resolves nearest package from nested standalone cli files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bootstrap-root-'));
    try {
        const packageRoot = path.join(root, 'node_modules', 'forja');
        const nestedCliDir = path.join(packageRoot, 'remote', 'cli');
        fs.mkdirSync(nestedCliDir, { recursive: true });
        fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"forja","version":"0.1.0","bin":{"forja":"./cli/index.js"},"files":["cli/**","package.json"]}\n');
        fs.mkdirSync(path.join(packageRoot, 'cli'), { recursive: true });
        fs.writeFileSync(path.join(packageRoot, 'cli', 'index.js'), '#!/usr/bin/env node\nconsole.log("0.1.0");\n');

        assert.equal(findPackageRoot(nestedCliDir), packageRoot);
        const artifact = findBootstrapArtifact(nestedCliDir);
        assert.equal(artifact.ok, true);
        assert.equal(artifact.version, '0.1.0');
        assert.ok(artifact.artifactPath?.endsWith('.tgz'));
        assert.equal(fs.existsSync(artifact.artifactPath || ''), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('bootstrap artifact packs the currently compiled local CLI', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bootstrap-compiled-'));
    const version = `0.1.0-compiled.${Date.now()}`;
    const packageVersion = `0.1.0-extension.${Date.now()}`;
    try {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
            name: 'forja',
            version: packageVersion,
            bin: { forja: './out/cli/index.js' }
        }));
        fs.mkdirSync(path.join(root, 'out', 'cli'), { recursive: true });
        fs.writeFileSync(path.join(root, 'out', 'cli', 'index.js'), '#!/usr/bin/env node\nconsole.log("compiled");\n');
        fs.writeFileSync(path.join(root, 'out', 'version.js'), `exports.VERSION = "${version}";\n`);

        const artifact = findBootstrapArtifact(root);

        assert.equal(artifact.ok, true);
        assert.equal(artifact.version, version);
        assert.ok(artifact.artifactPath?.endsWith('.tgz'));
        assert.equal(fs.existsSync(artifact.artifactPath || ''), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
