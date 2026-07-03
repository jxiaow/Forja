/**
 * `forja setup` — one-stop initialization (local + remote).
 * `forja setup` — local: scan, detect, select, save config.
 * `forja setup remote` — Phase 1 (local) + Phase 2 (remote: server, deploy, init, switch).
 *
 * Three modes:
 *   - Interactive (TTY): prompts for choices, flags as defaults
 *   - Script (--json + flags): use flags directly, skip questions
 *   - AI agent (--json, no flags): return questions, accept --answers
 */
import * as path from 'path';
import * as fs from 'fs';
import { runInit } from './init';
import { collectTargetCandidates } from './candidates';
import { runRemoteSet } from './remote';
import { runUseExecution } from './use';
import { ForjaJsonResult, Diagnostic, diag, T } from './types';
import { confirm, choose, prompt } from './prompt';
import {
    loadRemoteSettings, saveRemoteSettings,
    loadSyncSettings, saveSyncSettings,
    loadActiveTarget,
    loadQtSettings,
    loadSdkSettings,
} from '../../core/settingsIO';
import { readServers, addServer, getServerById, ServerConfig } from '../../core/serverStore';
import { createSshRunner, createScpUploader } from '../../remote/core/shell';
import { findBootstrapArtifact, executeRemoteBootstrap } from '../../remote/core/bootstrap';
import { executeRemoteBridge } from '../../remote/core/bridge';

// ── Question protocol ──

export interface Question {
    id: string;
    label: string;
    required?: boolean;
    default?: string | number;
    choices?: string[];
    when?: Record<string, string>;
}

type StepStatus = 'done' | 'skipped' | 'failed';

const REMOTE_STEP_KEYS = ['localConfig', 'serverSetup', 'remoteConfig', 'syncSetup', 'forjaDeploy', 'remoteInit', 'executionSwitch'] as const;
type RemoteStepKey = typeof REMOTE_STEP_KEYS[number];

// ── Shared types ──

export interface SetupOptions {
    json?: boolean;
    reset?: boolean;
    answers?: string;
    project?: string;
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    mode?: string;
    arch?: string;
}

export interface SetupResult extends ForjaJsonResult {
    action: 'setup';
    status?: 'needs-input';
    questions?: Question[];
    local: {
        qtTargets: number;
        sdkTargets: number;
        toolchain: { qt?: boolean; vs?: boolean; jom?: boolean; make?: boolean };
        configured: boolean;
    };
    steps: Record<string, StepStatus>;
}

export interface SetupRemoteOptions {
    json?: boolean;
    reset?: boolean;
    answers?: string;
    project?: string;
    qtPath?: string;
    vsInstall?: string;
    jomPath?: string;
    host?: string;
    username?: string;
    port?: number;
    authMode?: string;
    privateKeyPath?: string;
    name?: string;
    remotePath?: string;
    mode?: string;
    arch?: string;
    workspaceMode?: 'staged' | 'legacy';
    workspacePath?: string;
    repos?: string[];
    forjaBin?: string;
    buildOrder?: string[];
    transferServer?: string;
    transferPath?: string;
    transferArtifacts?: string[];
}

export interface SetupRemoteResult extends ForjaJsonResult {
    action: 'setup-remote';
    status?: 'needs-input';
    questions?: Question[];
    local?: {
        qtTargets: number;
        sdkTargets: number;
        toolchain: { qt?: boolean; vs?: boolean; jom?: boolean; make?: boolean };
        configured: boolean;
    };
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
    steps: Partial<Record<RemoteStepKey, StepStatus>>;
}

// ── Helpers ──

function skipAllSteps(result: SetupRemoteResult): void {
    for (const key of REMOTE_STEP_KEYS) {
        if (!result.steps[key]) {
            result.steps[key] = 'skipped';
        }
    }
}

function parsePort(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const n = parseInt(raw, 10);
    return isNaN(n) ? undefined : n;
}

