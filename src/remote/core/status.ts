import { loadRemoteSettings, RemoteSettings } from '../../core/settingsIO';
import { buildRemoteBaselineStatus, GitRunner, inspectLocalRepositories, inspectRemoteRepositories } from './baseline';
import { BootstrapArtifactResult, executeRemoteBootstrap, RemoteUploader } from './bootstrap';
import { VERSION } from '../../version';
import { resolveRemoteConfig } from './config';
import { executeRemoteReadLock } from './lock';
import { planRemoteRepositories, RemoteRepoMapping } from './repoStrategy';
import { createSshRunner, remoteCommand } from './shell';
import { RemoteConfig, RemoteLayer, RemoteRunner, RemoteStage, RemoteStatusResult, RemoteTestResult } from './types';

export interface BuildRemoteStatusOptions {
    workspace: string;
    probe?: boolean;
    runner?: RemoteRunner;
    config?: RemoteConfig;
    remoteForjaBin?: string;
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
    const localRemoteSettings = loadRemoteSettings(options.workspace);
    const remoteSettingsSummary = summarizeRemoteSettings(localRemoteSettings);
    const resolved = options.config
        ? {
            config: options.config,
            layer: { name: 'syncConfig' as const, ok: true, message: 'ready' },
            diagnostics: []
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
            remoteSettings: remoteSettingsSummary,
            diagnostics: resolved.diagnostics,
            nextAction: resolved.nextAction
        };
    }

    const stagedMode = localRemoteSettings.workspaceMode === 'staged' && !!localRemoteSettings.remoteWorkspace;
    const { server } = resolved.config;
    const remotePath = stagedMode ? localRemoteSettings.remoteWorkspace : resolved.config.remotePath;
    const probe = options.probe ?? true;
    if (!probe) {
        layers.push(
            { name: 'ssh', ok: null, message: 'not probed' },
            { name: 'remotePlatform', ok: null, message: 'not probed' },
            { name: 'remotePath', ok: true, message: 'configured' },
            { name: 'remoteForja', ok: null, message: 'not probed' }
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
            remoteSettings: remoteSettingsSummary,
            diagnostics: []
        };
    }

    const runner = options.runner || createSshRunner(server, server.password || process.env.FORJA_SSH_PASSWORD || null);
    const diagnostics = [...resolved.diagnostics];

    const ping = await runner.run('printf forja-remote-ok', 10000);
    layers.push({ name: 'ssh', ok: ping.exitCode === 0 && ping.stdout.includes('forja-remote-ok'), message: ping.exitCode === 0 ? 'connected' : trimMessage(ping.stderr) });
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

    const remoteSettings = options.remoteForjaBin === undefined ? localRemoteSettings : undefined;
    const remoteForjaBin = options.remoteForjaBin ?? remoteSettings?.remoteForjaBin ?? '';
    const versionResult = await runner.run(buildRemoteForjaVersionCommand(remoteForjaBin), 10000);
    const remoteVersion = versionResult.stdout.trim();
    const baseVersion = (v: string) => v.match(/^\d+\.\d+\.\d+/)?.[0] ?? v;
    const versionOk = versionResult.exitCode === 0 && baseVersion(remoteVersion) === baseVersion(VERSION);
    layers.push({
        name: 'remoteForja',
        ok: versionOk,
        version: remoteVersion || undefined,
        message: versionOk ? 'compatible' : 'remote forja missing or incompatible',
        nextAction: versionOk ? undefined : 'forja doctor fix --remote'
    });
    if (!versionOk) {
        diagnostics.push({ level: stagedMode ? 'warning' : 'error', message: 'remote forja 未安装或版本不兼容' });
        if (!stagedMode) {
            return finishBlocked(options.workspace, server.name || server.id, remotePath, layers, diagnostics, 'remoteForja', 'forja doctor fix --remote');
        }
    }

    let lock = { locked: false } as RemoteStatusResult['lock'];
    if (options.lock !== false) {
        const lockStatus = await executeRemoteReadLock({ remotePath, runner });
        lock = lockStatus.lock;
        diagnostics.push(...lockStatus.diagnostics);
        layers.push({ name: 'targetLock', ok: lockStatus.ok && !lockStatus.lock.locked, message: lockStatus.lock.locked ? 'locked' : lockStatus.ok ? 'unlocked' : 'unknown', nextAction: lockStatus.lock.locked && lockStatus.lock.lockId ? 'forja doctor fix --remote' : undefined });
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
                remoteSettings: remoteSettingsSummary,
                diagnostics,
                nextAction: lockStatus.lock.lockId ? 'forja doctor fix --remote' : undefined
            };
        }
    }

    if (options.baseline !== false && stagedMode) {
        const planStatus = await buildStagedRemotePlanStatus({
            workspace: resolved.config.workspace,
            stagedWorkspace: remotePath,
            settings: localRemoteSettings,
            runner,
            git: options.git
        });
        layers.push(
            { name: 'repoDiscovery', ok: planStatus.localRepoCount > 0, message: planStatus.localRepoCount > 0 ? planStatus.localRepoNames.join(', ') : 'no local git repos' },
            { name: 'baselinePlan', ok: planStatus.plan.ok, message: planStatus.plan.ok ? 'ready' : 'blocked' }
        );
        diagnostics.push(...planStatus.diagnostics);
        const overall = planStatus.plan.ok ? versionOk ? 'ready' : 'degraded' : 'blocked';
        return {
            ok: true,
            action: 'status',
            mode: 'remote',
            overall,
            workspace: resolved.config.workspace,
            server: server.name || server.id,
            remotePath,
            layers,
            lock,
            remoteSettings: remoteSettingsSummary,
            repos: planStatus.remoteRepos,
            remotePlan: {
                workspaceMode: 'staged',
                stagedWorkspace: remotePath,
                repos: planStatus.plan.repos
            },
            diagnostics,
            nextAction: !versionOk ? 'forja doctor fix --remote' : planStatus.plan.nextAction
        };
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
            remoteSettings: remoteSettingsSummary,
            repos: baseline.repos,
            diagnostics,
            nextAction: baseline.nextAction
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
        remoteSettings: remoteSettingsSummary,
        diagnostics
    };
}

