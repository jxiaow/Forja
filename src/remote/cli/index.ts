import * as path from 'path';
import { getServerById } from '../../core/serverStore';
import { loadRemoteSettings, RemoteBuildOrderItem, RemoteRepoAssetSettings, RemoteRepoSettings, saveRemoteSettings } from '../../core/settingsIO';
import { executeRemoteBootstrap, findBootstrapArtifact, findPackageRoot } from '../core/bootstrap';
import { executeRemoteBridge, RemoteBridgeAction, RemoteBridgeTarget } from '../core/bridge';
import { executeRemoteCleanUntracked } from '../core/cleanUntracked';
import { resolveRemoteActionPath, resolveRemoteConfig, resolveRemotePrimaryActionPath, resolveRemoteServer } from '../core/config';
import { buildRemoteDoctor } from '../core/doctor';
import { executeRemoteUnlock } from '../core/lock';
import { executePreparedRemoteAction } from '../core/pipeline';
import { executeRemoteRestore } from '../core/restore';
import { createScpUploader, createSshRunner } from '../core/shell';
import { validateStagedRepoName } from '../core/stagedWorkspace';
import { buildRemoteStatus, buildRemoteTest } from '../core/status';
import { buildRemoteTransferStatus, executeRemoteTransfer } from '../core/transfer';
import { RemoteDiagnostic } from '../core/types';

interface RemoteCliOptions {
    action: 'test' | 'status' | 'doctor' | 'bootstrap' | 'unlock' | 'bridge' | 'restore' | 'reset' | 'cleanUntracked' | 'preparedAction' | 'buildOrder' | 'transfer' | 'workspaceSettings' | 'repoSettings' | 'forjaBinSettings';
    workspace: string;
    json: boolean;
    bootstrap: boolean;
    buildOrderAction: 'status' | 'set' | 'clear';
    transferAction: 'status' | 'set' | 'clear' | 'run';
    workspaceSettingsAction: 'status' | 'use' | 'clear';
    repoSettingsAction: 'list' | 'set' | 'remove' | 'clear';
    forjaBinSettingsAction: 'status' | 'use' | 'clear';
    workspaceMode: 'legacy' | 'staged';
    profile: string;
    remoteWorkspace: string;
    remoteForjaBinPath: string;
    repoLocalName: string;
    repoRemoteName: string;
    repoRole: RemoteRepoSettings['role'] | '';
    repoRemotePath: string;
    repoBaseline: 'auto' | 'status-only' | '';
    repoOverlay: boolean | null;
    repoMount: 'symlink' | '';
    repoAssets: string[];
    transferServer: string;
    transferPath: string;
    transferArtifacts: string[];
    lockId: string;
    force: boolean;
    recursive: boolean;
    target?: RemoteBridgeTarget;
    remoteAction?: RemoteBridgeAction;
    passthrough: string[];
    repo: string;
}

