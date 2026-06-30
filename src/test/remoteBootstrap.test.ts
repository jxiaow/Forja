import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeRemoteBootstrap, findBootstrapArtifact, findPackageRoot, RemoteUploader } from '../remote/core/bootstrap';
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
