import { loadRemoteSettings } from '../../core/settingsIO';
import { buildRemoteBaselineStatus, GitRunner } from './baseline';
import { BootstrapArtifactResult, executeRemoteBootstrap, RemoteUploader } from './bootstrap';
import { VERSION } from '../../version';
import { resolveRemoteConfig } from './config';
import { executeRemoteReadLock } from './lock';
import { createSshRunner, remoteCommand } from './shell';
import { RemoteConfig, RemoteLayer, RemoteRunner, RemoteStage, RemoteStatusResult, RemoteTestResult } from './types';

export interface BuildRemoteStatusOptions {
    workspace: string;
    probe?: boolean;
    runner?: RemoteRunner;
    config?: RemoteConfig;
    remoteCompilotBin?: string;
    git?: GitRunner;
    baseline?: boolean;
    lock?: boolean;
}

export interface BuildRemoteTestOptions extends BuildRemoteStatusOptions {
    bootstrap?: boolean;
    artifact?: BootstrapArtifactResult;
    uploader?: RemoteUploader;
}

export async function buildRemoteStatus(options: BuildRemoteStatusOptions): Promise<RemoteStatusResult> {
    const resolved = options.config
        ? {
            config: options.config,
            layer: { name: 'syncConfig' as const, ok: true, message: 'ready' },
            diagnostics: [],
            nextActions: []
        }
        : resolveRemoteConfig(options.workspace);
    const layers: RemoteLayer[] = [resolved.layer];
    if (!resolved.config) {
        return {
            ok: true,
            action: 'status',
            mode: 'remote',
            overall: 'blocked',
            workspace: options.workspace,
            layers,
            diagnostics: resolved.diagnostics,
            nextActions: resolved.nextActions
        };
    }

    const { server, remotePath } = resolved.config;
    const probe = options.probe ?? true;
    if (!probe) {
        layers.push(
            { name: 'ssh', ok: null, message: 'not probed' },
            { name: 'remotePlatform', ok: null, message: 'not probed' },
            { name: 'remotePath', ok: true, message: 'configured' },
            { name: 'remoteCompilot', ok: null, message: 'not probed' }
        );
        return {
            ok: true,
            action: 'status',
            mode: 'remote',
            overall: 'unknown',
            workspace: resolved.config.workspace,
            server: server.name || server.id,
            remotePath,
            layers,
            lock: { locked: false },
            diagnostics: [],
            nextActions: []
        };
    }

    const runner = options.runner || createSshRunner(server, server.password || process.env.COMPILOT_SSH_PASSWORD || null);
    const diagnostics = [...resolved.diagnostics];

    const ping = await runner.run('printf compilot-remote-ok', 10000);
    layers.push({ name: 'ssh', ok: ping.exitCode === 0 && ping.stdout.includes('compilot-remote-ok'), message: ping.exitCode === 0 ? 'connected' : trimMessage(ping.stderr) });
    if (ping.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trimMessage(ping.stderr) || 'SSH 连接失败' });
        return finishBlocked(options.workspace, server.name || server.id, remotePath, layers, diagnostics, 'ssh');
    }

    const platform = await runner.run('uname -s', 10000);
    const platformText = platform.stdout.trim();
    const platformOk = platform.exitCode === 0 && platformText.length > 0 && !platformText.toLowerCase().includes('mingw') && !platformText.toLowerCase().includes('windows');
    layers.push({ name: 'remotePlatform', ok: platformOk, message: platformOk ? platformText : 'unsupported remote platform' });
    if (!platformOk) {
        diagnostics.push({ level: 'error', message: '第一版 remote 只支持 POSIX-compatible shell' });
        return finishBlocked(options.workspace, server.name || server.id, remotePath, layers, diagnostics, 'remotePlatform');
    }

    const pathCommand = `mkdir -p ${remoteCommand([remotePath])} && cd ${remoteCommand([remotePath])} && pwd -P`;
    const pathResult = await runner.run(pathCommand, 10000);
    layers.push({ name: 'remotePath', ok: pathResult.exitCode === 0, message: pathResult.exitCode === 0 ? pathResult.stdout.trim() : trimMessage(pathResult.stderr) });
    if (pathResult.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trimMessage(pathResult.stderr) || 'remotePath 不可用' });
        return finishBlocked(options.workspace, server.name || server.id, remotePath, layers, diagnostics, 'remotePath');
    }

    const remoteSettings = options.remoteCompilotBin === undefined ? loadRemoteSettings(resolved.config.workspace) : undefined;
    const remoteCompilotBin = options.remoteCompilotBin ?? remoteSettings?.remoteCompilotBin ?? '';
    const versionResult = await runner.run(buildRemoteCompilotVersionCommand(remoteCompilotBin), 10000);
    const remoteVersion = versionResult.stdout.trim();
    const versionOk = versionResult.exitCode === 0 && remoteVersion === VERSION;
    layers.push({
        name: 'remoteCompilot',
        ok: versionOk,
        version: remoteVersion || undefined,
        message: versionOk ? 'compatible' : 'remote compilot missing or incompatible',
        nextActions: versionOk ? undefined : ['compilot remote bootstrap']
    });
    if (!versionOk) {
        diagnostics.push({ level: 'error', message: 'remote compilot 未安装或版本不兼容' });
        return finishBlocked(options.workspace, server.name || server.id, remotePath, layers, diagnostics, 'remoteCompilot', ['compilot remote bootstrap']);
    }

    let lock = { locked: false } as RemoteStatusResult['lock'];
    if (options.lock !== false) {
        const lockStatus = await executeRemoteReadLock({ remotePath, runner });
        lock = lockStatus.lock;
        diagnostics.push(...lockStatus.diagnostics);
        layers.push({ name: 'targetLock', ok: lockStatus.ok && !lockStatus.lock.locked, message: lockStatus.lock.locked ? 'locked' : lockStatus.ok ? 'unlocked' : 'unknown', nextActions: lockStatus.lock.locked && lockStatus.lock.lockId ? ['compilot remote unlock --lock-id ' + lockStatus.lock.lockId + ' --force'] : undefined });
        if (lockStatus.lock.locked) {
            return {
                ok: true,
                action: 'status',
                mode: 'remote',
                overall: 'blocked',
                workspace: resolved.config.workspace,
                server: server.name || server.id,
                remotePath,
                layers,
                lock,
                diagnostics,
                nextActions: lockStatus.lock.lockId ? ['compilot remote unlock --lock-id ' + lockStatus.lock.lockId + ' --force'] : []
            };
        }
    }

    if (options.baseline !== false) {
        const baseline = await buildRemoteBaselineStatus({
            workspace: resolved.config.workspace,
            remotePath,
            runner,
            git: options.git
        });
        layers.push(
            { name: 'repoDiscovery', ok: baseline.repos.length > 0, message: baseline.repos.length > 0 ? baseline.repos.map(repo => repo.name).join(', ') : 'no local git repos' },
            { name: 'baselinePrecheck', ok: baseline.ok, message: baseline.overall }
        );
        diagnostics.push(...baseline.diagnostics);
        return {
            ok: true,
            action: 'status',
            mode: 'remote',
            overall: baseline.overall,
            workspace: resolved.config.workspace,
            server: server.name || server.id,
            remotePath,
            layers,
            lock,
            repos: baseline.repos,
            diagnostics,
            nextActions: baseline.nextActions
        };
    }

    return {
        ok: true,
        action: 'status',
        mode: 'remote',
        overall: 'ready',
        workspace: resolved.config.workspace,
        server: server.name || server.id,
        remotePath,
        layers,
        lock,
        diagnostics,
        nextActions: []
    };
}

