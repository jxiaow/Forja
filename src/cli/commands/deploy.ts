/**
 * `forja deploy` — build on remote, download artifacts, upload to target machine.
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ForjaJsonResult, Locale, T } from './types';
import { loadRemoteSettings, saveRemoteSettings } from '../../core/settingsIO';
import { getServerById, resolveServerSelector, ServerConfig } from '../../core/serverStore';
import { loadWorkspaceConfig, getActiveTarget } from '../../core/workspaceStore';
import { executeRemotePlan } from '../../remote/core/plan';
import { scpDownload, scpUpload } from '../../core/sshTransport';
import { createSshRunner, remoteCommand } from '../../remote/core/shell';
import { outputResult } from './output';
import { extractFlag, findUnknownFlags, unknownFlagsMessage, suggestCorrection } from './args';
import { isRemoteMode, executeRemoteBridgeAction } from './remoteMode';

export type DeployAction = 'deploy' | 'config';

export interface DeployResult extends ForjaJsonResult {
    action: 'deploy';
    deployAction: DeployAction;
    downloaded?: string[];
    uploaded?: Array<{ source: string; destination: string }>;
    fallbackUrl?: string;
}

// ── deploy config ──

export interface DeployConfigArgs {
    server?: string;
    deployPath?: string;
    artifacts: string[];
}

export function runDeployConfig(workroot: string, args: DeployConfigArgs): DeployResult {
    const remote = loadRemoteSettings(workroot);

    if (args.server) {
        const resolved = resolveServerSelector(args.server);
        if (!resolved.server) {
            const message = resolved.ambiguous
                ? `${T('use.ambiguousServerName')}: ${args.server}`
                : `${T('use.serverNotFound')}: ${args.server}`;
            return { ok: false, action: 'deploy', deployAction: 'config', diagnostics: [{ level: 'error', message }] };
        }
        remote.transfer = remote.transfer || { deployServer: '', deployPath: '', artifacts: [] };
        remote.transfer.deployServer = resolved.server.id;
    }

    if (args.deployPath) {
        remote.transfer = remote.transfer || { deployServer: '', deployPath: '', artifacts: [] };
        remote.transfer.deployPath = args.deployPath;
    }

    if (args.artifacts.length > 0) {
        remote.transfer = remote.transfer || { deployServer: '', deployPath: '', artifacts: [] };
        remote.transfer.artifacts = args.artifacts;
    }

    if (!remote.transfer) {
        return { ok: false, action: 'deploy', deployAction: 'config', diagnostics: [{ level: 'error', message: 'No deploy config to save. Use --server, --deploy-path, or --artifact.' }] };
    }

    saveRemoteSettings(workroot, remote);
    return {
        ok: true,
        action: 'deploy',
        deployAction: 'config',
        downloaded: [],
    };
}

export function formatDeployConfigText(result: DeployResult, _locale: Locale): string {
    if (!result.ok) {
        return [T('error'), ...(result.diagnostics ?? []).map(d => `  ${d.message}`)].join('\n');
    }
    return T('deployConfigSaved');
}

// ── deploy ──

export async function runDeploy(workroot: string, options: { artifactFlags: string[]; json: boolean }): Promise<DeployResult> {
    const remote = loadRemoteSettings(workroot);
    const serverId = remote.selectedServer;
    if (!serverId) {
        return { ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: T('remoteNoServerConfigured') }], nextAction: 'forja sync' };
    }
    const buildServer = getServerById(serverId);
    if (!buildServer) {
        return { ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: `${T('use.serverNotFound')}: ${serverId}` }] };
    }
    const remotePath = remote.remotePaths[serverId];
    if (!remotePath) {
        return { ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: T('remotePathNotConfigured') }] };
    }
    if (!remote.transfer || !remote.transfer.deployServer) {
        return { ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: T('deployNotConfigured') }], nextAction: 'forja deploy config --server <target> --deploy-path <path> --artifact <file>' };
    }

    const targetServer = getServerById(remote.transfer.deployServer);
    if (!targetServer) {
        return { ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: `${T('deploy.targetNotFound')}: ${remote.transfer.deployServer}` }] };
    }

    // Resolve artifacts
    const artifacts = options.artifactFlags.length > 0 ? options.artifactFlags : remote.transfer.artifacts;
    if (artifacts.length === 0) {
        return { ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: T('deployNoArtifacts') }] };
    }

    // Resolve target kind
    const config = loadWorkspaceConfig(workroot);
    const target = config ? getActiveTarget(config) : null;
    if (!target) {
        return { ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: T('notInitialized') }] };
    }

    const buildPassword = buildServer.password || process.env.FORJA_SSH_PASSWORD || null;

    // Step 1: Remote build
    if (!options.json) { console.log(T('deployBuilding')); }
    const buildResult = await executeRemotePlan({
        workspace: workroot,
        target: target.kind,
        action: 'build',
        json: options.json,
        stream: !options.json,
    });
    if (!buildResult.ok) {
        return {
            ok: false, action: 'deploy', deployAction: 'deploy',
            diagnostics: [...buildResult.diagnostics.map(d => ({ level: d.level as 'error' | 'warning' | 'info', message: d.message })), { level: 'error' as const, message: T('deployBuildFailed') }],
            nextAction: buildResult.nextAction,
        };
    }
    if (!options.json) { console.log(T('deployBuildDone')); }

    // Step 2: Download artifacts to local temp dir
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-deploy-'));
    const downloaded: string[] = [];
    try {
        for (const artifact of artifacts) {
            const remoteFile = remotePath.replace(/\/+$/, '') + '/' + artifact;
            const localFile = path.join(tempDir, path.basename(artifact));
            if (!options.json) { console.log(`  ${T('deployDownloading')} ${artifact}...`); }
            await scpDownload(buildServer, remoteFile, localFile, buildPassword, undefined, true);
            downloaded.push(artifact);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cleanupTempDir(tempDir);
        return { ok: false, action: 'deploy', deployAction: 'deploy', downloaded, diagnostics: [{ level: 'error', message: `${T('deployDownloadFailed')}: ${msg}` }] };
    }
    if (!options.json) { console.log(T('deployDownloadDone', [String(downloaded.length)])); }

    // Step 3: Upload to target machine via SSH
    const targetPassword = targetServer.password || process.env.FORJA_SSH_PASSWORD || null;
    const deployPath = remote.transfer.deployPath;
    const uploaded: Array<{ source: string; destination: string }> = [];

    // Ensure target directory exists
    const targetRunner = createSshRunner(targetServer, targetPassword);
    const mkdirResult = await targetRunner.run(`mkdir -p ${remoteCommand([deployPath])}`, 15000);
    if (mkdirResult.exitCode !== 0) {
        // SSH might have failed entirely
        if (!options.json) { console.log(T('deploySshFailed')); }
        cleanupTempDir(tempDir);
        const fallbackUrl = await startFallbackHttp(buildServer, buildPassword, remotePath, artifacts, tempDir, options.json);
        return {
            ok: true, action: 'deploy', deployAction: 'deploy',
            downloaded, uploaded: [], fallbackUrl: fallbackUrl || undefined,
            diagnostics: [{ level: 'warning', message: T('deploySshFailed') }],
        };
    }

    // Upload each artifact
    for (const artifact of downloaded) {
        const localFile = path.join(tempDir, path.basename(artifact));
        const destFile = deployPath.replace(/\/+$/, '') + '/' + path.basename(artifact);
        try {
            await scpUpload(targetServer, localFile, destFile, targetPassword, undefined, true);
            uploaded.push({ source: artifact, destination: destFile });
            if (!options.json) { console.log(`  ✓ ${artifact} → ${targetServer.name || targetServer.host}:${destFile}`); }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!options.json) { console.log(T('deploySshFailed')); }
            const fallbackUrl = await startFallbackHttp(buildServer, buildPassword, remotePath, artifacts, tempDir, options.json);
            cleanupTempDir(tempDir);
            return {
                ok: true, action: 'deploy', deployAction: 'deploy',
                downloaded, uploaded, fallbackUrl: fallbackUrl || undefined,
                diagnostics: [{ level: 'warning', message: `${T('deployUploadFailed')}: ${msg}` }],
            };
        }
    }

    cleanupTempDir(tempDir);
    if (!options.json) { console.log(T('deployDone')); }
    return { ok: true, action: 'deploy', deployAction: 'deploy', downloaded, uploaded };
}

async function startFallbackHttp(
    buildServer: ServerConfig,
    password: string | null,
    remotePath: string,
    _artifacts: string[],
    _tempDir: string,
    json: boolean,
): Promise<string | null> {
    if (json) { return null; }
    const port = 8989;
    const url = `http://${buildServer.host}:${port}/`;
    const runner = createSshRunner(buildServer, password);

    // Start HTTP server on build server in background
    console.log(T('deployFallback'));
    const startResult = await runner.run(
        `cd ${remoteCommand([remotePath])} && nohup python3 -m http.server ${port} > /dev/null 2>&1 & echo $!`,
        15000,
    );
    if (startResult.exitCode !== 0) {
        console.log(`  ⚠ ${T('deployFallbackFailed')}`);
        return null;
    }
    const pid = startResult.stdout.trim();
    console.log(`  ${T('deployFallbackHint')}`);
    console.log(`  ${url}`);
    console.log(`  ${T('deployFallbackPressEnter')}`);

    // Wait for user to press Enter
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => rl.question('', () => { rl.close(); resolve(); }));

    // Kill the HTTP server
    if (pid) {
        await runner.run(`kill ${pid} 2>/dev/null`, 5000).catch(() => {});
    }
    return url;
}

function cleanupTempDir(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

export function formatDeployText(result: DeployResult, _locale: Locale): string {
    if (!result.ok) {
        const lines = [T('error'), ...(result.diagnostics ?? []).map(d => `  ${d.message}`)];
        if (result.nextAction) { lines.push(T('next'), `  ${result.nextAction}`); }
        return lines.join('\n');
    }
    const lines: string[] = [];
    if (result.downloaded && result.downloaded.length > 0) {
        lines.push(T('deployDownloadDone', [String(result.downloaded.length)]));
    }
    if (result.uploaded && result.uploaded.length > 0) {
        for (const u of result.uploaded) {
            lines.push(`  ✓ ${u.source} → ${u.destination}`);
        }
        lines.push(T('deployDone'));
    }
    if (result.fallbackUrl) {
        lines.push(`${T('deployFallbackUrl')}: ${result.fallbackUrl}`);
    }
    for (const d of result.diagnostics ?? []) {
        if (d.level === 'warning') { lines.push(`  ⚠ ${d.message}`); }
    }
    return lines.join('\n');
}

// ── Deploy ──

export async function handleDeploy(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    if (subCmd === 'config') {
        const server = extractFlag(argv, '--server');
        const deployPath = extractFlag(argv, '--deploy-path');
        const artifacts: string[] = [];
        for (let i = 0; i < argv.length; i++) {
            if (argv[i] === '--artifact' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
                artifacts.push(argv[++i]);
            }
        }
        const result = runDeployConfig(workroot, { server, deployPath, artifacts });
        const fmt = (r: DeployResult) => formatDeployConfigText(r, locale);
        outputResult(result, wantsJson, fmt);
        if (!result.ok) { process.exitCode = 1; }
        return;
    }

    if (subCmd !== '') {
        const DEPLOY_SUBCOMMANDS = ['config'];
        const hint = suggestCorrection(subCmd, DEPLOY_SUBCOMMANDS);
        const msg = hint
            ? `${T('idx.unknownRemoteSubcommand')}: ${subCmd}. ${T('idx.didYouMean')}: forja deploy ${hint}?`
            : `${T('idx.unknownRemoteSubcommand')}: ${subCmd}`;
        outputResult({ ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: msg }] }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const deployUnknown = findUnknownFlags(argv, new Set(['--artifact']), new Set(['--artifact']));
    if (deployUnknown.length > 0) {
        outputResult({ ok: false, action: 'deploy', deployAction: 'deploy', diagnostics: [{ level: 'error', message: unknownFlagsMessage(deployUnknown, new Set(['--artifact'])) }], nextAction: 'forja deploy' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const artifactFlags: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--artifact' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
            artifactFlags.push(argv[++i]);
        }
    }

    // Remote mode — bridge deploy to remote
    if (isRemoteMode(workroot)) {
        const extraArgs: string[] = [];
        for (const a of artifactFlags) { extraArgs.push('--artifact', a); }
        await executeRemoteBridgeAction(workroot, 'deploy', extraArgs, wantsJson);
        return;
    }

    const result = await runDeploy(workroot, { artifactFlags, json: wantsJson });
    const fmt = (r: DeployResult) => formatDeployText(r, locale);
    outputResult(result, wantsJson, fmt);
    if (!result.ok) { process.exitCode = 1; }
}
