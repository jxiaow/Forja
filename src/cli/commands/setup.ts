/**
 * `forja setup` — local + remote initialization.
 * `forja setup` — local only (scan, detect, auto-select).
 * `forja setup remote` — remote setup (server, sync, deploy, init, execution switch).
 */
import * as path from 'path';
import { runInit } from './init';
import { runUseRemote, runUseSync, runUseExecution } from './use';
import { ForjaJsonResult, Diagnostic, diag, T } from './types';
import { confirm } from './prompt';
import {
    loadRemoteSettings,
    loadSyncSettings,
    loadActiveTarget,
} from '../../core/settingsIO';
import { readServers, getServerById } from '../../core/serverStore';
import { createSshRunner, createScpUploader } from '../../remote/core/shell';
import { findBootstrapArtifact, executeRemoteBootstrap } from '../../remote/core/bootstrap';
import { executeRemoteBridge } from '../../remote/core/bridge';

// ── Local setup ──

export interface SetupOptions {
    plan?: boolean;
    json?: boolean;
}

export interface SetupResult extends ForjaJsonResult {
    action: 'setup';
    local: {
        qtTargets: number;
        sdkTargets: number;
        toolchain: { qt?: boolean; vs?: boolean; jom?: boolean; make?: boolean };
        configured: boolean;
    };
    steps: Record<string, 'done' | 'skipped' | 'failed'>;
}

export async function runSetup(workspace: string, options: SetupOptions = {}): Promise<SetupResult> {
    const result: SetupResult = {
        ok: true,
        action: 'setup',
        workspace,
        local: { qtTargets: 0, sdkTargets: 0, toolchain: {}, configured: false },
        steps: {},
    };

    const isInteractive = !options.json && !options.plan && process.stdin.isTTY === true;
    const initResult = await runInit(workspace, { plan: options.plan, interactive: isInteractive });

    result.local = {
        qtTargets: initResult.detected.qtTargets,
        sdkTargets: initResult.detected.sdkTargets,
        toolchain: initResult.detected.toolchain,
        configured: initResult.ok,
    };
    result.steps.localConfig = initResult.ok ? 'done' : 'failed';

    if (!initResult.ok) {
        result.ok = false;
        result.diagnostics = initResult.diagnostics;
        return result;
    }

    const diagnostics: Diagnostic[] = [];
    if (initResult.diagnostics) {
        diagnostics.push(...initResult.diagnostics);
    }

    if (diagnostics.length > 0) {
        result.diagnostics = diagnostics;
    }

    if (initResult.ambiguous) {
        result.nextAction = 'forja list targets';
    } else {
        result.nextAction = 'forja setup remote';
    }

    return result;
}

// ── Remote setup ──

export interface SetupRemoteOptions {
    plan?: boolean;
    json?: boolean;
}

export interface SetupRemoteResult extends ForjaJsonResult {
    action: 'setup-remote';
    remote?: {
        serverId: string;
        serverName: string;
        host: string;
        remotePath: string;
        syncEnabled: boolean;
        forjaDeployed: boolean;
        forjaVersion?: string;
        executionMode: 'local' | 'remote';
        configured: boolean;
    };
    steps: Record<string, 'done' | 'skipped' | 'failed'>;
}

