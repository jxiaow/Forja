import * as vscode from 'vscode';
import { executeRemoteBridge, RemoteBridgeAction, RemoteBridgeTarget } from '../core/bridge';
import { resolveRemoteConfig } from '../core/config';
import { executePreparedRemoteAction, ExecutePreparedRemoteActionResult } from '../core/pipeline';
import { createScpUploader, createSshRunner } from '../core/shell';
import { buildRemoteStatus, buildRemoteTest } from '../core/status';
import { RemoteDiagnostic } from '../core/types';
import { createLogger } from '../../vscode/logger';
import { getExecutionLocation, initExecutionLocation, setExecutionLocation } from '../../vscode/executionLocation';
import { publishRemoteProblems } from './diagnostics';

const logger = createLogger('RemoteCommands');
let remoteDiagnostics: vscode.DiagnosticCollection | null = null;

type RemoteVscodeCommandKind = 'status' | 'test' | 'preparedAction' | 'bridgeAction' | 'foregroundTerminal' | 'executionLocation';

interface RemoteVscodeCommandDefinition {
    id: string;
    title: string;
    kind: RemoteVscodeCommandKind;
    target?: RemoteBridgeTarget;
    remoteAction?: RemoteBridgeAction;
    args?: string[];
    executionLocation?: 'local' | 'remote' | 'pick';
}

export const REMOTE_VSCODE_COMMANDS: readonly RemoteVscodeCommandDefinition[] = [
    { id: 'compilot.remote.execution.pick', title: 'Compilot: Select Execution Location', kind: 'executionLocation', executionLocation: 'pick' },
    { id: 'compilot.remote.execution.local', title: 'Compilot: Use Local Execution', kind: 'executionLocation', executionLocation: 'local' },
    { id: 'compilot.remote.execution.remote', title: 'Compilot: Use Remote Execution', kind: 'executionLocation', executionLocation: 'remote' },
    { id: 'compilot.remote.status', title: 'Compilot Remote: Status', kind: 'status' },
    { id: 'compilot.remote.test', title: 'Compilot Remote: Test', kind: 'test' },
    { id: 'compilot.remote.qt.build', title: 'Compilot Remote Qt: Build', kind: 'preparedAction', target: 'qt', remoteAction: 'build' },
    { id: 'compilot.remote.qt.clean', title: 'Compilot Remote Qt: Clean', kind: 'preparedAction', target: 'qt', remoteAction: 'clean' },
    { id: 'compilot.remote.qt.qmake', title: 'Compilot Remote Qt: QMake', kind: 'preparedAction', target: 'qt', remoteAction: 'qmake' },
    { id: 'compilot.remote.qt.run', title: 'Compilot Remote Qt: Run', kind: 'foregroundTerminal', target: 'qt', remoteAction: 'run' },
    { id: 'compilot.remote.qt.runDetached', title: 'Compilot Remote Qt: Run Detached', kind: 'preparedAction', target: 'qt', remoteAction: 'run', args: ['--detach'] },
    { id: 'compilot.remote.qt.stop', title: 'Compilot Remote Qt: Stop', kind: 'bridgeAction', target: 'qt', remoteAction: 'stop' },
    { id: 'compilot.remote.qt.ps', title: 'Compilot Remote Qt: PS', kind: 'bridgeAction', target: 'qt', remoteAction: 'ps' },
    { id: 'compilot.remote.sdk.build', title: 'Compilot Remote SDK: Build', kind: 'preparedAction', target: 'sdk', remoteAction: 'build' },
    { id: 'compilot.remote.sdk.rebuild', title: 'Compilot Remote SDK: Rebuild', kind: 'preparedAction', target: 'sdk', remoteAction: 'rebuild' },
    { id: 'compilot.remote.sdk.clean', title: 'Compilot Remote SDK: Clean', kind: 'preparedAction', target: 'sdk', remoteAction: 'clean' }
];

export function registerRemoteCommands(context: vscode.ExtensionContext): void {
    initExecutionLocation(context);
    remoteDiagnostics = vscode.languages.createDiagnosticCollection('compilot.remote');
    context.subscriptions.push(remoteDiagnostics);
    for (const command of REMOTE_VSCODE_COMMANDS) {
        context.subscriptions.push(vscode.commands.registerCommand(command.id, () => executeRemoteVscodeCommand(context, command)));
    }
}