export async function runRemoteCli(argv: string[]): Promise<void> {
    const wantsJson = argv.includes('--json');
    try {
        if (argv.includes('--help') || argv.includes('-h')) {
            console.log(helpText());
            return;
        }
        const options = parseRemoteArgs(argv);
        if (options.action === 'status') {
            const result = await buildRemoteStatus({ workspace: options.workspace });
            writeOutput(result, options.json);
            return;
        }
        if (options.action === 'doctor') {
            if (!options.bootstrap) {
                const result = await buildRemoteDoctor({ workspace: options.workspace });
                if (!result.ok) { process.exitCode = 1; }
                writeOutput(result, options.json);
                return;
            }
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                const result = await buildRemoteDoctor({ workspace: options.workspace, bootstrap: true });
                if (!result.ok) { process.exitCode = 1; }
                writeOutput(result, options.json);
                return;
            }
            const artifact = findBootstrapArtifact(cliPackageRoot());
            const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.config.server, password);
            const uploader = createScpUploader(resolved.config.server, password);
            const result = await buildRemoteDoctor({ workspace: options.workspace, bootstrap: true, artifact, config: resolved.config, runner, uploader });
            if (!result.ok) { process.exitCode = 1; }
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
            const artifact = findBootstrapArtifact(cliPackageRoot());
            const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.config.server, password);
            const uploader = createScpUploader(resolved.config.server, password);
            const result = await buildRemoteTest({ workspace: options.workspace, bootstrap: true, artifact, config: resolved.config, runner, uploader });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput(result, options.json);
            return;
        }
        if (options.action === 'bootstrap') {
            const resolved = resolveRemoteServer(options.workspace);
            if (!resolved.server) {
                process.exitCode = 1;
                writeOutput(blockedResult('bootstrap', resolved.diagnostics, resolved.nextAction), options.json);
                return;
            }
            const artifact = findBootstrapArtifact(cliPackageRoot());
            if (!artifact.ok) {
                process.exitCode = 1;
                writeOutput({ action: 'bootstrap', mode: 'remote', remoteBin: '$HOME/.forja/bin/forja', ...artifact }, options.json);
                return;
            }
            const password = resolved.server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.server, password);
            const uploader = createScpUploader(resolved.server, password);
            const result = await executeRemoteBootstrap({ artifact, runner, uploader });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput(result, options.json);
            return;
        }
        if (options.action === 'buildOrder') {
            const settings = loadRemoteSettings(options.workspace);
            if (options.buildOrderAction === 'set') {
                settings.buildOrder = parseBuildOrderItems(options.passthrough);
                saveRemoteSettings(options.workspace, settings);
            } else if (options.buildOrderAction === 'clear') {
                settings.buildOrder = [];
                saveRemoteSettings(options.workspace, settings);
            }
            writeOutput({ ok: true, action: 'buildOrder', mode: 'remote', buildOrder: settings.buildOrder, diagnostics: [] }, options.json);
            return;
        }
        if (options.action === 'workspaceSettings') {
            const settings = loadRemoteSettings(options.workspace);
            if (options.workspaceSettingsAction === 'use') {
                settings.workspaceMode = options.workspaceMode;
                settings.profile = options.profile;
                settings.remoteWorkspace = options.remoteWorkspace;
                saveRemoteSettings(options.workspace, settings);
            } else if (options.workspaceSettingsAction === 'clear') {
                settings.workspaceMode = 'legacy';
                settings.profile = '';
                settings.remoteWorkspace = '';
                settings.repos = [];
                saveRemoteSettings(options.workspace, settings);
            }
            writeOutput({ ok: true, action: 'workspace', mode: 'remote', workspaceMode: settings.workspaceMode, profile: settings.profile, remoteWorkspace: settings.remoteWorkspace, repos: settings.repos, diagnostics: [] }, options.json);
            return;
        }
        if (options.action === 'repoSettings') {
            const settings = loadRemoteSettings(options.workspace);
            if (options.repoSettingsAction === 'set') {
                const repo = buildRepoSetting(options);
                settings.repos = [...settings.repos.filter(item => item.localName !== repo.localName), repo];
                saveRemoteSettings(options.workspace, settings);
            } else if (options.repoSettingsAction === 'remove') {
                settings.repos = settings.repos.filter(item => item.localName !== options.repoLocalName);
                saveRemoteSettings(options.workspace, settings);
            } else if (options.repoSettingsAction === 'clear') {
                settings.repos = [];
                saveRemoteSettings(options.workspace, settings);
            }
            writeOutput({ ok: true, action: 'repo', mode: 'remote', repos: settings.repos, diagnostics: [] }, options.json);
            return;
        }
        if (options.action === 'forjaBinSettings') {
            const settings = loadRemoteSettings(options.workspace);
            if (options.forjaBinSettingsAction === 'use') {
                settings.remoteForjaBin = options.remoteForjaBinPath;
                saveRemoteSettings(options.workspace, settings);
            } else if (options.forjaBinSettingsAction === 'clear') {
                settings.remoteForjaBin = '';
                saveRemoteSettings(options.workspace, settings);
            }
            writeOutput({ ok: true, action: 'forjaBin', mode: 'remote', remoteForjaBin: settings.remoteForjaBin, diagnostics: [] }, options.json);
            return;
        }
        if (options.action === 'transfer') {
            const settings = loadRemoteSettings(options.workspace);
            if (options.transferAction === 'set') {
                settings.transfer = {
                    deployServer: options.transferServer,
                    deployPath: options.transferPath,
                    artifacts: options.transferArtifacts
                };
                saveRemoteSettings(options.workspace, settings);
            } else if (options.transferAction === 'clear') {
                settings.transfer = null;
                saveRemoteSettings(options.workspace, settings);
            } else if (options.transferAction === 'run') {
                const transfer = settings.transfer;
                if (!transfer) {
                    process.exitCode = 1;
                    writeOutput({ ok: false, action: 'transfer', mode: 'remote', diagnostics: [{ level: 'error', message: 'remote transfer 尚未配置' }], nextAction: 'forja remote transfer --server <id> --path <deployPath> --artifact <path>' }, options.json);
                    return;
                }
                const resolved = resolveRemoteConfig(options.workspace);
                if (!resolved.config) {
                    process.exitCode = 1;
                    writeOutput({ ...blockedResult('transfer', resolved.diagnostics, resolved.nextAction) }, options.json);
                    return;
                }
                const deployServer = getServerById(transfer.deployServer);
                if (!deployServer) {
                    process.exitCode = 1;
                    writeOutput({ ok: false, action: 'transfer', mode: 'remote', diagnostics: [{ level: 'error', message: '部署服务器不存在: ' + transfer.deployServer }], nextAction: '检查 ~/.forja/servers.json' }, options.json);
                    return;
                }
                const runner = createSshRunner(resolved.config.server, resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null);
                const actionRemotePath = resolveRemotePrimaryActionPath(resolved.config.workspace, resolved.config.remotePath);
                const transferResult = await executeRemoteTransfer({ remotePath: actionRemotePath, transfer, deployServer, runner });
                if (!transferResult.ok) { process.exitCode = 1; }
                writeOutput(transferResult, options.json);
                return;
            }
            const resolved = resolveRemoteConfig(options.workspace);
            const deployServer = settings.transfer ? getServerById(settings.transfer.deployServer) : null;
            const status = buildRemoteTransferStatus({
                remotePath: resolved.config ? resolveRemotePrimaryActionPath(resolved.config.workspace, resolved.config.remotePath) : null,
                transfer: settings.transfer,
                deployServer
            });
            writeOutput({ ok: true, action: 'transfer', mode: 'remote', status, transfer: settings.transfer, diagnostics: [...resolved.diagnostics, ...status.diagnostics], nextAction: resolved.nextAction || status.nextAction }, options.json);
            return;
        }
        if (options.action === 'bridge') {
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                process.exitCode = 1;
                writeOutput({ ...blockedResult('bridge', resolved.diagnostics, resolved.nextAction), target: options.target, remoteAction: options.remoteAction }, options.json);
                return;
            }
            const runner = createSshRunner(resolved.config.server, resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null);
            const preflight = await buildRemoteTest({ workspace: options.workspace, config: resolved.config, runner });
            if (!preflight.ok) {
                process.exitCode = 1;
                writeOutput({ ...preflight, action: 'bridge', target: options.target, remoteAction: options.remoteAction }, options.json);
                return;
            }
            const remoteSettings = loadRemoteSettings(resolved.config.workspace);
            const actionRemotePath = resolveRemotePrimaryActionPath(resolved.config.workspace, resolved.config.remotePath);
            const result = await executeRemoteBridge({
                target: options.target!,
                action: options.remoteAction!,
                args: options.passthrough,
                json: options.json,
                remotePath: actionRemotePath,
                remoteForjaBin: remoteSettings.remoteForjaBin || undefined,
                runner
            });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput(result, options.json);
            return;
        }

        if (options.action === 'preparedAction') {
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                process.exitCode = 1;
                writeOutput({ ...blockedResult('preparedAction', resolved.diagnostics, resolved.nextAction), target: options.target, remoteAction: options.remoteAction }, options.json);
                return;
            }
            const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(resolved.config.server, password);
            const uploader = createScpUploader(resolved.config.server, password);
            const preflight = await buildRemoteTest({ workspace: options.workspace, config: resolved.config, runner });
            if (!preflight.ok) {
                process.exitCode = 1;
                writeOutput({ ...preflight, action: 'preparedAction', target: options.target, remoteAction: options.remoteAction }, options.json);
                return;
            }
            const streamRemoteRun = options.target === 'qt' && options.remoteAction === 'run' && !options.passthrough.includes('--detach') && !options.json;
            const remoteSettings = loadRemoteSettings(resolved.config.workspace);
            const result = await executePreparedRemoteAction({
                workspace: resolved.config.workspace,
                remotePath: resolved.config.remotePath,
                ignore: resolved.config.ignore,
                owner: 'cli',
                target: options.target!,
                action: options.remoteAction!,
                args: options.passthrough,
                json: options.json,
                stream: streamRemoteRun,
                buildOrder: remoteSettings.buildOrder,
                runner,
                uploader
            });
            if (!result.ok) { process.exitCode = 1; }
            if (streamRemoteRun && result.remote) {
                if (!result.ok && result.diagnostics.length > 0) {
                    console.error(result.diagnostics.map(item => item.message).join('\n'));
                }
                return;
            }
            writeOutput(result, options.json);
            return;
        }

        if (options.action === 'restore' || options.action === 'reset' || options.action === 'cleanUntracked') {
            const resolved = resolveRemoteConfig(options.workspace);
            if (!resolved.config) {
                process.exitCode = 1;
                writeOutput({ ...blockedResult(options.action, resolved.diagnostics, resolved.nextAction), target: options.target }, options.json);
                return;
            }
            const runner = createSshRunner(resolved.config.server, resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null);
            const preflight = await buildRemoteTest({ workspace: options.workspace, config: resolved.config, runner });
            if (!preflight.ok) {
                process.exitCode = 1;
                writeOutput({ ...preflight, action: options.action, target: options.target }, options.json);
                return;
            }
            if (options.action === 'cleanUntracked') {
                const actionRemotePath = resolveRemoteActionPath(resolved.config.workspace, resolved.config.remotePath);
                const clean = await executeRemoteCleanUntracked({ remotePath: actionRemotePath, repo: options.repo, paths: options.passthrough, recursive: options.recursive, runner });
                if (!clean.ok) { process.exitCode = 1; }
                writeOutput({ ...clean, target: options.target }, options.json);
                return;
            }
            const actionRemotePath = resolveRemoteActionPath(resolved.config.workspace, resolved.config.remotePath);
            const result = await executeRemoteRestore({ remotePath: actionRemotePath, repo: options.repo, paths: options.passthrough, runner });
            if (!result.ok) { process.exitCode = 1; }
            writeOutput({ ...result, action: options.action }, options.json);
            return;
        }

        const resolved = resolveRemoteConfig(options.workspace);
        if (!resolved.config) {
            process.exitCode = 1;
            writeOutput(blockedResult('unlock', resolved.diagnostics, resolved.nextAction), options.json);
            return;
        }
        const runner = createSshRunner(resolved.config.server, resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null);
        const actionRemotePath = resolveRemoteActionPath(resolved.config.workspace, resolved.config.remotePath);
        const result = await executeRemoteUnlock({ remotePath: actionRemotePath, lockId: options.lockId, force: options.force, runner });
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
        buildOrderAction: 'status',
        transferAction: 'status',
        workspaceSettingsAction: 'status',
        repoSettingsAction: 'list',
        forjaBinSettingsAction: 'status',
        workspaceMode: 'legacy',
        profile: '',
        remoteWorkspace: '',
        remoteForjaBinPath: '',
        repoLocalName: '',
        repoRemoteName: '',
        repoRole: '',
        repoRemotePath: '',
        repoBaseline: '',
        repoOverlay: null,
        repoMount: '',
        repoAssets: [],
        transferServer: '',
        transferPath: '',
        transferArtifacts: [],
        lockId: '',
        force: false,
        recursive: false,
        passthrough: [],
        repo: ''
    };

    let start = first === argv[0] ? 1 : 0;
    if (first === 'qt' || first === 'cpp') {
        const remoteAction = argv[1];
        if (remoteAction === 'restore' || remoteAction === 'reset' || remoteAction === 'clean-untracked') {
            options.action = remoteAction === 'clean-untracked' ? 'cleanUntracked' : remoteAction;
            options.target = first;
            start = 2;
        } else if (isBridgeAction(first, remoteAction)) {
            options.action = 'bridge';
            options.target = first;
            options.remoteAction = remoteAction;
            start = 2;
        } else if (isPreparedAction(first, remoteAction)) {
            options.action = 'preparedAction';
            options.target = first;
            options.remoteAction = remoteAction;
            start = 2;
        } else {
            throw new Error(remoteSupportMessage(first));
        }
    } else {
        if (first === 'build-order') {
            options.action = 'buildOrder';
            const subcommand = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'status';
            if (subcommand !== 'status' && subcommand !== 'set' && subcommand !== 'clear') {
                throw new Error('remote build-order 仅支持 status/set/clear');
            }
            options.buildOrderAction = subcommand;
            start = subcommand === argv[1] ? 2 : 1;
        } else if (first === 'transfer') {
            options.action = 'transfer';
            const subcommand = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'status';
            if (subcommand !== 'status' && subcommand !== 'set' && subcommand !== 'clear' && subcommand !== 'run') {
                throw new Error('remote transfer 仅支持 status/set/clear/run');
            }
            options.transferAction = subcommand;
            start = subcommand === argv[1] ? 2 : 1;
        } else if (first === 'workspace') {
            options.action = 'workspaceSettings';
            const subcommand = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'status';
            if (subcommand !== 'status' && subcommand !== 'use' && subcommand !== 'clear') {
                throw new Error('remote workspace 仅支持 status/use/clear');
            }
            options.workspaceSettingsAction = subcommand;
            start = subcommand === argv[1] ? 2 : 1;
        } else if (first === 'repo') {
            options.action = 'repoSettings';
            const subcommand = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'list';
            if (subcommand !== 'list' && subcommand !== 'set' && subcommand !== 'remove' && subcommand !== 'clear') {
                throw new Error('remote repo 仅支持 list/set/remove/clear');
            }
            options.repoSettingsAction = subcommand;
            start = subcommand === argv[1] ? 2 : 1;
        } else if (first === 'forja-bin') {
            options.action = 'forjaBinSettings';
            const subcommand = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'status';
            if (subcommand !== 'status' && subcommand !== 'use' && subcommand !== 'clear') {
                throw new Error('remote forja-bin 仅支持 status/use/clear');
            }
            options.forjaBinSettingsAction = subcommand;
            start = subcommand === argv[1] ? 2 : 1;
        } else if (first !== 'test' && first !== 'status' && first !== 'doctor' && first !== 'bootstrap' && first !== 'unlock') {
            throw new Error('未知 remote 命令: ' + first);
        } else {
            options.action = first;
        }
    }

    for (let i = start; i < argv.length; i++) {
        const arg = argv[i];
        const targetPassthrough = consumeTargetPassthrough(argv, i, options);
        if (targetPassthrough !== null) {
            i += targetPassthrough;
            continue;
        }
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
                if (options.action === 'bridge' || options.action === 'restore' || options.action === 'reset' || options.action === 'cleanUntracked' || options.action === 'preparedAction') {
                    options.passthrough.push(...argv.slice(i + 1));
                    i = argv.length;
                    break;
                }
                throw new Error('未知参数: --');
            case '--bootstrap':
                if (options.action !== 'test' && options.action !== 'doctor') { throw new Error('--bootstrap 只能用于 remote test/doctor'); }
                options.bootstrap = true;
                break;
            case '--repo': {
                if (options.action !== 'restore' && options.action !== 'reset' && options.action !== 'cleanUntracked') { throw new Error('--repo 只能用于 remote restore/reset/clean-untracked'); }
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
            case '--recursive':
                if (options.action !== 'cleanUntracked') { throw new Error('--recursive 只能用于 remote clean-untracked'); }
                options.recursive = true;
                break;
            case '--server': {
                if (options.action !== 'transfer' || options.transferAction !== 'set') { throw new Error('--server 只能用于 remote transfer set'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--server 需要一个值'); }
                options.transferServer = value;
                i++;
                break;
            }
            case '--path': {
                if (!((options.action === 'transfer' && options.transferAction === 'set') || (options.action === 'workspaceSettings' && options.workspaceSettingsAction === 'use') || (options.action === 'repoSettings' && options.repoSettingsAction === 'set') || (options.action === 'forjaBinSettings' && options.forjaBinSettingsAction === 'use'))) { throw new Error('--path 只能用于 remote transfer set、remote workspace use、remote repo set 或 remote forja-bin use'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--path 需要一个值'); }
                if (options.action === 'transfer') { options.transferPath = value; }
                else if (options.action === 'workspaceSettings') { options.remoteWorkspace = value; }
                else if (options.action === 'forjaBinSettings') { options.remoteForjaBinPath = value; }
                else { options.repoRemotePath = value; }
                i++;
                break;
            }
            case '--mode': {
                if (options.action !== 'workspaceSettings' || options.workspaceSettingsAction !== 'use') { throw new Error('--mode 只能用于 remote workspace use'); }
                const value = argv[i + 1];
                if (value !== 'legacy' && value !== 'staged' && value !== 'managed') { throw new Error('--mode 仅支持 legacy 或 staged'); }
                options.workspaceMode = value === 'managed' ? 'staged' : value;
                i++;
                break;
            }
            case '--profile': {
                if (options.action !== 'workspaceSettings' || options.workspaceSettingsAction !== 'use') { throw new Error('--profile 只能用于 remote workspace use'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--profile 需要一个值'); }
                options.profile = value;
                i++;
                break;
            }
            case '--local': {
                if (options.action !== 'repoSettings' || (options.repoSettingsAction !== 'set' && options.repoSettingsAction !== 'remove')) { throw new Error('--local 只能用于 remote repo set/remove'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--local 需要一个值'); }
                options.repoLocalName = value;
                i++;
                break;
            }
            case '--remote': {
                if (options.action !== 'repoSettings' || options.repoSettingsAction !== 'set') { throw new Error('--remote 只能用于 remote repo set'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--remote 需要一个值'); }
                options.repoRemoteName = value;
                i++;
                break;
            }
            case '--role': {
                if (options.action !== 'repoSettings' || options.repoSettingsAction !== 'set') { throw new Error('--role 只能用于 remote repo set'); }
                const value = argv[i + 1];
                if (!isRemoteRepoRole(value)) { throw new Error('--role 非法: ' + (value || '')); }
                options.repoRole = value;
                i++;
                break;
            }
            case '--baseline': {
                if (options.action !== 'repoSettings' || options.repoSettingsAction !== 'set') { throw new Error('--baseline 只能用于 remote repo set'); }
                const value = argv[i + 1];
                if (value !== 'auto' && value !== 'status-only') { throw new Error('--baseline 仅支持 auto 或 status-only'); }
                options.repoBaseline = value;
                i++;
                break;
            }
            case '--overlay': {
                if (options.action !== 'repoSettings' || options.repoSettingsAction !== 'set') { throw new Error('--overlay 只能用于 remote repo set'); }
                const value = argv[i + 1];
                if (value !== 'true' && value !== 'false') { throw new Error('--overlay 需要 true 或 false'); }
                options.repoOverlay = value === 'true';
                i++;
                break;
            }
            case '--mount': {
                if (options.action !== 'repoSettings' || options.repoSettingsAction !== 'set') { throw new Error('--mount 只能用于 remote repo set'); }
                const value = argv[i + 1];
                if (value !== 'symlink') { throw new Error('--mount 仅支持 symlink'); }
                options.repoMount = value;
                i++;
                break;
            }
            case '--asset': {
                if (options.action !== 'repoSettings' || options.repoSettingsAction !== 'set') { throw new Error('--asset 只能用于 remote repo set'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--asset 需要一个值'); }
                options.repoAssets.push(value);
                i++;
                break;
            }
            case '--artifact': {
                if (options.action !== 'transfer' || options.transferAction !== 'set') { throw new Error('--artifact 只能用于 remote transfer set'); }
                const value = argv[i + 1];
                if (!value || value.startsWith('--')) { throw new Error('--artifact 需要一个值'); }
                options.transferArtifacts.push(value);
                i++;
                break;
            }
            default:
                if (options.action === 'bridge' || options.action === 'preparedAction') {
                    options.passthrough.push(arg);
                    break;
                }
                if (options.action === 'buildOrder' && options.buildOrderAction === 'set') {
                    options.passthrough.push(arg);
                    break;
                }
                throw new Error('未知参数: ' + arg);
        }
    }
    if (options.action === 'restore' || options.action === 'reset' || options.action === 'cleanUntracked') {
        const actionName = options.action === 'cleanUntracked' ? 'clean-untracked' : options.action;
        if (!options.repo) { throw new Error('remote ' + actionName + ' 需要 --repo <repo>'); }
        validateRepoNameArg(options.repo, '--repo');
        if (options.passthrough.length === 0) { throw new Error('remote ' + actionName + ' 需要 -- 后跟至少一个路径'); }
    }
    if (options.action === 'buildOrder' && options.buildOrderAction === 'set' && options.passthrough.length === 0) {
        throw new Error('remote build-order set 需要至少一个 target:action');
    }
    if (options.action === 'transfer' && options.transferAction === 'set') {
        if (!options.transferServer) { throw new Error('remote transfer set 需要 --server <id>'); }
        if (!options.transferPath) { throw new Error('remote transfer set 需要 --path <deployPath>'); }
        if (options.transferArtifacts.length === 0) { throw new Error('remote transfer set 需要至少一个 --artifact <path>'); }
    }
    if (options.action === 'workspaceSettings' && options.workspaceSettingsAction === 'use') {
        if (options.workspaceMode === 'staged' && !options.remoteWorkspace) { throw new Error('remote workspace use --mode staged 需要 --path <remoteWorkspace>'); }
    }
    if (options.action === 'repoSettings' && options.repoSettingsAction === 'set') {
        if (!options.repoLocalName) { throw new Error('remote repo set 需要 --local <name>'); }
        if (!options.repoRemoteName) { throw new Error('remote repo set 需要 --remote <name>'); }
        if (!options.repoRole) { throw new Error('remote repo set 需要 --role <role>'); }
        validateRepoNameArg(options.repoLocalName, '--local');
        validateRepoNameArg(options.repoRemoteName, '--remote');
    }
    if (options.action === 'repoSettings' && options.repoSettingsAction === 'remove' && !options.repoLocalName) {
        throw new Error('remote repo remove 需要 --local <name>');
    }
    if (options.action === 'repoSettings' && options.repoSettingsAction === 'remove') {
        validateRepoNameArg(options.repoLocalName, '--local');
    }
    if (options.action === 'forjaBinSettings' && options.forjaBinSettingsAction === 'use' && !options.remoteForjaBinPath) {
        throw new Error('remote forja-bin use 需要 --path <remoteForjaBin>');
    }
    if (options.target === 'qt' && options.remoteAction === 'run' && options.json && !options.passthrough.includes('--detach')) {
        throw new Error('remote qt run --json 仅支持 --detach 模式，请使用 remote qt run --detach --json');
    }
    return options;
}

function isBridgeAction(target: RemoteBridgeTarget, action: string | undefined): action is RemoteBridgeAction {
    if (action === 'status') { return true; }
    return target === 'qt' && (action === 'stop' || action === 'ps');
}

function isPreparedAction(target: RemoteBridgeTarget, action: string | undefined): action is RemoteBridgeAction {
    if (target === 'qt') {
        return action === 'init' || action === 'use' || action === 'build' || action === 'clean' || action === 'qmake' || action === 'run';
    }
    return action === 'init' || action === 'use' || action === 'build' || action === 'rebuild' || action === 'clean';
}

function remoteSupportMessage(target: RemoteBridgeTarget): string {
    if (target === 'qt') {
        return 'remote qt 仅支持 status/init/use/build/clean/qmake/run/stop/ps/restore/reset/clean-untracked';
    }
    return 'remote cpp 仅支持 status/init/use/build/rebuild/clean/restore/reset/clean-untracked';
}

function blockedResult(action: 'bootstrap' | 'unlock' | 'bridge' | 'restore' | 'reset' | 'cleanUntracked' | 'preparedAction' | 'transfer', diagnostics: RemoteDiagnostic[], nextAction?: string): Record<string, unknown> {
    return { ok: false, action, mode: 'remote', diagnostics, nextAction };
}

function parseBuildOrderItems(items: string[]): RemoteBuildOrderItem[] {
    return items.map(item => {
        const [target, action, extra] = item.split(':');
        if (extra !== undefined || (target !== 'qt' && target !== 'cpp')) {
            throw new Error('非法 build-order 项: ' + item);
        }
        if (target === 'qt' && (action === 'build' || action === 'clean' || action === 'qmake')) {
            return { target, action, args: [] };
        }
        if (target === 'cpp' && (action === 'build' || action === 'rebuild' || action === 'clean')) {
            return { target, action, args: [] };
        }
        throw new Error('非法 build-order 项: ' + item);
    });
}

function buildRepoSetting(options: RemoteCliOptions): RemoteRepoSettings {
    const repo: RemoteRepoSettings = {
        localName: options.repoLocalName,
        remoteName: options.repoRemoteName,
        role: options.repoRole as RemoteRepoSettings['role']
    };
    if (options.repoRemotePath) { repo.remotePath = options.repoRemotePath; }
    if (options.repoBaseline) { repo.baseline = options.repoBaseline; }
    if (options.repoOverlay !== null) { repo.overlay = options.repoOverlay; }
    if (options.repoMount) { repo.mount = options.repoMount; }
    if (options.repoAssets.length > 0) { repo.assets = parseRepoAssets(options.repoAssets); }
    return repo;
}

function validateRepoNameArg(value: string, label: string): void {
    const error = validateStagedRepoName(value, 'repo');
    if (error) { throw new Error(label + ' ' + error); }
}

function consumeTargetPassthrough(argv: string[], index: number, options: RemoteCliOptions): number | null {
    if (options.action !== 'bridge' && options.action !== 'preparedAction') { return null; }
    const arg = argv[index];
    if (arg === '--workspace' || arg === '--json' || arg === '--') { return null; }
    if (!arg.startsWith('--')) { return null; }
    const valueFlags = new Set(['--project', '--mode', '--arch', '--qt', '--vs-dev-shell', '--target', '--qmake-args', '--vs-dev-cmd']);
    const booleanFlags = new Set(['--plan', '--detach']);
    const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (booleanFlags.has(flag) || arg.includes('=')) {
        options.passthrough.push(arg);
        return 0;
    }
    if (valueFlags.has(flag)) {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) { throw new Error(arg + ' 需要一个值'); }
        options.passthrough.push(arg, value);
        return 1;
    }
    return null;
}

function parseRepoAssets(values: string[]): RemoteRepoAssetSettings[] {
    return values.map(value => {
        const idx = value.indexOf('=');
        const localPath = idx >= 0 ? value.slice(0, idx) : value;
        const remotePath = idx >= 0 ? value.slice(idx + 1) : '';
        validateRepoAssetPath(localPath, '--asset local');
        if (remotePath) { validateRepoAssetPath(remotePath, '--asset remote'); }
        return remotePath ? { localPath: normalizeAssetPath(localPath), remotePath: normalizeAssetPath(remotePath) } : { localPath: normalizeAssetPath(localPath) };
    });
}

function validateRepoAssetPath(value: string, label: string): void {
    const normalized = normalizeAssetPath(value);
    if (!normalized || normalized.includes('\0') || path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(label + ' 需要 repo 内相对路径');
    }
    if (normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
        throw new Error(label + ' 需要 repo 内相对路径');
    }
}

function normalizeAssetPath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function isRemoteRepoRole(value: unknown): value is RemoteRepoSettings['role'] {
    return value === 'primary'
        || value === 'mapped'
        || value === 'remote-only'
        || value === 'existing-remote'
        || value === 'skip';
}

function cliPackageRoot(): string {
    return findPackageRoot(__dirname) || path.resolve(__dirname, '..', '..', '..');
}

function writeOutput(result: unknown, json: boolean): void {
    if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    const out = result as {
        ok?: boolean;
        action?: string;
        overall?: string;
        stdout?: string;
        remote?: { stdout?: string };
        diagnostics?: Array<{ level?: string; message: string }>;
        nextAction?: string;
        server?: string;
        remotePath?: string;
        remoteSettings?: {
            remoteForjaBin: string;
            buildOrder: { configured: boolean; items: string[] };
            transfer: { configured: boolean; deployServer: string | null; deployPath: string | null; artifactCount: number };
        };
        status?: {
            ready: boolean;
            configured: boolean;
            plan: Array<{ source: string; destination: string }>;
        };
        checks?: Array<{ name: string; ok: boolean | null; message?: string; nextAction?: string }>;
        autoFixes?: Array<{ name: string; available: boolean; command: string; reason?: string }>;
    };
    if (out.action === 'status') {
        console.log(formatRemoteStatus(out));
        return;
    }
    if (out.action === 'doctor') {
        console.log(formatRemoteDoctor(out));
        return;
    }
    if (out.action === 'transfer' && out.status) {
        console.log(formatTransferStatus(out.status));
        return;
    }
    if (out.action === 'bridge' && out.stdout) {
        console.log(out.stdout.trim());
        return;
    }
    if (out.action === 'preparedAction' && out.remote?.stdout) {
        console.log(out.remote.stdout.trim());
        return;
    }
    if (out.ok === false && out.diagnostics && out.diagnostics.length > 0) {
        const lines = ['Error'];
        for (const item of out.diagnostics) {
            lines.push(`  ${item.level || 'error'}: ${item.message}`);
        }
        if (out.nextAction) {
            lines.push('', 'Next', `  ${out.nextAction}`);
        }
        console.log(lines.join('\n'));
        return;
    }
    console.log('Remote ' + (out.action || 'command') + ': ' + (out.ok === false ? 'failed' : 'ok'));
}

function formatRemoteDoctor(out: {
    ok?: boolean;
    overall?: string;
    server?: string;
    remotePath?: string;
    checks?: Array<{ name: string; ok: boolean | null; message?: string; nextAction?: string }>;
    diagnostics?: Array<{ message: string }>;
    nextAction?: string;
    autoFixes?: Array<{ name: string; available: boolean; command: string; reason?: string }>;
}): string {
    const lines = ['Remote doctor: ' + (out.overall || 'unknown')];
    if (out.server) { lines.push('server: ' + out.server); }
    if (out.remotePath) { lines.push('remotePath: ' + out.remotePath); }
    for (const check of out.checks || []) {
        const mark = check.ok === true ? 'ok' : check.ok === false ? 'blocked' : 'unknown';
        lines.push(`${mark}: ${check.name}${check.message ? ' - ' + check.message : ''}`);
    }
    for (const fix of out.autoFixes || []) {
        if (fix.available) { lines.push('autofix: ' + fix.command); }
    }
    if (out.diagnostics && out.diagnostics.length > 0) {
        for (const item of out.diagnostics) { lines.push('diagnostic: ' + item.message); }
    }
    if (out.nextAction) {
        if (out.nextAction) {
            const item = out.nextAction; lines.push('next: ' + item); }
    }
    return lines.join('\n');
}

function formatRemoteStatus(out: {
    overall?: string;
    server?: string;
    remotePath?: string;
    remoteSettings?: {
        remoteForjaBin: string;
        buildOrder: { configured: boolean; items: string[] };
        transfer: { configured: boolean; deployServer: string | null; deployPath: string | null; artifactCount: number };
    };
    diagnostics?: Array<{ message: string }>;
    nextAction?: string;
}): string {
    const lines = ['Remote status: ' + (out.overall || 'unknown')];
    if (out.server) { lines.push('server: ' + out.server); }
    if (out.remotePath) { lines.push('remotePath: ' + out.remotePath); }
    if (out.remoteSettings) {
        lines.push('remoteForjaBin: ' + (out.remoteSettings.remoteForjaBin || '$HOME/.forja/bin/forja'));
        lines.push('buildOrder: ' + (out.remoteSettings.buildOrder.configured ? out.remoteSettings.buildOrder.items.join(', ') : 'not configured'));
        const transfer = out.remoteSettings.transfer;
        lines.push('transfer: ' + (transfer.configured ? `${transfer.deployServer} -> ${transfer.deployPath} (${transfer.artifactCount} artifact${transfer.artifactCount === 1 ? '' : 's'})` : 'not configured'));
    }
    if (out.diagnostics && out.diagnostics.length > 0) {
        for (const item of out.diagnostics) { lines.push('diagnostic: ' + item.message); }
    }
    if (out.nextAction) {
        if (out.nextAction) {
            const item = out.nextAction; lines.push('next: ' + item); }
    }
    return lines.join('\n');
}

function formatTransferStatus(status: {
    ready: boolean;
    configured: boolean;
    plan: Array<{ source: string; destination: string }>;
}): string {
    const lines = ['Remote transfer: ' + (status.ready ? 'ready' : status.configured ? 'blocked' : 'not configured')];
    for (const item of status.plan) {
        lines.push(item.source + ' -> ' + item.destination);
    }
    return lines.join('\n');
}

function helpText(): string {
    return [
        'Usage: forja remote <command> [options]',
        '',
        'Commands:',
        '  forja remote status [--json]',
        '  forja remote doctor [--bootstrap] [--json]',
        '  forja remote test [--bootstrap] [--json]',
        '  forja remote bootstrap [--json]',
        '  forja remote unlock --lock-id <id> --force [--json]',
        '  forja remote workspace status|use|clear [--json]',
        '  forja remote repo list|set|remove|clear [--asset local[=remote]] [--json]',
        '  forja remote forja-bin status|use|clear [--path <remoteForjaBin>] [--json]',
        '  forja remote build-order status|set|clear [items...] [--json]',
        '  forja remote transfer status|set|clear|run [--json]',
        '  forja remote qt status|init|use|build|clean|qmake|run|stop|ps [--json]',
        '  forja remote qt restore|reset --repo <repo> -- <paths...> [--json]',
        '  forja remote qt clean-untracked --repo <repo> [--recursive] -- <paths...> [--json]',
        '  forja remote cpp status|init|use|build|rebuild|clean [--json]',
        '  forja remote cpp restore|reset --repo <repo> -- <paths...> [--json]',
        '  forja remote cpp clean-untracked --repo <repo> [--recursive] -- <paths...> [--json]'
    ].join('\n');
}