export async function buildRemoteTest(options: BuildRemoteTestOptions): Promise<RemoteTestResult> {
    const status = await buildRemoteStatus({ ...options, probe: options.probe ?? true, baseline: false, lock: false });
    const failed = status.layers.find(layer => layer.ok === false);
    if (failed?.name === 'remoteForja' && status.remoteSettings?.workspaceMode === 'staged') {
        return testResult(true, undefined, status.diagnostics, status.nextAction);
    }
    if (!failed || !options.bootstrap || failed.name !== 'remoteForja') {
        return testResult(!failed, failed, status.diagnostics, failed?.nextAction || status.nextAction);
    }

    if (!options.artifact || !options.uploader || !options.runner) {
        return testResult(false, failed, [
            ...status.diagnostics,
            { level: 'error', message: 'remote test --bootstrap 需要 bootstrap artifact 和远端上传通道' }
        ], options.artifact?.nextAction || 'npm run package:all');
    }

    const bootstrap = await executeRemoteBootstrap({ artifact: options.artifact, runner: options.runner, uploader: options.uploader });
    const stages: RemoteStage[] = [
        { stage: 'bootstrap', ok: bootstrap.ok, message: bootstrap.stages.filter(stage => !stage.ok).map(stage => stage.message).find(Boolean) }
    ];
    if (!bootstrap.ok) {
        return testResult(false, failed, [...status.diagnostics, ...bootstrap.diagnostics], bootstrap.nextAction, stages);
    }

    const retest = await buildRemoteStatus({ ...options, probe: true, baseline: false, lock: false });
    const retestFailed = retest.layers.find(layer => layer.ok === false);
    stages.push({ stage: 'remoteForja', ok: !retestFailed || retestFailed.name !== 'remoteForja', message: retestFailed?.message });
    return testResult(!retestFailed, retestFailed, retest.diagnostics, retestFailed?.nextAction || retest.nextAction, stages);
}