function loadAnswers(answersPath: string, diagnostics?: Diagnostic[]): Record<string, string> | null {
    try {
        const raw = fs.readFileSync(answersPath, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        if (diagnostics) {
            diagnostics.push(diag('error', `${T('setupAnswersLoadFailed')}: ${answersPath} (${e instanceof Error ? e.message : String(e)})`));
        }
        return null;
    }
}

// Resolve server for setup remote.
// Intentional overlap with `forja server add`: --host flag and interactive prompts
// can create servers inline to support one-step remote setup. This trades strict
// command boundary for UX — users can go from zero to remote build in one command.
async function resolveServer(
    workspace: string,
    options: SetupRemoteOptions,
    isInteractive: boolean,
    diagnostics: Diagnostic[],
): Promise<{
    serverId: string;
    serverName: string;
    serverHost: string;
    server: ServerConfig;
} | null> {
    const existingServers = readServers();

    // 1. --host flag: match existing or create new
    if (options.host) {
        const match = existingServers.find(s => s.host === options.host);
        if (match) {
            return { serverId: match.id, serverName: match.name, serverHost: match.host, server: match };
        }
        // Create new server from flags
        if (!options.username) {
            diagnostics.push(diag('error', T('setupHostNeedsUsername')));
            return null;
        }
        try {
            const created = addServer({
                name: options.name || options.host,
                host: options.host,
                username: options.username,
                port: options.port ?? 22,
                authMode: (options.authMode as 'key' | 'password') ?? 'key',
                privateKeyPath: options.privateKeyPath ?? '',
                password: '',
            });
            diagnostics.push(diag('info', `${T('setupServerCreated')}: ${created.name} (${created.host})`));
            return { serverId: created.id, serverName: created.name, serverHost: created.host, server: created };
        } catch (e) {
            diagnostics.push(diag('error', `${T('setupServerCreateFailed')}: ${e instanceof Error ? e.message : String(e)}`));
            return null;
        }
    }

    // 2. Single server → auto-select
    if (existingServers.length === 1) {
        return { serverId: existingServers[0].id, serverName: existingServers[0].name, serverHost: existingServers[0].host, server: existingServers[0] };
    }

    // 3. Multiple servers → interactive selection or error
    if (existingServers.length > 1) {
        if (isInteractive) {
            const server = await choose(
                T('setupSelectServer'),
                existingServers,
                s => `${s.name} (${s.username}@${s.host})`,
            );
            if (server) {
                return { serverId: server.id, serverName: server.name, serverHost: server.host, server };
            }
            diagnostics.push(diag('error', T('setupNoServerSelected')));
            return null;
        }
        diagnostics.push({ level: 'error', message: `${existingServers.length} ${T('setupMultipleServers')}, ${T('setupSpecifyServer')}`, fix: 'forja setup remote' });
        return null;
    }

    // 4. No servers → interactive creation or error
    if (isInteractive) {
        const host = await prompt(T('setupPromptHost'));
        if (!host) {
            diagnostics.push(diag('error', T('setupNoServer')));
            return null;
        }
        const username = await prompt(T('setupPromptUsername'));
        if (!username) {
            diagnostics.push(diag('error', T('setupHostNeedsUsername')));
            return null;
        }
        const portStr = await prompt(T('setupPromptPort'), '22');
        const port = parseInt(portStr || '22', 10);
        if (isNaN(port)) {
            diagnostics.push(diag('error', `${T('idx.invalidPort')}: ${portStr}`));
            return null;
        }

        const authChoice = await choose(T('setupPromptAuthMode'), ['key', 'password'] as const, m => m === 'key' ? T('setupAuthKey') : T('setupAuthPassword'));
        const authMode = authChoice || 'key';

        let privateKeyPath = '';
        let password = '';
        if (authMode === 'key') {
            privateKeyPath = await prompt(T('setupPromptPrivateKey'), '') || '';
        } else {
            password = await prompt(T('setupPromptPassword')) || '';
        }

        const name = await prompt(T('setupPromptName'), host) || host;

        try {
            const created = addServer({
                name,
                host,
                username,
                port,
                authMode: authMode as 'key' | 'password',
                privateKeyPath,
                password,
            });
            diagnostics.push(diag('info', `${T('setupServerCreated')}: ${created.name} (${created.username}@${created.host})`));
            return { serverId: created.id, serverName: created.name, serverHost: created.host, server: created };
        } catch (e) {
            diagnostics.push(diag('error', `${T('setupServerCreateFailed')}: ${e instanceof Error ? e.message : String(e)}`));
            return null;
        }
    }

    diagnostics.push({ level: 'error', message: T('setupNoServer'), fix: 'forja server add' });
    return null;
}

async function deriveRemotePath(workspace: string, serverId: string, server: ServerConfig, options: SetupRemoteOptions, isInteractive: boolean): Promise<string> {
    if (options.remotePath) return options.remotePath;
    const remote = loadRemoteSettings(workspace);
    const sync = loadSyncSettings(workspace);
    const configured = remote.remotePaths[serverId] || sync.remotePaths[serverId];
    if (configured) return configured;
    const derived = `/home/${server.username}/${path.basename(workspace)}`;
    if (isInteractive) {
        const answer = await prompt(T('setupRemotePathPrompt'), derived);
        return answer || derived;
    }
    return derived;
}

function buildLocalQuestions(): Question[] {
    return [
        { id: 'target', label: T('setupQuestionTarget') },
        { id: 'qtPath', label: T('setupQuestionQtPath') },
        { id: 'vsInstall', label: T('setupQuestionVsInstall') },
        { id: 'mode', label: T('setupQuestionMode'), default: 'release', choices: ['debug', 'release'] },
        { id: 'arch', label: T('setupQuestionArch'), default: process.platform === 'win32' ? 'x86' : 'x64', choices: ['x86', 'x64'] },
    ];
}

function filterLocalQuestions(initResult: { detected: { qtTargets: number; sdkTargets: number }; ambiguous?: boolean }, reset: boolean, workspace: string): Question[] {
    const qtConfig = loadQtSettings(workspace);
    const sdkConfig = loadSdkSettings(workspace);
    const questions = buildLocalQuestions();

    // Populate target choices from scanned candidates
    const totalTargets = initResult.detected.qtTargets + initResult.detected.sdkTargets;
    if (totalTargets > 1) {
        const candidates = collectTargetCandidates(workspace);
        const targetQ = questions.find(q => q.id === 'target');
        if (targetQ) {
            targetQ.choices = candidates.map(c => c.project);
        }
    }

    return questions.filter(q => {
        if (q.id === 'target') return totalTargets > 1;
        if (q.id === 'qtPath') return reset || !qtConfig.qtPath;
        if (q.id === 'vsInstall') return reset || (!qtConfig.vsInstall && !sdkConfig.vsInstall);
        if (q.id === 'mode') return reset || !qtConfig.mode;
        if (q.id === 'arch') return reset || !qtConfig.arch;
        return false;
    });
}

function buildRemoteQuestions(): Question[] {
    return [
        { id: 'host', label: T('setupPromptHost'), required: true },
        { id: 'username', label: T('setupPromptUsername'), required: true },
        { id: 'port', label: T('setupPromptPort'), default: 22 },
        { id: 'authMode', label: T('setupPromptAuthMode'), default: 'key', choices: ['key', 'password'] },
        { id: 'privateKeyPath', label: T('setupPromptPrivateKey'), default: '~/.ssh/id_rsa', when: { authMode: 'key' } },
        { id: 'password', label: T('setupPromptPassword'), when: { authMode: 'password' } },
        { id: 'name', label: T('setupPromptName') },
        { id: 'remotePath', label: T('setupRemotePathPrompt') },
        { id: 'mode', label: T('setupQuestionMode'), default: 'release', choices: ['debug', 'release'] },
        { id: 'arch', label: T('setupQuestionArch'), default: process.platform === 'win32' ? 'x86' : 'x64', choices: ['x86', 'x64'] },
    ];
}

function filterRemoteQuestions(questions: Question[], knownAuthMode?: string): Question[] {
    return questions.filter(q => {
        if (!q.when) return true;
        for (const [key, value] of Object.entries(q.when)) {
            if (knownAuthMode && key === 'authMode' && knownAuthMode !== value) return false;
        }
        return true;
    });
}

// ── Local setup ──

export async function runSetup(workspace: string, options: SetupOptions = {}): Promise<SetupResult> {
    const result: SetupResult = {
        ok: true,
        action: 'setup',
        workspace,
        local: { qtTargets: 0, sdkTargets: 0, toolchain: {}, configured: false },
        steps: {},
    };

    const isInteractive = !options.json && process.stdin.isTTY === true;

    // Load answers if provided
    const diagnostics: Diagnostic[] = [];
    const answers = options.answers ? loadAnswers(options.answers, diagnostics) : null;

    if (options.answers && !answers) {
        result.ok = false;
        result.diagnostics = diagnostics;
        return result;
    }

    // Merge flags + answers into effective options
    const effectiveMode = options.mode || answers?.mode;
    const effectiveArch = options.arch || answers?.arch;
    const effectiveProject = options.project || answers?.target;

    const initResult = await runInit(workspace, {
        interactive: isInteractive,
        mode: effectiveMode,
        arch: effectiveArch,
        project: effectiveProject,
        qtPath: options.qtPath || answers?.qtPath,
        vsInstall: options.vsInstall || answers?.vsInstall,
        jomPath: options.jomPath || answers?.jomPath,
        reset: options.reset,
    });

    result.local = {
        qtTargets: initResult.detected.qtTargets,
        sdkTargets: initResult.detected.sdkTargets,
        toolchain: initResult.detected.toolchain,
        configured: initResult.ok,
    };
    result.steps.localConfig = initResult.ok ? 'done' : 'failed';

    if (!initResult.ok) {
        result.ok = false;
        if (initResult.diagnostics) diagnostics.push(...initResult.diagnostics);
        if (initResult.nextAction) result.nextAction = initResult.nextAction;
        result.diagnostics = diagnostics;
        return result;
    }

    if (initResult.diagnostics) {
        diagnostics.push(...initResult.diagnostics);
    }

    // If ambiguous and --json without answers, return questions
    if (initResult.ambiguous && options.json && !answers && !effectiveProject) {
        result.ok = false;
        result.status = 'needs-input';
        result.questions = filterLocalQuestions(initResult, !!options.reset, workspace);
        result.nextAction = 'forja setup --json --answers <answers.json>';
        result.diagnostics = diagnostics;
        return result;
    }

    if (diagnostics.length > 0) {
        result.diagnostics = diagnostics;
    }

    if (initResult.ambiguous) {
        // Ambiguous: user needs to resolve target selection
        if (options.json && answers) {
            // --json mode with answers, but answers didn't include target
            result.nextAction = 'forja setup --json --answers <answers.json>';
        } else {
            // Interactive mode, user didn't choose from prompt
            result.nextAction = 'forja setup';
        }
    } else {
        result.nextAction = 'forja build';
    }

    return result;
}

// ── Remote setup ──

export async function runSetupRemote(workspace: string, options: SetupRemoteOptions = {}): Promise<SetupRemoteResult> {
    const result: SetupRemoteResult = {
        ok: true,
        action: 'setup-remote',
        workspace,
        steps: {},
    };

    const isInteractive = !options.json && process.stdin.isTTY === true;
    const diagnostics: Diagnostic[] = [];
    const answers = options.answers ? loadAnswers(options.answers, diagnostics) : null;

    if (options.answers && !answers) {
        result.ok = false;
        result.diagnostics = diagnostics;
        skipAllSteps(result);
        return result;
    }

    // ── Phase 1: Local initialization ──
    const effectiveMode = options.mode || answers?.mode;
    const effectiveArch = options.arch || answers?.arch;
    const effectiveProject = options.project || answers?.target;
    const effectiveAuthMode = options.authMode || answers?.authMode;

    const initResult = await runInit(workspace, {
        interactive: isInteractive,
        mode: effectiveMode,
        arch: effectiveArch,
        project: effectiveProject,
        qtPath: options.qtPath || answers?.qtPath,
        vsInstall: options.vsInstall || answers?.vsInstall,
        jomPath: options.jomPath || answers?.jomPath,
        reset: options.reset,
    });

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
        if (initResult.nextAction) result.nextAction = initResult.nextAction;
        skipAllSteps(result);
        result.steps.localConfig = 'failed';
        return result;
    }

    // If local is ambiguous and --json without answers, return questions
    if (initResult.ambiguous && options.json && !answers && !effectiveProject) {
        result.ok = false;
        result.status = 'needs-input';
        const localQ = filterLocalQuestions(initResult, !!options.reset, workspace);
        result.questions = [...localQ, ...filterRemoteQuestions(buildRemoteQuestions(), effectiveAuthMode)];
        result.nextAction = 'forja setup remote --json --answers <answers.json>';
        skipAllSteps(result);
        return result;
    }

    if (initResult.diagnostics) {
        diagnostics.push(...initResult.diagnostics);
    }

    // ── Phase 2: Remote configuration ──

    // Merge server flags from options + answers
    const serverOptions: SetupRemoteOptions = {
        ...options,
        host: options.host || answers?.host,
        username: options.username || answers?.username,
        port: options.port ?? parsePort(answers?.port),
        authMode: options.authMode || answers?.authMode,
        privateKeyPath: options.privateKeyPath || answers?.privateKeyPath,
        name: options.name || answers?.name,
        remotePath: options.remotePath || answers?.remotePath,
    };

    // Resolve server
    const resolved = await resolveServer(workspace, serverOptions, isInteractive, diagnostics);
    if (!resolved) {
        skipAllSteps(result);
        result.ok = false;
        result.diagnostics = diagnostics;

        // If --json and no server, return questions
        if (options.json && !answers && !options.host) {
            result.status = 'needs-input';
            result.questions = filterRemoteQuestions(buildRemoteQuestions(), effectiveAuthMode);
            result.nextAction = 'forja setup remote --json --answers <answers.json>';
        } else {
            const existingServers = readServers();
            result.nextAction = existingServers.length > 0 ? 'forja server' : 'forja server add';
        }
        return result;
    }

    const { serverId, serverName, serverHost, server } = resolved;
    result.steps.serverSetup = 'done';

    // Derive remote path
    const remotePath = await deriveRemotePath(workspace, serverId, server, serverOptions, isInteractive);

    // Interactive confirmation
    if (isInteractive) {
        console.log(`\n${T('setupRemoteTitle')}`);
        console.log(`  ${T('serverLabel')} ${serverName} (${serverHost})`);
        console.log(`  ${T('remotePathLabel')}${remotePath}`);
        const proceed = await confirm(T('setupConfirmRemote'), true);
        if (!proceed) {
            diagnostics.push(diag('info', T('setupSkippedRemote')));
            skipAllSteps(result);
            result.remote = {
                serverId,
                serverName,
                host: serverHost,
                remotePath,
                syncEnabled: false,
                forjaDeployed: false,
                executionMode: 'local',
                configured: false,
            };
            result.diagnostics = diagnostics;
            return result;
        }
    }

    // Configure remote execution
    let remoteResult;
    try {
        remoteResult = runRemoteSet(workspace, { server: serverId, remotePath });
    } catch (e) {
        remoteResult = { ok: false, diagnostics: [diag('error', `${T('setupRemoteConfigFailed')}: ${e instanceof Error ? e.message : String(e)}`)] };
    }
    if (remoteResult.ok) {
        result.steps.remoteConfig = 'done';
        diagnostics.push(diag('info', `${T('setupRemoteConfigured')}: ${serverName} → ${remotePath}`));
    } else {
        result.steps.remoteConfig = 'failed';
        if (remoteResult.diagnostics) diagnostics.push(...remoteResult.diagnostics);
        skipAllSteps(result);
        result.ok = false;
        result.diagnostics = diagnostics;
        return result;
    }

    // Save advanced remote config (workspace/repo/forja-bin/build-order/transfer)
    try {
        const remote = loadRemoteSettings(workspace);
        let advancedChanged = false;
        if (options.workspaceMode) {
            remote.workspaceMode = options.workspaceMode;
            advancedChanged = true;
        }
        if (options.workspacePath) {
            remote.remoteWorkspace = options.workspacePath;
            advancedChanged = true;
        }
        if (options.repos && options.repos.length > 0) {
            for (const repoSpec of options.repos) {
                const parts = repoSpec.split(':');
                if (parts.length >= 3) {
                    const [localName, remoteName, roleStr] = parts;
                    const role = roleStr.split('=')[0] as 'primary' | 'mapped' | 'remote-only' | 'existing-remote' | 'skip';
                    const pathMatch = roleStr.match(/path=(.+)/);
                    const repo: import('../../core/settingsIO').RemoteRepoSettings = { localName, remoteName, role };
                    if (pathMatch) { repo.remotePath = pathMatch[1]; }
                    remote.repos = [...remote.repos.filter(r => r.localName !== localName), repo];
                    advancedChanged = true;
                }
            }
        }
        if (options.forjaBin) {
            remote.remoteForjaBin = options.forjaBin;
            advancedChanged = true;
        }
        if (options.buildOrder && options.buildOrder.length > 0) {
            const items: import('../../core/settingsIO').RemoteBuildOrderItem[] = [];
            for (const spec of options.buildOrder) {
                const [target, action] = spec.split(':');
                if (target === 'qt' || target === 'sdk') {
                    items.push({ target, action: (action || 'build') as import('../../core/settingsIO').RemoteBuildOrderItem['action'], args: [] });
                }
            }
            if (items.length > 0) {
                remote.buildOrder = items;
                advancedChanged = true;
            }
        }
        if (options.transferServer && options.transferPath && options.transferArtifacts && options.transferArtifacts.length > 0) {
            const server = getServerById(options.transferServer);
            if (server) {
                remote.transfer = { deployServer: server.id, deployPath: options.transferPath, artifacts: options.transferArtifacts };
                advancedChanged = true;
            }
        }
        if (advancedChanged) {
            saveRemoteSettings(workspace, remote);
            diagnostics.push(diag('info', T('setupAdvancedRemoteConfigured')));
        }
    } catch (e) {
        diagnostics.push(diag('warning', `${T('setupAdvancedRemoteFailed')}: ${e instanceof Error ? e.message : String(e)}`));
    }

    // Configure sync (inlined from former runUseSync)
    let syncResult: { ok: boolean; diagnostics?: Diagnostic[] };
    try {
        const sync = loadSyncSettings(workspace);
        sync.selectedServer = serverId;
        sync.remotePaths[serverId] = remotePath;
        sync.enabled = true;
        saveSyncSettings(workspace, sync);
        syncResult = { ok: true };
    } catch (e) {
        syncResult = { ok: false, diagnostics: [diag('error', `${T('setupSyncConfigFailed')}: ${e instanceof Error ? e.message : String(e)}`)] };
    }
    if (syncResult.ok) {
        result.steps.syncSetup = 'done';
        diagnostics.push(diag('info', `${T('setupSyncEnabled')}: ${serverName} → ${remotePath}`));
    } else {
        result.steps.syncSetup = 'failed';
        if (syncResult.diagnostics) diagnostics.push(...syncResult.diagnostics);
        skipAllSteps(result);
        result.ok = false;
        result.diagnostics = diagnostics;
        return result;
    }

    // Check if remote is already fully configured — skip deploy/init/switch (idempotency)
    const activeTarget = loadActiveTarget(workspace);
    const existingRemote = loadRemoteSettings(workspace);
    const alreadyConfigured = !options.reset
        && existingRemote.selectedServer === serverId
        && existingRemote.remotePaths[serverId] === remotePath
        && activeTarget?.runAt === 'remote';

    let detectedForjaVersion: string | undefined;

    if (alreadyConfigured) {
        // Verify SSH connectivity even when already configured
        const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
        const runner = createSshRunner(server, password);
        let sshReachable = false;
        try {
            const checkResult = await runner.run('echo OK', 10000);
            sshReachable = checkResult.stdout.trim() === 'OK';
        } catch {
            sshReachable = false;
        }

        if (sshReachable) {
            result.steps.forjaDeploy = 'skipped';
            result.steps.remoteInit = 'skipped';
            result.steps.executionSwitch = 'skipped';
            // Detect existing Forja version on remote (reuse same runner)
            try {
                const verResult = await runner.run('~/.forja/bin/forja --version 2>/dev/null || echo "UNKNOWN"', 10000);
                const ver = verResult.stdout.trim();
                if (ver && ver !== 'UNKNOWN') detectedForjaVersion = ver;
            } catch { /* version detection is best-effort */ }
        } else {
            diagnostics.push(diag('error', `${T('setupSshUnreachable')} (${T('setupSshVerifyExisting')})`));
            result.steps.forjaDeploy = 'failed';
            result.steps.remoteInit = 'failed';
            result.steps.executionSwitch = 'failed';
            result.ok = false;
            result.remote = {
                serverId,
                serverName,
                host: serverHost,
                remotePath,
                syncEnabled: true,
                forjaDeployed: false,
                executionMode: 'remote',
                configured: false,
            };
            result.diagnostics = diagnostics;
            result.nextAction = 'forja doctor --remote';
            return result;
        }
    } else {
        try {
            const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
            const runner = createSshRunner(server, password);

            // Check / deploy Forja
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
                            `${T('setupDeployFailed')}: ${bootstrapResult.diagnostics.map(d => d.message).join('; ')}`));
                    }
                } else {
                    result.steps.forjaDeploy = 'failed';
                    diagnostics.push(diag('error', T('setupForjaNotFound')));
                }
            }

            const deployFailed = result.steps.forjaDeploy === 'failed';
            let remoteInitOk = true;

            // Remote init
            if (!deployFailed) {
                const targetKinds = new Set<string>();
                if (activeTarget) {
                    targetKinds.add(activeTarget.kind);
                } else {
                    if (initResult.detected.qtTargets > 0) targetKinds.add('qt');
                    if (initResult.detected.sdkTargets > 0) targetKinds.add('sdk');
                }

                for (const kind of targetKinds) {
                    const bridgeResult = await executeRemoteBridge({
                        target: kind as 'qt' | 'sdk',
                        action: 'init',
                        args: [],
                        json: true,
                        remotePath,
                        runner,
                        remoteForjaBin: existingRemote.remoteForjaBin || undefined,
                    });
                    if (!bridgeResult.ok) {
                        remoteInitOk = false;
                        diagnostics.push(diag('error',
                            `${T('setupRemoteInitFailed')} (${kind}): ${bridgeResult.diagnostics.map(d => d.message).join('; ')}`));
                    }
                }
                result.steps.remoteInit = remoteInitOk ? 'done' : 'failed';
            } else {
                result.steps.remoteInit = 'failed';
                remoteInitOk = false;
            }

            // Execution switch — only if deploy and init succeeded
            if (deployFailed || !remoteInitOk) {
                result.steps.executionSwitch = 'skipped';
            } else if (activeTarget && activeTarget.runAt !== 'remote') {
                const execResult = runUseExecution(workspace, false, true);
                result.steps.executionSwitch = execResult.ok ? 'done' : 'failed';
                if (!execResult.ok && execResult.diagnostics) {
                    diagnostics.push(...execResult.diagnostics);
                }
            } else {
                result.steps.executionSwitch = 'skipped';
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            diagnostics.push(diag('error', `${T('setupSshError')}: ${msg}`));
            result.steps.forjaDeploy = result.steps.forjaDeploy || 'failed';
            result.steps.remoteInit = result.steps.remoteInit || 'failed';
            result.steps.executionSwitch = result.steps.executionSwitch || 'failed';
        }
    }

    // Build remote summary — always populate result.remote so users see intermediate state
    const hasFailedSteps = Object.values(result.steps).some(s => s === 'failed');

    // Re-read activeTarget to reflect any changes from runUseExecution
    const finalActiveTarget = loadActiveTarget(workspace);

    result.remote = {
        serverId,
        serverName,
        host: serverHost,
        remotePath,
        syncEnabled: result.steps.syncSetup === 'done',
        forjaDeployed: !hasFailedSteps && (result.steps.forjaDeploy === 'done' || result.steps.forjaDeploy === 'skipped'),
        forjaVersion: detectedForjaVersion,
        executionMode: finalActiveTarget?.runAt === 'remote' ? 'remote' : 'local',
        configured: !hasFailedSteps,
    };

    if (diagnostics.length > 0) {
        result.diagnostics = diagnostics;
    }

    const hasErrors = diagnostics.some(d => d.level === 'error');
    if (hasFailedSteps || hasErrors) {
        result.ok = false;
    }

    if (!hasFailedSteps && !hasErrors) {
        result.nextAction = 'forja build';
    }

    return result;
}

