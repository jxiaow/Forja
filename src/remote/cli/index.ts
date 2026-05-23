import * as path from 'path';
import { executeRemoteBootstrap, findBootstrapArtifact } from '../core/bootstrap';
import { executeRemoteBridge, RemoteBridgeAction, RemoteBridgeTarget } from '../core/bridge';
import { resolveRemoteConfig } from '../core/config';
import { executeRemoteUnlock } from '../core/lock';
import { executeRemoteRestore } from '../core/restore';
import { createScpUploader, createSshRunner } from '../core/shell';
import { buildRemoteStatus, buildRemoteTest } from '../core/status';
import { RemoteDiagnostic } from '../core/types';

interface RemoteCliOptions {
    action: 'test' | 'status' | 'bootstrap' | 'unlock' | 'bridge' | 'restore';
    workspace: string;
    json: boolean;
    bootstrap: boolean;
    lockId: string;
    force: boolean;
    target?: RemoteBridgeTarget;
    remoteAction?: RemoteBridgeAction;
    passthrough: string[];
    repo: string;
}

export async function runRemoteCli(argv: string[]): Promise<void> {
    const wantsJson = argv.includes('--json');
    try {
        const options = parseRemoteArgs(argv);
        if (options.action === 'status') {
            const result = await buildRemoteStatus({ workspace: options.workspace });
            writeOutput(result, options.json);
            return;
        }
        if (options.action === 'test') {
            if (!options.bootstrap) {
                const result = await buildRemoteTest({ workspace: options.workspace });
                if (!result.ok) { process.exitCode = 1; }
                writeOutput(result, options.json);
                return;
            }
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                const result = await buildRemoteTest({ workspace: options.workspace, bootstrap: true });
                if (!result.ok) { process.exitCode = 1; }
                writeOutput(result, options.json);
                return;
            }
            const artifact = findBootstrapArtifact(process.cwd());
            const password = resolved.config.server.password || process.env.COMPILOT_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.config.server, password);
            const uploader = createScpUploader(resolved.config.server, password);
            const result = await buildRemoteTest({ workspace: options.workspace, bootstrap: true, artifact, config: resolved.config, runner, uploader });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput(result, options.json);
            return;
        }
        if (options.action === 'bootstrap') {
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                process.exitCode = 1;
                writeOutput(blockedResult('bootstrap', resolved.diagnostics, resolved.nextActions), options.json);
                return;
            }
            const artifact = findBootstrapArtifact(process.cwd());
            if (!artifact.ok) {
                process.exitCode = 1;
                writeOutput({ action: 'bootstrap', mode: 'remote', remoteBin: '$HOME/.compilot/bin/compilot', ...artifact }, options.json);
                return;
            }
            const password = resolved.config.server.password || process.env.COMPILOT_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.config.server, password);
            const uploader = createScpUploader(resolved.config.server, password);
            const result = await executeRemoteBootstrap({ artifact, runner, uploader });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput(result, options.json);
            return;
        }
        if (options.action === 'bridge') {
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                process.exitCode = 1;
                writeOutput(blockedResult('bridge', resolved.diagnostics, resolved.nextActions), options.json);
                return;
            }
            const runner = createSshRunner(resolved.config.server, resolved.config.server.password || process.env.COMPILOT_SSH_PASSWORD || null);
            const preflight = await buildRemoteTest({ workspace: options.workspace, config: resolved.config, runner });
            if (!preflight.ok) {
                process.exitCode = 1;
                writeOutput({ ...preflight, action: 'bridge', target: options.target, remoteAction: options.remoteAction }, options.json);
                return;
            }
            const result = await executeRemoteBridge({
                target: options.target!,
                action: options.remoteAction!,
                args: options.passthrough,
                json: options.json,
                remotePath: resolved.config.remotePath,
                runner
            });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput(result, options.json);
            return;
        }

        if (options.action === 'restore') {
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                process.exitCode = 1;
                writeOutput(blockedResult('restore', resolved.diagnostics, resolved.nextActions), options.json);
                return;
            }
            const runner = createSshRunner(resolved.config.server, resolved.config.server.password || process.env.COMPILOT_SSH_PASSWORD || null);
            const preflight = await buildRemoteTest({ workspace: options.workspace, config: resolved.config, runner });
            if (!preflight.ok) {
                process.exitCode = 1;
                writeOutput({ ...preflight, action: 'restore', target: options.target }, options.json);
                return;
            }
            const result = await executeRemoteRestore({ remotePath: resolved.config.remotePath, repo: options.repo, paths: options.passthrough, runner });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput(result, options.json);
            return;
        }

        const resolved = resolveRemoteConfig(options.workspace);
        if (!resolved.config) {
            process.exitCode = 1;
            writeOutput(blockedResult('unlock', resolved.diagnostics, resolved.nextActions), options.json);
            return;
        }
        const runner = createSshRunner(resolved.config.server, resolved.config.server.password || process.env.COMPILOT_SSH_PASSWORD || null);
        const result = await executeRemoteUnlock({ remotePath: resolved.config.remotePath, lockId: options.lockId, force: options.force, runner });
        if (!result.ok) { process.exitCode = 1; }
        writeOutput(result, options.json);
    } catch (error) {
        process.exitCode = 1;
        const message = error instanceof Error ? error.message : String(error);
        if (wantsJson) {
            console.log(JSON.stringify({ ok: false, diagnostics: [{ level: 'error', message }] }, null, 2));
        } else {
            console.error(message);
        }
    }
}

