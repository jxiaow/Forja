/**
 * CLI remote-mode routing — decides local vs remote and bridges actions to a remote forja.
 * Extracted from index.ts; behavior unchanged.
 */
import * as path from 'path';
import { T } from './types';
import { outputResult } from './output';
import { loadRemoteSettings } from '../../core/settingsIO';
import { getServerById } from '../../core/serverStore';
import { loadWorkspaceConfig, getActiveTarget } from '../../core/workspaceStore';
import { executeRemoteBridge } from '../../remote/core/bridge';
import { createSshRunner } from '../../remote/core/shell';
import { scpDownload } from '../../core/sshTransport';

export function isRemoteMode(workroot: string): boolean {
    return loadRemoteSettings(workroot).remoteMode === true;
}

export function resolveRemoteTargetKind(workroot: string): 'qt' | 'cpp' | null {
    const config = loadWorkspaceConfig(workroot);
    if (!config) { return null; }
    const target = getActiveTarget(config);
    return target ? target.kind : null;
}

// Direct bridge to remote — no prepare pipeline (baseline/lock/branchSync)
export async function executeRemoteBridgeAction(workroot: string, action: string, extraArgs: string[], wantsJson: boolean): Promise<{ ok: boolean } | null> {
    const remoteSettings = loadRemoteSettings(workroot);
    const serverId = remoteSettings.selectedServer;
    const server = serverId ? getServerById(serverId) : null;
    const remotePath = serverId ? remoteSettings.remotePaths[serverId] : undefined;

    if (!server || !remotePath) {
        outputResult({ ok: false, action, diagnostics: [{ level: 'error', message: serverId ? T('remotePathNotConfigured') : T('remoteNoServerConfigured') }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return null;
    }

    const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
    const runner = createSshRunner(server, password);
    const bridge = await executeRemoteBridge({
        target: resolveRemoteTargetKind(workroot) || 'qt',
        // Remote action names are validated by callers; bridge accepts the wider protocol union.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        action: action as any,
        args: extraArgs,
        json: wantsJson,
        stream: !wantsJson,
        remotePath,
        runner,
        remoteForjaBin: remoteSettings.remoteForjaBin || undefined,
    });

    if (wantsJson) {
        console.log(bridge.result ? JSON.stringify(bridge.result, null, 2) : JSON.stringify({ ok: bridge.ok, diagnostics: bridge.diagnostics }, null, 2));
    } else if (!bridge.ok) {
        for (const d of bridge.diagnostics) { console.error(`  ${d.level}: ${d.message}`); }
    }
    if (!bridge.ok) { process.exitCode = 1; }
    return { ok: bridge.ok };
}

export async function downloadArtifacts(workroot: string, argv: string[], wantsJson: boolean): Promise<void> {
    const remoteSettings = loadRemoteSettings(workroot);
    const serverId = remoteSettings.selectedServer;
    if (!serverId) { return; }
    const server = getServerById(serverId);
    if (!server) { return; }
    const remotePath = remoteSettings.remotePaths[serverId];
    if (!remotePath) { return; }

    // Collect artifact paths: --artifact flags first, then deploy config
    const artifacts: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--artifact' && argv[i + 1]) { artifacts.push(argv[++i]); }
    }
    if (artifacts.length === 0 && remoteSettings.transfer) {
        artifacts.push(...remoteSettings.transfer.artifacts);
    }
    if (artifacts.length === 0) {
        if (!wantsJson) { console.log(T('deployNoArtifacts')); }
        return;
    }

    const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
    const downloaded: string[] = [];
    for (const artifact of artifacts) {
        const remoteFile = remotePath.replace(/\/+$/, '') + '/' + artifact;
        const localFile = path.basename(artifact);
        try {
            await scpDownload(server, remoteFile, localFile, password, undefined, true);
            downloaded.push(localFile);
            if (!wantsJson) { console.log(`  ✓ ${artifact} → ${localFile}`); }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (!wantsJson) { console.log(`  ✗ ${artifact}: ${msg}`); }
            process.exitCode = 1;
        }
    }
    if (!wantsJson && downloaded.length > 0) {
        console.log(T('deployDownloadDone', [String(downloaded.length)]));
    }
}
