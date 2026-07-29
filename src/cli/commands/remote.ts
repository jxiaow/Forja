/**
 * `forja remote` — remote sync configuration and bootstrap.
 */
import { ForjaJsonResult, Locale, T } from './types';
import { loadRemoteSettings } from '../../core/settingsIO';
import { resolveServerSelector } from '../../core/serverStore';
import { configureSyncSettings } from '../../sync/cli';

export type RemoteAction = 'show' | 'setup';

export interface RemoteResult extends ForjaJsonResult {
    action: 'remote';
    remoteAction: RemoteAction;
    changed?: string[];
    remote?: {
        selectedServer?: string;
        remotePath?: string;
    };
}

export function formatRemoteText(result: RemoteResult, _locale: Locale): string {
    if (!result.ok) {
        const lines = [T('error'), ...(result.diagnostics ?? []).map(diagnostic => `  ${diagnostic.message}`)];
        if (result.nextAction) {
            lines.push(T('next'), `  ${result.nextAction}`);
        }
        return lines.join('\n');
    }

    const remote = result.remote;
    const lines = [T('remoteLabel')];
    if (!remote?.selectedServer) {
        lines.push(`  ${T('remoteNoServerConfigured')}`);
    } else {
        lines.push(`  ${T('serverLabel')}: ${remote.selectedServer}`);
        if (remote.remotePath) {
            lines.push(`  ${T('remotePathLabel')}: ${remote.remotePath}`);
        }
    }
    if (result.nextAction) {
        lines.push(T('next'), `  ${result.nextAction}`);
    }
    return lines.join('\n');
}

export function runRemoteShow(workspace: string): RemoteResult {
    const remote = loadRemoteSettings(workspace);
    return {
        ok: true,
        action: 'remote',
        remoteAction: 'show',
        workspace,
        changed: [],
        remote: {
            selectedServer: remote.selectedServer,
            remotePath: remote.selectedServer ? remote.remotePaths[remote.selectedServer] : undefined,
        },
    };
}

export interface RemoteSetupArgs {
    server: string;
    remotePath: string;
}

export function runRemoteSetup(workspace: string, args: RemoteSetupArgs): RemoteResult {
    const remotePath = args.remotePath.trim();
    if (!remotePath) {
        return { ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message: 'Remote path is required.' }], nextAction: 'forja remote setup --server <name> --remote-path <path>' };
    }
    const resolved = resolveServerSelector(args.server);
    if (!resolved.server) {
        const message = resolved.ambiguous
            ? `${T('use.ambiguousServerName')}: ${args.server}. ${T('use.useServerIdInstead')}`
            : `${T('use.serverNotFound')}: ${args.server}`;
        return { ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message }], nextAction: 'forja server' };
    }

    const configured = configureSyncSettings(workspace, {
        serverId: resolved.server.id,
        remotePath,
        enable: true,
    });
    if (!configured.ok) {
        return { ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message: configured.error }], nextAction: 'forja remote setup' };
    }

    return {
        ok: true,
        action: 'remote',
        remoteAction: 'setup',
        workspace,
        changed: ['remote.selectedServer', 'remote.remotePath', 'sync.enabled'],
        remote: { selectedServer: resolved.server.id, remotePath },
        nextAction: 'forja remote bootstrap',
    };
}