async function executeRemoteVscodeCommand(context: vscode.ExtensionContext, command: RemoteVscodeCommandDefinition): Promise<void> {
    if (command.kind === 'executionLocation') {
        await executeExecutionLocationCommand(command);
        return;
    }
    const workspace = resolveWorkspaceRoot();
    if (!workspace) {
        vscode.window.showWarningMessage('Compilot Remote: 请先打开工作区');
        return;
    }

    if (command.kind === 'foregroundTerminal') {
        startForegroundRemoteQtRun(context, workspace);
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: command.title,
        cancellable: false
    }, async () => {
        try {
            const result = await executeCommand(workspace, command);
            publishProblemsIfApplicable(command, result);
            reportResult(command, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(message);
            vscode.window.showErrorMessage('Compilot Remote: ' + message);
        }
    });
}

async function executeExecutionLocationCommand(command: RemoteVscodeCommandDefinition): Promise<void> {
    if (command.executionLocation === 'pick') {
        const current = getExecutionLocation();
        const picked = await vscode.window.showQuickPick([
            { label: '$(home) Local', description: current === 'local' ? '当前' : '', value: 'local' as const },
            { label: '$(cloud) Remote', description: current === 'remote' ? '当前' : '', value: 'remote' as const }
        ], { placeHolder: '选择 Compilot 执行位置' });
        if (!picked) { return; }
        await setExecutionLocation(picked.value);
        vscode.window.showInformationMessage('Compilot: 执行位置已切换到 ' + (picked.value === 'remote' ? 'Remote' : 'Local'));
        return;
    }
    const location = command.executionLocation === 'remote' ? 'remote' : 'local';
    await setExecutionLocation(location);
    vscode.window.showInformationMessage('Compilot: 执行位置已切换到 ' + (location === 'remote' ? 'Remote' : 'Local'));
}

function startForegroundRemoteQtRun(context: vscode.ExtensionContext, workspace: string): void {
    let activeChild: { kill(signal?: NodeJS.Signals): boolean } | null = null;
    let closed = false;
    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number>();
    const pty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
            void runForegroundRemoteQtRun(workspace, {
                write: text => writeEmitter.fire(toTerminalText(text)),
                onSpawn: child => { activeChild = child; }
            }).then(code => {
                if (!closed) { closeEmitter.fire(code); }
            });
        },
        close: () => {
            closed = true;
            try { activeChild?.kill('SIGTERM'); } catch { /* child may already be closed */ }
        }
    };
    const terminal = vscode.window.createTerminal({
        name: 'Compilot Remote Qt Run',
        pty
    });
    terminal.show();
    context.subscriptions.push(writeEmitter, closeEmitter);
    logger.info('compilot.remote.qt.run: started foreground pty for ' + workspace);
}

async function runForegroundRemoteQtRun(
    workspace: string,
    terminal: { write(text: string): void; onSpawn(child: { kill(signal?: NodeJS.Signals): boolean }): void }
): Promise<number> {
    terminal.write('Compilot Remote Qt Run\r\n');
    const resolved = resolveRemoteConfig(workspace);
    if (!resolved.config) {
        writeDiagnostics(terminal, resolved.diagnostics, resolved.nextActions);
        return 1;
    }

    const password = resolved.config.server.password || process.env.COMPILOT_SSH_PASSWORD || null;
    const runner = createSshRunner(resolved.config.server, password, {
        onStdout: terminal.write,
        onStderr: terminal.write,
        onSpawn: terminal.onSpawn
    });
    const uploader = createScpUploader(resolved.config.server, password);

    terminal.write('Preparing remote workspace...\r\n');
    const preflight = await buildRemoteTest({ workspace, config: resolved.config, runner });
    if (!preflight.ok) {
        writeDiagnostics(terminal, preflight.diagnostics, preflight.nextActions);
        return 1;
    }

    const result = await executePreparedRemoteAction({
        workspace: resolved.config.workspace,
        remotePath: resolved.config.remotePath,
        ignore: resolved.config.ignore,
        owner: 'vscode',
        target: 'qt',
        action: 'run',
        args: [],
        json: false,
        stream: true,
        runner,
        uploader
    });
    publishProblemsIfApplicable(REMOTE_VSCODE_COMMANDS.find(item => item.id === 'compilot.remote.qt.run')!, { ...result, workspace: resolved.config.workspace, remotePath: resolved.config.remotePath });
    if (!result.ok) {
        writeDiagnostics(terminal, result.diagnostics, result.nextActions);
        return 1;
    }
    terminal.write('\r\nCompilot Remote Qt Run exited.\r\n');
    return 0;
}