function testResult(
    ok: boolean,
    failed: RemoteLayer | undefined,
    diagnostics: RemoteTestResult['diagnostics'],
    nextAction?: string,
    stages?: RemoteStage[]
): RemoteTestResult {
    return {
        ok,
        action: 'test',
        mode: 'remote',
        failedLayer: failed?.name,
        diagnostics,
        nextAction,
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
    nextAction?: string
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
        remoteSettings: summarizeRemoteSettings(loadRemoteSettings(workspace)),
        diagnostics,
        nextAction: nextAction || layer?.nextAction
    };
}

function summarizeRemoteSettings(settings: RemoteSettings): NonNullable<RemoteStatusResult['remoteSettings']> {
    return {
        remoteForjaBin: settings.remoteForjaBin,
        workspaceMode: settings.workspaceMode,
        profile: settings.profile,
        remoteWorkspace: settings.remoteWorkspace,
        repoCount: settings.repos.length,
        buildOrder: {
            configured: settings.buildOrder.length > 0,
            count: settings.buildOrder.length,
            items: settings.buildOrder.map(item => `${item.target}:${item.action}`)
        },
        transfer: {
            configured: settings.transfer !== null,
            deployServer: settings.transfer?.deployServer ?? null,
            deployPath: settings.transfer?.deployPath ?? null,
            artifactCount: settings.transfer?.artifacts.length ?? 0
        }
    };
}

async function buildStagedRemotePlanStatus(options: {
    workspace: string;
    stagedWorkspace: string;
    settings: RemoteSettings;
    runner: RemoteRunner;
    git?: GitRunner;
}): Promise<{
    localRepoCount: number;
    localRepoNames: string[];
    remoteRepos: Awaited<ReturnType<typeof inspectRemoteRepositories>>['repos'];
    plan: ReturnType<typeof planRemoteRepositories>;
    diagnostics: RemoteStatusResult['diagnostics'];
}> {
    const local = await inspectLocalRepositories({ workspace: options.workspace, git: options.git, allowUnpushed: true });
    if (local.repos.length === 0) {
        const emptyPlan = planRemoteRepositories({
            stagedWorkspace: options.stagedWorkspace,
            localRepos: [],
            remoteRepos: [],
            mappings: toRemoteRepoMappings(options.settings.repos)
        });
        return {
            localRepoCount: 0,
            localRepoNames: [],
            remoteRepos: [],
            plan: emptyPlan,
            diagnostics: [...local.diagnostics, ...emptyPlan.diagnostics]
        };
    }

    const remoteProbeNames = unique([
        ...local.repos.map(repo => repo.name),
        ...options.settings.repos.map(repo => repo.remoteName)
    ]);
    const remote = await inspectRemoteRepositories({
        remotePath: options.stagedWorkspace,
        repos: remoteProbeNames.map(name => ({ name })),
        runner: options.runner
    });
    const plan = planRemoteRepositories({
        stagedWorkspace: options.stagedWorkspace,
        localRepos: local.repos,
        remoteRepos: remote.repos,
        mappings: toRemoteRepoMappings(options.settings.repos)
    });

    return {
        localRepoCount: local.repos.length,
        localRepoNames: local.repos.map(repo => repo.name),
        remoteRepos: remote.repos,
        plan,
        diagnostics: [
            ...local.diagnostics,
            ...remote.diagnostics.filter(item => !/远端仓库不存在/.test(item.message)),
            ...plan.diagnostics
        ]
    };
}

function toRemoteRepoMappings(repos: RemoteSettings['repos']): RemoteRepoMapping[] {
    return repos.map(repo => ({
        localName: repo.localName,
        remoteName: repo.remoteName,
        role: repo.role,
        remotePath: repo.remotePath,
        baseline: repo.baseline,
        overlay: repo.overlay,
        mount: repo.mount
    }));
}

function buildRemoteForjaVersionCommand(remoteForjaBin: string): string {
    if (remoteForjaBin) {
        return `${remoteCommand([remoteForjaBin])} --version`;
    }
    return 'forja --version';
}

function trimMessage(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values));
}