export async function runSetupRemote(workspace: string, options: SetupRemoteOptions = {}): Promise<SetupRemoteResult> {
    const result: SetupRemoteResult = {
        ok: true,
        action: 'setup-remote',
        workspace,
        steps: {},
    };

    const isInteractive = !options.json && !options.plan && process.stdin.isTTY === true;

    if (options.plan) {
        result.steps.serverSetup = 'skipped';
        result.steps.remoteConfig = 'skipped';
        result.steps.syncSetup = 'skipped';
        result.steps.forjaDeploy = 'skipped';
        result.steps.remoteInit = 'skipped';
        result.steps.executionSwitch = 'skipped';
        return result;
    }

    // Resolve server from existing config
    const existingServers = readServers();
    const remoteSettings = loadRemoteSettings(workspace);
    let serverId = '';
    let serverName = '';
    let serverHost = '';

    if (remoteSettings.selectedServer) {
        serverId = remoteSettings.selectedServer;
        const server = getServerById(serverId);
        if (server) {
            serverName = server.name;
            serverHost = server.host;
            result.steps.serverSetup = 'done';
        }
    } else if (existingServers.length === 1) {
        serverId = existingServers[0].id;
        serverName = existingServers[0].name;
        serverHost = existingServers[0].host;
        result.steps.serverSetup = 'done';
    } else if (existingServers.length > 1) {
        result.steps.serverSetup = 'skipped';
        result.steps.remoteConfig = 'skipped';
        result.steps.syncSetup = 'skipped';
        result.steps.forjaDeploy = 'skipped';
        result.steps.remoteInit = 'skipped';
        result.steps.executionSwitch = 'skipped';
        result.diagnostics = [{ level: 'info', message: `${existingServers.length} ${T('setupMultipleServers')}` }];
        result.nextAction = 'forja list servers';
        return result;
    } else {
        result.steps.serverSetup = 'skipped';
        result.steps.remoteConfig = 'skipped';
        result.steps.syncSetup = 'skipped';
        result.steps.forjaDeploy = 'skipped';
        result.steps.remoteInit = 'skipped';
        result.steps.executionSwitch = 'skipped';
        result.diagnostics = [{ level: 'info', message: T('setupNoServer') }];
        result.nextAction = 'forja server add';
        return result;
    }

    // Resolve remote path
    const remotePath = loadRemoteSettings(workspace).remotePaths[serverId]
        || loadSyncSettings(workspace).remotePaths[serverId]
        || `/home/${serverHost.split('@')[0] || 'user'}/${path.basename(workspace)}`;

    // Interactive confirmation
    if (isInteractive) {
        console.log(`\n${T('setupRemoteTitle')}`);
        console.log(`  ${T('serverLabel')} ${serverName} (${serverHost})`);
        console.log(`  ${T('remotePathLabel')}${remotePath}`);
        const proceed = await confirm(T('setupConfirmRemote'), true);
        if (!proceed) {
            result.diagnostics = [{ level: 'info', message: T('setupSkippedRemote') }];
            result.steps.serverSetup = 'skipped';
            result.steps.remoteConfig = 'skipped';
            result.steps.syncSetup = 'skipped';
            result.steps.forjaDeploy = 'skipped';
            result.steps.remoteInit = 'skipped';
            result.steps.executionSwitch = 'skipped';
            return result;
        }
    }

    const diagnostics: Diagnostic[] = [];

    // Configure remote execution
    const remoteResult = runUseRemote(workspace, { server: serverId, remotePath });
    if (remoteResult.ok) {
        result.steps.remoteConfig = 'done';
        diagnostics.push(diag('info', `${T('setupRemoteConfigured')}: ${serverName} → ${remotePath}`));
    } else {
        result.steps.remoteConfig = 'failed';
        if (remoteResult.diagnostics) diagnostics.push(...remoteResult.diagnostics as Diagnostic[]);
    }

    // Configure sync
    const syncResult = runUseSync(workspace, { server: serverId, remotePath, enable: true });
    if (syncResult.ok) {
        result.steps.syncSetup = 'done';
        diagnostics.push(diag('info', `${T('setupSyncEnabled')}: ${serverName} → ${remotePath}`));
    } else {
        result.steps.syncSetup = 'failed';
        if (syncResult.diagnostics) diagnostics.push(...syncResult.diagnostics as Diagnostic[]);
    }

    // Idempotency check
    const activeTarget = loadActiveTarget(workspace);
    const existingRemote = loadRemoteSettings(workspace);
    const alreadyConfigured = existingRemote.selectedServer === serverId
        && existingRemote.remotePaths[serverId] === remotePath
        && activeTarget?.runAt === 'remote';

    let sshOk = false;
    let executionSwitched = false;
    let detectedForjaVersion: string | undefined;
    const server = getServerById(serverId);

    if (alreadyConfigured) {
        sshOk = true;
        executionSwitched = true;
        result.steps.forjaDeploy = 'skipped';
        result.steps.remoteInit = 'skipped';
        result.steps.executionSwitch = 'skipped';
    } else if (server) {
        try {
            const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(server, password);

            const checkResult = await runner.run('test -f ~/.forja/bin/forja && ~/.forja/bin/forja --version 2>/dev/null || echo "NOT_FOUND"', 10000);
            const remoteVersion = checkResult.stdout.trim();
            if (remoteVersion && remoteVersion !== 'NOT_FOUND') {
                result.steps.forjaDeploy = 'skipped';
                detectedForjaVersion = remoteVersion;
                diagnostics.push(diag('info', `Forja ${remoteVersion} ${T('setupForjaAlreadyOnRemote')}`));
            } else {
                const uploader = createScpUploader(server, password);
                const artifact = findBootstrapArtifact();
                if (artifact.ok && artifact.artifactPath) {
                    const bootstrapResult = await executeRemoteBootstrap({ artifact, runner, uploader });
                    if (bootstrapResult.ok) {
                        result.steps.forjaDeploy = 'done';
                        diagnostics.push(diag('info', T('setupForjaDeployed')));
                    } else {
                        result.steps.forjaDeploy = 'failed';
                        diagnostics.push(diag('error',
                            `${T('setupDeployFailed')}: ${bootstrapResult.diagnostics.map((d: any) => d.message).join('; ')}`));
                    }
                } else {
                    result.steps.forjaDeploy = 'failed';
                    diagnostics.push(diag('error', T('setupForjaNotFound')));
                }
            }

            sshOk = result.steps.forjaDeploy !== 'failed';

            if (sshOk) {
                const targetKinds = new Set<string>();
                if (activeTarget) {
                    targetKinds.add(activeTarget.kind);
                } else {
                    const localResult = await runInit(workspace, { plan: true });
                    if (localResult.detected.qtTargets > 0) targetKinds.add('qt');
                    if (localResult.detected.sdkTargets > 0) targetKinds.add('sdk');
                }

                let remoteInitOk = true;
                for (const kind of targetKinds) {
                    const bridgeResult = await executeRemoteBridge({
                        target: kind as 'qt' | 'sdk',
                        action: 'init',
                        args: [],
                        json: true,
                        remotePath,
                        runner,
                        remoteForjaBin: remoteSettings.remoteForjaBin || undefined,
                    });
                    if (!bridgeResult.ok) {
                        remoteInitOk = false;
                        diagnostics.push(diag('warning',
                            `${T('setupRemoteInitFailed')} (${kind}): ${bridgeResult.diagnostics.map((d: any) => d.message).join('; ')}`));
                    }
                }
                result.steps.remoteInit = remoteInitOk ? 'done' : 'failed';
            }

            if (activeTarget && activeTarget.runAt !== 'remote') {
                const execResult = runUseExecution(workspace, false, true);
                result.steps.executionSwitch = execResult.ok ? 'done' : 'failed';
                executionSwitched = execResult.ok;
                if (!execResult.ok && execResult.diagnostics) {
                    diagnostics.push(...execResult.diagnostics as Diagnostic[]);
                }
            } else if (activeTarget?.runAt === 'remote') {
                result.steps.executionSwitch = 'skipped';
                executionSwitched = true;
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            diagnostics.push(diag('error', `${T('setupSshError')}: ${msg}`));
            result.steps.forjaDeploy = result.steps.forjaDeploy || 'failed';
            result.steps.remoteInit = result.steps.remoteInit || 'failed';
            result.steps.executionSwitch = result.steps.executionSwitch || 'failed';
        }
    }

    if (sshOk) {
        result.remote = {
            serverId,
            serverName,
            host: serverHost,
            remotePath,
            syncEnabled: result.steps.syncSetup === 'done',
            forjaDeployed: result.steps.forjaDeploy === 'done' || result.steps.forjaDeploy === 'skipped',
            forjaVersion: detectedForjaVersion,
            executionMode: executionSwitched || activeTarget?.runAt === 'remote' ? 'remote' : 'local',
            configured: true,
        };
    }

    if (diagnostics.length > 0) {
        result.diagnostics = diagnostics;
    }
    const hasErrors = diagnostics.some(d => d.level === 'error');
    if (!hasErrors) {
        result.nextAction = 'forja build';
    }

    const hasFailedSteps = Object.values(result.steps).some(s => s === 'failed');
    if (hasFailedSteps) {
        result.ok = false;
    }

    return result;
}

// ── Text formatters ──

export function formatSetupText(result: SetupResult): string {
    const lines: string[] = [];

    lines.push(T('setupTitle'));
    if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }

    lines.push('');
    lines.push(T('setupLocal'));
    if (result.local.configured) {
        const tc = result.local.toolchain;
        const parts: string[] = [];
        if (tc.qt) parts.push('Qt ✓');
        if (tc.vs) parts.push('VS ✓');
        lines.push(`  ${T('setupConfigured')} (${parts.join(', ')})`);
        lines.push(`  ${result.local.qtTargets} Qt + ${result.local.sdkTargets} SDK ${T('setupTargets')}`);
    } else {
        lines.push(`  ${T('setupConfigFailed')}`);
    }

    // Steps
    lines.push('');
    const stepKeys: Record<string, string> = {
        localConfig: 'setupStepLocalConfig',
    };
    for (const [key, status] of Object.entries(result.steps)) {
        const mappedKey = stepKeys[key];
        const name = mappedKey ? T(mappedKey) : key;
        const icon = status === 'done' ? '✓' : status === 'skipped' ? '–' : '✗';
        lines.push(`  ${icon} ${name}`);
    }

    if (result.diagnostics?.length) {
        lines.push('');
        for (const d of result.diagnostics) {
            lines.push(`  ${T(d.level)}: ${d.message}`);
        }
    }

    if (result.nextAction) {
        lines.push('');
        lines.push(T('next'));
        lines.push(`  ${result.nextAction}`);
    }

    return lines.join('\n');
}

