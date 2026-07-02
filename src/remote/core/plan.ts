/**
 * Remote build plan — wraps executePreparedRemoteAction for type-safe invocation.
 * Provides an interface for remote build/run/clean operations.
 */
import { executePreparedRemoteAction } from './pipeline';
import { RemoteBridgeAction, RemoteBridgeTarget } from './bridge';
import { createSshRunner, createScpUploader } from './shell';
import { loadRemoteSettings, loadSyncSettings } from '../../core/settingsIO';
import { getServerById } from '../../core/serverStore';

export interface RemotePlanOptions {
    workspace: string;
    target: 'qt' | 'sdk';
    action: 'build' | 'rebuild' | 'clean' | 'qmake' | 'run' | 'stop' | 'status';
    args?: string[];
    json?: boolean;
    stream?: boolean;
    owner?: string;
    ignore?: string[];
    activeProject?: string;
}

export interface RemotePlanResult {
    ok: boolean;
    action: 'preparedAction';
    mode: 'remote';
    stages: Array<{ stage: string; ok: boolean; message: string }>;
    diagnostics: Array<{ level: string; message: string }>;
    nextAction?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    actionRemotePath?: string;
}

/**
 * Execute remote action with type-safe options.
 * Wraps the complex executePreparedRemoteAction API.
 */
export async function executeRemotePlan(options: RemotePlanOptions): Promise<RemotePlanResult> {
    const { workspace, target, action, args = [], json = true, stream = false, owner = 'forja-cli', ignore = [] } = options;

    // Load settings
    const remoteSettings = loadRemoteSettings(workspace);
    const syncSettings = loadSyncSettings(workspace);

    // Resolve server and remote path - prefer remoteSettings, fallback to syncSettings
    const serverId = remoteSettings.selectedServer || syncSettings.selectedServer;
    if (!serverId) {
        return {
            ok: false,
            action: 'preparedAction',
            mode: 'remote',
            stages: [],
            diagnostics: [{ level: 'error', message: 'No remote server configured' }],
            nextAction: 'forja use remote --server <name>',
        };
    }

    const server = getServerById(serverId);
    if (!server) {
        return {
            ok: false,
            action: 'preparedAction',
            mode: 'remote',
            stages: [],
            diagnostics: [{ level: 'error', message: `Server not found: ${serverId}` }],
            nextAction: 'forja server',
        };
    }

    const remotePath = remoteSettings.remotePaths[serverId] || syncSettings.remotePaths[serverId];
    if (!remotePath) {
        return {
            ok: false,
            action: 'preparedAction',
            mode: 'remote',
            stages: [],
            diagnostics: [{ level: 'error', message: 'Remote path not configured' }],
            nextAction: 'forja use remote --server <name> --remote-path <path>',
        };
    }

    // Create runner and uploader
    const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
    const runner = createSshRunner(server, password);
    const uploader = createScpUploader(server, password);

    // Execute
    try {
        const result = await executePreparedRemoteAction({
            workspace,
            remotePath,
            ignore,
            owner,
            runner,
            uploader,
            target: target as RemoteBridgeTarget,
            action: action as RemoteBridgeAction,
            args,
            json,
            stream,
            buildOrder: remoteSettings.buildOrder,
            activeProject: options.activeProject,
        });

        return {
            ok: result.ok,
            action: 'preparedAction',
            mode: 'remote',
            stages: result.stages.map(s => ({ stage: s.stage, ok: s.ok, message: s.message || '' })),
            diagnostics: result.diagnostics.map(d => ({ level: d.level, message: d.message })),
            nextAction: result.nextAction,
            exitCode: result.remote?.exitCode,
            stdout: result.remote?.stdout,
            stderr: result.remote?.stderr,
            actionRemotePath: result.actionRemotePath,
        };
    } catch (error) {
        return {
            ok: false,
            action: 'preparedAction',
            mode: 'remote',
            stages: [],
            diagnostics: [{ level: 'error', message: error instanceof Error ? error.message : String(error) }],
            nextAction: 'forja doctor --remote',
        };
    }
}

/**
 * Build an actual SSH shell command for --plan display.
 * Resolves server host/username and remote path from settings.
 */
export function buildRemoteShellCommand(workspace: string, action: string): string {
    const remoteSettings = loadRemoteSettings(workspace);
    const syncSettings = loadSyncSettings(workspace);
    const serverId = remoteSettings.selectedServer || syncSettings.selectedServer;
    if (!serverId) { return `ssh <server> "cd <remotePath> && forja ${action}"`; }
    const server = getServerById(serverId);
    if (!server) { return `ssh <server> "cd <remotePath> && forja ${action}"`; }
    const remotePath = remoteSettings.remotePaths[serverId] || syncSettings.remotePaths[serverId] || '<remotePath>';
    return `ssh ${server.username}@${server.host} "cd ${remotePath} && forja ${action}"`;
}