function writeDiagnostics(terminal: { write(text: string): void }, diagnostics: RemoteDiagnostic[], nextActions: string[]): void {
    for (const diagnostic of diagnostics) {
        terminal.write(`${diagnostic.level}: ${diagnostic.message}\r\n`);
    }
    if (nextActions.length > 0) {
        terminal.write('Next: ' + nextActions.join('；') + '\r\n');
    }
}

function toTerminalText(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

async function executeCommand(workspace: string, command: RemoteVscodeCommandDefinition): Promise<{ ok?: boolean; overall?: string; diagnostics?: RemoteDiagnostic[]; nextActions?: string[]; workspace?: string; remotePath?: string; stdout?: string; stderr?: string; remote?: { result?: unknown; stdout?: string; stderr?: string } }> {
    if (command.kind === 'status') {
        return buildRemoteStatus({ workspace });
    }
    if (command.kind === 'test') {
        return buildRemoteTest({ workspace });
    }

    const resolved = resolveRemoteConfig(workspace);
    if (!resolved.config) {
        return { ok: false, diagnostics: resolved.diagnostics, nextActions: resolved.nextActions };
    }

    const password = resolved.config.server.password || process.env.COMPILOT_SSH_PASSWORD || null;
    const runner = createSshRunner(resolved.config.server, password);
    const uploader = command.kind === 'preparedAction' ? createScpUploader(resolved.config.server, password) : null;

    const preflight = await buildRemoteTest({ workspace, config: resolved.config, runner });
    if (!preflight.ok) {
        return preflight;
    }

    if (command.kind === 'bridgeAction') {
        const bridge = await executeRemoteBridge({
            target: command.target!,
            action: command.remoteAction!,
            args: command.args || [],
            json: true,
            remotePath: resolved.config.remotePath,
            runner
        });
        return { ...bridge, workspace: resolved.config.workspace, remotePath: resolved.config.remotePath };
    }

    const result = await executePreparedRemoteAction({
        workspace: resolved.config.workspace,
        remotePath: resolved.config.remotePath,
        ignore: resolved.config.ignore,
        owner: 'vscode',
        target: command.target!,
        action: command.remoteAction!,
        args: command.args || [],
        json: true,
        runner,
        uploader: uploader!
    });
    return { ...result, workspace: resolved.config.workspace, remotePath: resolved.config.remotePath };
}

function publishProblemsIfApplicable(command: RemoteVscodeCommandDefinition, result: { workspace?: string; remotePath?: string; remote?: { result?: unknown; stdout?: string; stderr?: string } } | ExecutePreparedRemoteActionResult & { workspace?: string; remotePath?: string }): void {
    if (!remoteDiagnostics || (command.kind !== 'preparedAction' && command.kind !== 'foregroundTerminal') || !result.workspace || !result.remotePath) { return; }
    const count = publishRemoteProblems(remoteDiagnostics, result.workspace, result.remotePath, result);
    if (count > 0) {
        logger.info(command.id + ': published ' + count + ' remote problem(s)');
    }
}

function reportResult(command: RemoteVscodeCommandDefinition, result: { ok?: boolean; overall?: string; diagnostics?: RemoteDiagnostic[]; nextActions?: string[]; stdout?: string; stderr?: string; remote?: { stdout?: string; stderr?: string } }): void {
    const diagnostics = result.diagnostics || [];
    const detail = diagnostics.map(item => item.message).filter(Boolean).slice(0, 3).join('\n');
    const next = result.nextActions && result.nextActions.length > 0 ? '\n下一步: ' + result.nextActions.join('；') : '';

    if (result.ok === false || result.overall === 'blocked') {
        const message = detail || '远程命令未完成';
        logger.error(command.id + ': ' + message + next);
        vscode.window.showErrorMessage('Compilot Remote: ' + message);
        return;
    }

    const stdout = result.remote?.stdout || result.stdout;
    if (stdout) {
        logger.info(command.id + ': ' + stdout.trim());
    }
    const summary = command.kind === 'status' && result.overall ? 'status: ' + result.overall : command.title + ' 完成';
    logger.info(command.id + ': ' + summary + next);
    vscode.window.showInformationMessage('Compilot Remote: ' + summary);
}

function resolveWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return ''; }
    return folders[0].uri.fsPath;
}