export function formatSetupRemoteText(result: SetupRemoteResult): string {
    const lines: string[] = [];

    lines.push(T('setupRemoteTitle'));
    if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }

    if (result.remote) {
        lines.push('');
        lines.push(T('setupRemote'));
        lines.push(`  ${result.remote.serverName} (${result.remote.host})`);
        lines.push(`  ${T('setupRemotePath')}${result.remote.remotePath}`);
        lines.push(`  ${T('setupSync')}${result.remote.syncEnabled ? T('setupEnabled') : T('setupDisabled')}`);
        if (result.remote.forjaVersion) {
            lines.push(`  ${T('setupForja')}${result.remote.forjaVersion}`);
        }
    }

    // Steps
    lines.push('');
    const stepKeys: Record<string, string> = {
        serverSetup: 'setupStepServer',
        remoteConfig: 'setupStepRemoteConfig',
        syncSetup: 'setupStepSync',
        forjaDeploy: 'setupStepDeploy',
        remoteInit: 'setupStepRemoteInit',
        executionSwitch: 'setupStepExecSwitch',
    };
    for (const [key, status] of Object.entries(result.steps)) {
        const mappedKey = stepKeys[key];
        const name = mappedKey ? T(mappedKey) : key;
        const icon = status === 'done' ? '✓' : status === 'skipped' ? '–' : '✗';
        lines.push(`  ${icon} ${name}`);
    }

    if (result.diagnostics?.length) {
        lines.push('');
        for (const d of result.diagnostics) {
            lines.push(`  ${T(d.level)}: ${d.message}`);
        }
    }

    if (result.nextAction) {
        lines.push('');
        lines.push(T('next'));
        lines.push(`  ${result.nextAction}`);
    }

    return lines.join('\n');
}