// ── Text formatters ──

function formatQuestionsLines(questions: Question[]): string[] {
    const lines: string[] = [];
    lines.push('');
    lines.push(T('setupNeedsInput'));
    for (const q of questions) {
        const choices = q.choices ? ` [${q.choices.join('|')}]` : '';
        const def = q.default !== undefined ? ` (${T('setupDefault')}: ${q.default})` : '';
        const req = q.required ? ` ${T('setupRequired')}` : '';
        lines.push(`  ${q.label}${choices}${def}${req}`);
    }
    return lines;
}

const TOOLCHAIN_LABELS: Array<{ key: keyof NonNullable<SetupResult['local']['toolchain']>; label: string }> = [
    { key: 'qt', label: 'Qt' },
    { key: 'vs', label: 'VS' },
    { key: 'jom', label: 'jom' },
    { key: 'make', label: 'make' },
];

function formatLocalSection(lines: string[], local: SetupResult['local']): void {
    lines.push(T('setupLocal'));
    if (local.configured) {
        const tc = local.toolchain;
        const parts: string[] = [];
        for (const { key, label } of TOOLCHAIN_LABELS) {
            if (tc[key]) parts.push(`${label} ✓`);
        }
        const tcInfo = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        lines.push(`  ${T('setupConfigured')}${tcInfo}`);
        lines.push(`  ${local.qtTargets} Qt + ${local.sdkTargets} SDK ${T('setupTargets')}`);
    } else {
        lines.push(`  ${T('setupConfigFailed')}`);
    }
}

export function formatSetupText(result: SetupResult): string {
    const lines: string[] = [];

    lines.push(T('setupTitle'));
    if (result.workspace) { lines.push(`${T('workspace')}${result.workspace}`); }

    formatLocalSection(lines, result.local);

    if (result.status === 'needs-input' && result.questions) {
        lines.push(...formatQuestionsLines(result.questions));
    }

    // Steps
    if (Object.keys(result.steps).length > 0) {
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

    if (result.local) {
        formatLocalSection(lines, result.local);
    }

    if (result.status === 'needs-input' && result.questions) {
        lines.push(...formatQuestionsLines(result.questions));
    } else if (result.remote) {
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
    if (Object.keys(result.steps).length > 0) {
        lines.push('');
        lines.push(T('setupSteps'));
        const stepKeys: Record<string, string> = {
            localConfig: 'setupStepLocalConfig',
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