function parseRemoteArgs(argv: string[]): RemoteCliOptions {
    const first = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'status';
    const options: RemoteCliOptions = {
        action: 'status',
        workspace: process.cwd(),
        json: false,
        bootstrap: false,
        lockId: '',
        force: false,
        passthrough: [],
        repo: ''
    };

    let start = first === argv[0] ? 1 : 0;
    if (first === 'qt' || first === 'sdk') {
        const remoteAction = argv[1];
        if (remoteAction === 'restore') {
            options.action = 'restore';
            options.target = first;
            start = 2;
        } else {
            if (remoteAction !== 'status' && remoteAction !== 'init' && remoteAction !== 'use') {
                throw new Error('remote ' + first + ' 仅支持 status/init/use/restore');
            }
            options.action = 'bridge';
            options.target = first;
            options.remoteAction = remoteAction;
            start = 2;
        }
    } else {
        if (first !== 'test' && first !== 'status' && first !== 'bootstrap' && first !== 'unlock') {
            throw new Error('未知 remote 命令: ' + first);
        }
        options.action = first;
    }

    for (let i = start; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--workspace': {
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--workspace 需要一个值'); }
                options.workspace = path.resolve(value);
                i++;
                break;
            }
            case '--json':
                options.json = true;
                break;
            case '--':
                if (options.action === 'bridge' || options.action === 'restore') {
                    options.passthrough.push(...argv.slice(i + 1));
                    i = argv.length;
                    break;
                }
                throw new Error('未知参数: --');
            case '--bootstrap':
                if (options.action !== 'test') { throw new Error('--bootstrap 只能用于 remote test'); }
                options.bootstrap = true;
                break;
            case '--repo': {
                if (options.action !== 'restore') { throw new Error('--repo 只能用于 remote restore'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--repo 需要一个值'); }
                options.repo = value;
                i++;
                break;
            }
            case '--lock-id': {
                if (options.action !== 'unlock') { throw new Error('--lock-id 只能用于 remote unlock'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--lock-id 需要一个值'); }
                options.lockId = value;
                i++;
                break;
            }
            case '--force':
                if (options.action !== 'unlock') { throw new Error('--force 只能用于 remote unlock'); }
                options.force = true;
                break;
            default:
                if (options.action === 'bridge') {
                    options.passthrough.push(arg);
                    break;
                }
                throw new Error('未知参数: ' + arg);
        }
    }
    if (options.action === 'restore') {
        if (!options.repo) { throw new Error('remote restore 需要 --repo <repo>'); }
        if (options.passthrough.length === 0) { throw new Error('remote restore 需要 -- 后跟至少一个路径'); }
    }
    return options;
}

function blockedResult(action: 'bootstrap' | 'unlock' | 'bridge' | 'restore', diagnostics: RemoteDiagnostic[], nextActions: string[]): unknown {
    return { ok: false, action, mode: 'remote', diagnostics, nextActions };
}

function writeOutput(result: unknown, json: boolean): void {
    if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    const out = result as { ok?: boolean; action?: string; overall?: string; stdout?: string; diagnostics?: Array<{ message: string }> };
    if (out.action === 'status') {
        console.log('Remote status: ' + (out.overall || 'unknown'));
        return;
    }
    if (out.action === 'bridge' && out.stdout) {
        console.log(out.stdout.trim());
        return;
    }
    if (out.ok === false && out.diagnostics && out.diagnostics.length > 0) {
        console.log(out.diagnostics.map(item => item.message).join('\\n'));
        return;
    }
    console.log('Remote ' + (out.action || 'command') + ': ' + (out.ok === false ? 'failed' : 'ok'));
}