export async function buildRemoteTest(options: BuildRemoteTestOptions): Promise<RemoteTestResult> {
    const status = await buildRemoteStatus({ ...options, probe: options.probe ?? true, baseline: false, lock: false });
    const failed = status.layers.find(layer => layer.ok === false);
    if (!failed || !options.bootstrap || failed.name !== 'remoteCompilot') {
        return testResult(!failed, failed, status.diagnostics, failed?.nextActions || status.nextActions);
    }

    if (!options.artifact || !options.uploader || !options.runner) {
        return testResult(false, failed, [
            ...status.diagnostics,
            { level: 'error', message: 'remote test --bootstrap 需要 bootstrap artifact 和远端上传通道' }
        ], options.artifact?.nextActions || ['npm run package:all']);
    }

    const bootstrap = await executeRemoteBootstrap({ artifact: options.artifact, runner: options.runner, uploader: options.uploader });
    const stages: RemoteStage[] = [
        { stage: 'bootstrap', ok: bootstrap.ok, message: bootstrap.stages.filter(stage => !stage.ok).map(stage => stage.message).find(Boolean) }
    ];
    if (!bootstrap.ok) {
        return testResult(false, failed, [...status.diagnostics, ...bootstrap.diagnostics], bootstrap.nextActions, stages);
    }

    const retest = await buildRemoteStatus({ ...options, probe: true, baseline: false, lock: false });
    const retestFailed = retest.layers.find(layer => layer.ok === false);
    stages.push({ stage: 'remoteCompilot', ok: !retestFailed || retestFailed.name !== 'remoteCompilot', message: retestFailed?.message });
    return testResult(!retestFailed, retestFailed, retest.diagnostics, retestFailed?.nextActions || retest.nextActions, stages);
}

function testResult(
    ok: boolean,
    failed: RemoteLayer | undefined,
    diagnostics: RemoteTestResult['diagnostics'],
    nextActions: string[],
    stages?: RemoteStage[]
): RemoteTestResult {
    return {
        ok,
        action: 'test',
        mode: 'remote',
        failedLayer: failed?.name,
        diagnostics,
        nextActions,
        stages
    };
}

function finishBlocked(
    workspace: string,
    server: string,
    remotePath: string,
    layers: RemoteLayer[],
    diagnostics: RemoteStatusResult['diagnostics'],
    failedLayer: RemoteLayer['name'],
    nextActions?: string[]
): RemoteStatusResult {
    const layer = layers.find(item => item.name === failedLayer);
    return {
        ok: true,
        action: 'status',
        mode: 'remote',
        overall: 'blocked',
        workspace,
        server,
        remotePath,
        layers,
        lock: { locked: false },
        diagnostics,
        nextActions: nextActions || layer?.nextActions || []
    };
}

function buildRemoteCompilotVersionCommand(remoteCompilotBin: string): string {
    if (remoteCompilotBin) {
        return `${remoteCommand([remoteCompilotBin])} --version`;
    }
    return '$HOME/.compilot/bin/compilot --version';
}

function trimMessage(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
