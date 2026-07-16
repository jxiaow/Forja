/**
 * Remote execution helpers for VSCode commands.
 * Extracted from commands.ts to keep that file focused on command registration.
 */
import * as vscode from 'vscode';
import { executeRemotePlan } from '../remote/core/plan';
import { resolveRemoteConfig } from '../remote/core/config';
import { createSshRunner, createScpUploader } from '../remote/core/shell';
import { executePreparedRemoteAction } from '../remote/core/pipeline';
import { buildRemoteTest } from '../remote/core/status';
import { loadSyncSettings } from '../core/settingsIO';
import { getActiveTarget } from '../cli/commands/activeTarget';
import { publishRemoteProblems } from '../remote/vscode/diagnostics';
import { createLogger } from './logger';

const logger = createLogger('RemoteHelpers');

let remoteDiagnostics: vscode.DiagnosticCollection | null = null;

export function initRemoteDiagnostics(): vscode.DiagnosticCollection {
    remoteDiagnostics = vscode.languages.createDiagnosticCollection('forja.remote');
    return remoteDiagnostics;
}

function resolveRemoteIgnore(workspace: string): string[] {
    const sync = loadSyncSettings(workspace);
    return sync.ignore || [];
}

export async function executeRemoteBuild(
    workspace: string,
    kind: 'qt' | 'cpp',
    remoteAction: 'build' | 'rebuild' | 'clean' | 'qmake',
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Forja Remote: ${remoteAction}`,
        cancellable: false,
    }, async () => {
        try {
            const result = await executeRemotePlan({
                workspace,
                target: kind,
                action: remoteAction,
                owner: 'vscode',
                ignore: resolveRemoteIgnore(workspace),
            });
            publishProblemsIfApplicable(workspace, result);
            if (!result.ok) {
                const msg = result.diagnostics.map(d => d.message).filter(Boolean).slice(0, 3).join('\n');
                vscode.window.showErrorMessage('Forja Remote: ' + (msg || `${remoteAction} failed`));
            } else {
                vscode.window.showInformationMessage(`Forja Remote: ${remoteAction} 完成`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(message);
            vscode.window.showErrorMessage('Forja Remote: ' + message);
        }
    });
}

export async function executeRemoteActionWithProgress(
    workspace: string,
    kind: 'qt' | 'cpp',
    action: 'build' | 'rebuild' | 'clean' | 'run' | 'stop' | 'status',
    label: string,
    args?: string[],
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Forja Remote: ${label}`,
        cancellable: false,
    }, async () => {
        try {
            const result = await executeRemotePlan({
                workspace,
                target: kind,
                action,
                args,
                owner: 'vscode',
                ignore: resolveRemoteIgnore(workspace),
            });
            if (!result.ok) {
                const msg = result.diagnostics.map(d => d.message).filter(Boolean).slice(0, 3).join('\n');
                vscode.window.showErrorMessage('Forja Remote: ' + (msg || `${label} failed`));
            } else {
                vscode.window.showInformationMessage(`Forja Remote: ${label} 完成`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(message);
            vscode.window.showErrorMessage('Forja Remote: ' + message);
        }
    });
}

export function startForegroundRemoteRun(
    context: vscode.ExtensionContext,
    workspace: string,
    kind: 'qt' | 'cpp' = 'qt',
): void {
    let activeChild: { kill(signal?: NodeJS.Signals): boolean } | null = null;
    let closed = false;
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number>();
    const pty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
            void runForegroundRemote(workspace, kind, {
                write: text => writeEmitter.fire(toTerminalText(text)),
                onSpawn: child => { activeChild = child; },
            }).then(code => {
                if (!closed) { closeEmitter.fire(code); }
            });
        },
        close: () => {
            closed = true;
            try { activeChild?.kill('SIGTERM'); } catch { /* child may already be closed */ }
        },
    };
    const terminal = vscode.window.createTerminal({ name: 'Forja Remote Run', pty });
    terminal.show();
    context.subscriptions.push(terminal);
    logger.info('forja.run: started foreground pty for ' + workspace);
}

async function runForegroundRemote(
    workspace: string,
    kind: 'qt' | 'cpp',
    terminal: { write(text: string): void; onSpawn(child: { kill(signal?: NodeJS.Signals): boolean }): void }
): Promise<number> {
    terminal.write('Forja Remote Run\r\n');
    const resolved = resolveRemoteConfig(workspace);
    if (!resolved.config) {
        writeDiagnosticsToTerminal(terminal, resolved.diagnostics, resolved.nextAction);
        return 1;
    }

    const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
    const runner = createSshRunner(resolved.config.server, password, {
        onStdout: terminal.write,
        onStderr: terminal.write,
        onSpawn: terminal.onSpawn,
    });
    const uploader = createScpUploader(resolved.config.server, password);

    terminal.write('Preparing remote workspace...\r\n');
    const preflight = await buildRemoteTest({ workspace, config: resolved.config, runner });
    if (!preflight.ok) {
        writeDiagnosticsToTerminal(terminal, preflight.diagnostics, preflight.nextAction);
        return 1;
    }

    const result = await executePreparedRemoteAction({
        workspace: resolved.config.workspace,
        remotePath: resolved.config.remotePath,
        ignore: resolved.config.ignore,
        owner: 'vscode',
        target: kind,
        action: 'run',
        args: [],
        json: false,
        stream: true,
        runner,
        uploader,
        activeProject: getActiveTarget(resolved.config.workspace)?.project,
    });

    if (remoteDiagnostics && result.actionRemotePath) {
        const count = publishRemoteProblems(remoteDiagnostics, resolved.config.workspace, result.actionRemotePath, result);
        if (count > 0) { logger.info('forja.run: published ' + count + ' remote problem(s)'); }
    }

    if (!result.ok) {
        writeDiagnosticsToTerminal(terminal, result.diagnostics, result.nextAction);
        return 1;
    }
    terminal.write('\r\nForja Remote Run exited.\r\n');
    return 0;
}

function writeDiagnosticsToTerminal(
    terminal: { write(text: string): void },
    diagnostics: Array<{ level: string; message: string }>,
    nextAction?: string
): void {
    for (const d of diagnostics) {
        terminal.write(`${d.level}: ${d.message}\r\n`);
    }
    if (nextAction) {
        terminal.write('Next: ' + nextAction + '\r\n');
    }
}

function toTerminalText(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

function publishProblemsIfApplicable(
    workspace: string,
    result: { ok: boolean; stdout?: string; stderr?: string; exitCode?: number; actionRemotePath?: string }
): void {
    if (!remoteDiagnostics) { return; }
    const source = {
        remote: {
            result: null,
            stdout: result.stdout || '',
            stderr: result.stderr || '',
        },
    };
    // Use actionRemotePath for proper path mapping in staged workspace mode
    const remotePath = result.actionRemotePath || workspace;
    const count = publishRemoteProblems(remoteDiagnostics, workspace, remotePath, source);
    if (count > 0) { logger.info('published ' + count + ' remote problem(s)'); }
}
