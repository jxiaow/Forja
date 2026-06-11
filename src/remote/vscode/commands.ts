import * as vscode from 'vscode';
import { getServerById } from '../../core/serverStore';
import { loadRemoteSettings } from '../../core/settingsIO';
import { executeRemoteBootstrap, findBootstrapArtifact } from '../core/bootstrap';
import { executeRemoteBridge, RemoteBridgeAction, RemoteBridgeTarget } from '../core/bridge';
import { resolveRemoteConfig } from '../core/config';
import { buildRemoteDoctor } from '../core/doctor';
import { executePreparedRemoteAction, ExecutePreparedRemoteActionResult } from '../core/pipeline';
import { createScpUploader, createSshRunner } from '../core/shell';
import { buildRemoteStatus, buildRemoteTest } from '../core/status';
import { buildRemoteTransferStatus } from '../core/transfer';
import { RemoteDiagnostic } from '../core/types';
import { createLogger } from '../../vscode/logger';
import { getExecutionLocation, initExecutionLocation, setExecutionLocation } from '../../vscode/executionLocation';
import { publishRemoteProblems } from './diagnostics';

const logger = createLogger('RemoteCommands');
let remoteDiagnostics: vscode.DiagnosticCollection | null = null;

type RemoteVscodeCommandKind = 'workbench' | 'status' | 'doctor' | 'test' | 'bootstrap' | 'transferStatus' | 'preparedAction' | 'bridgeAction' | 'foregroundTerminal' | 'executionLocation';

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
    { id: 'forja.remote.execution.pick', title: 'Forja: Select Execution Location', kind: 'executionLocation', executionLocation: 'pick' },
    { id: 'forja.remote.execution.local', title: 'Forja: Use Local Execution', kind: 'executionLocation', executionLocation: 'local' },
    { id: 'forja.remote.execution.remote', title: 'Forja: Use Remote Execution', kind: 'executionLocation', executionLocation: 'remote' },
    { id: 'forja.remote.workbench', title: 'Forja Remote: Workbench', kind: 'workbench' },
    { id: 'forja.remote.status', title: 'Forja Remote: Status', kind: 'status' },
    { id: 'forja.remote.doctor', title: 'Forja Remote: Doctor', kind: 'doctor' },
    { id: 'forja.remote.test', title: 'Forja Remote: Test', kind: 'test' },
    { id: 'forja.remote.bootstrap', title: 'Forja Remote: Bootstrap', kind: 'bootstrap' },
    { id: 'forja.remote.transfer.status', title: 'Forja Remote: Transfer Status', kind: 'transferStatus' },
    { id: 'forja.remote.qt.build', title: 'Forja Remote Qt: Build', kind: 'preparedAction', target: 'qt', remoteAction: 'build' },
    { id: 'forja.remote.qt.clean', title: 'Forja Remote Qt: Clean', kind: 'preparedAction', target: 'qt', remoteAction: 'clean' },
    { id: 'forja.remote.qt.qmake', title: 'Forja Remote Qt: QMake', kind: 'preparedAction', target: 'qt', remoteAction: 'qmake' },
    { id: 'forja.remote.qt.run', title: 'Forja Remote Qt: Run', kind: 'foregroundTerminal', target: 'qt', remoteAction: 'run' },
    { id: 'forja.remote.qt.runDetached', title: 'Forja Remote Qt: Run Detached', kind: 'preparedAction', target: 'qt', remoteAction: 'run', args: ['--detach'] },
    { id: 'forja.remote.qt.stop', title: 'Forja Remote Qt: Stop', kind: 'bridgeAction', target: 'qt', remoteAction: 'stop' },
    { id: 'forja.remote.qt.ps', title: 'Forja Remote Qt: PS', kind: 'bridgeAction', target: 'qt', remoteAction: 'ps' },
    { id: 'forja.remote.sdk.build', title: 'Forja Remote SDK: Build', kind: 'preparedAction', target: 'sdk', remoteAction: 'build' },
    { id: 'forja.remote.sdk.rebuild', title: 'Forja Remote SDK: Rebuild', kind: 'preparedAction', target: 'sdk', remoteAction: 'rebuild' },
    { id: 'forja.remote.sdk.clean', title: 'Forja Remote SDK: Clean', kind: 'preparedAction', target: 'sdk', remoteAction: 'clean' }
];

export function registerRemoteCommands(context: vscode.ExtensionContext): void {
    initExecutionLocation(context);
    remoteDiagnostics = vscode.languages.createDiagnosticCollection('forja.remote');
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
        vscode.window.showWarningMessage('Forja Remote: 请先打开工作区');
        return;
    }

    if (command.kind === 'workbench') {
        await executeRemoteWorkbench(workspace);
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
            const result = await executeCommand(context, workspace, command);
            publishProblemsIfApplicable(command, result);
            reportResult(command, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(message);
            vscode.window.showErrorMessage('Forja Remote: ' + message);
        }
    });
}

async function executeExecutionLocationCommand(command: RemoteVscodeCommandDefinition): Promise<void> {
    if (command.executionLocation === 'pick') {
        const current = getExecutionLocation();
        const picked = await vscode.window.showQuickPick([
            { label: '$(home) Local', description: current === 'local' ? '当前' : '', value: 'local' as const },
            { label: '$(cloud) Remote', description: current === 'remote' ? '当前' : '', value: 'remote' as const }
        ], { placeHolder: '选择 Forja 执行位置' });
        if (!picked) { return; }
        await setExecutionLocation(picked.value);
        vscode.window.showInformationMessage('Forja: 执行位置已切换到 ' + (picked.value === 'remote' ? 'Remote' : 'Local'));
        return;
    }
    const location = command.executionLocation === 'remote' ? 'remote' : 'local';
    await setExecutionLocation(location);
    vscode.window.showInformationMessage('Forja: 执行位置已切换到 ' + (location === 'remote' ? 'Remote' : 'Local'));
}

async function executeRemoteWorkbench(workspace: string): Promise<void> {
    const doctor = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Forja Remote: Workbench',
        cancellable: false
    }, () => buildRemoteDoctor({ workspace }));

    type WorkbenchItem = vscode.QuickPickItem & { command?: string };
    const sep = (label: string): WorkbenchItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
    const items: WorkbenchItem[] = [
        {
            label: '$(pulse) Doctor',
            description: doctor.overall,
            detail: formatWorkbenchDetail(doctor.server, doctor.remotePath),
            command: 'forja.remote.doctor'
        },
        {
            label: '$(info) Status',
            description: '配置和 readiness 摘要',
            command: 'forja.remote.status'
        },
        {
            label: '$(beaker) Test',
            description: '远程通道和版本检查',
            command: 'forja.remote.test'
        },
        {
            label: '$(cloud-upload) Bootstrap',
            description: '安装或更新远端 forja',
            command: 'forja.remote.bootstrap'
        },
        {
            label: '$(arrow-swap) Transfer Status',
            description: '本地校验 transfer plan',
            command: 'forja.remote.transfer.status'
        },
        sep('Qt'),
        { label: '$(tools) Qt Build', description: 'Remote', command: 'forja.remote.qt.build' },
        { label: '$(play) Qt Run', description: 'Remote foreground Terminal', command: 'forja.remote.qt.run' },
        { label: '$(debug-stop) Qt Stop', description: 'Remote detached run', command: 'forja.remote.qt.stop' },
        sep('SDK'),
        { label: '$(tools) SDK Build', description: 'Remote', command: 'forja.remote.sdk.build' }
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Remote ${doctor.overall}: ${doctor.server || 'no server'} ${doctor.remotePath || ''}`.trim()
    });
    if (selected?.command) {
        await vscode.commands.executeCommand(selected.command);
    }
}

function formatWorkbenchDetail(server?: string, remotePath?: string): string {
    return [server ? 'server: ' + server : '', remotePath ? 'remotePath: ' + remotePath : ''].filter(Boolean).join(' · ');
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
        name: 'Forja Remote Qt Run',
        pty
    });
    terminal.show();
    context.subscriptions.push(writeEmitter, closeEmitter);
    logger.info('forja.remote.qt.run: started foreground pty for ' + workspace);
}

async function runForegroundRemoteQtRun(
    workspace: string,
    terminal: { write(text: string): void; onSpawn(child: { kill(signal?: NodeJS.Signals): boolean }): void }
): Promise<number> {
    terminal.write('Forja Remote Qt Run\r\n');
    const resolved = resolveRemoteConfig(workspace);
    if (!resolved.config) {
        writeDiagnostics(terminal, resolved.diagnostics, resolved.nextActions);
        return 1;
    }

    const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
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
    publishProblemsIfApplicable(REMOTE_VSCODE_COMMANDS.find(item => item.id === 'forja.remote.qt.run')!, { ...result, workspace: resolved.config.workspace, remotePath: resolved.config.remotePath });
    if (!result.ok) {
        writeDiagnostics(terminal, result.diagnostics, result.nextActions);
        return 1;
    }
    terminal.write('\r\nForja Remote Qt Run exited.\r\n');
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

async function executeCommand(context: vscode.ExtensionContext, workspace: string, command: RemoteVscodeCommandDefinition): Promise<{ ok?: boolean; overall?: string; diagnostics?: RemoteDiagnostic[]; nextActions?: string[]; workspace?: string; remotePath?: string; stdout?: string; stderr?: string; remote?: { result?: unknown; stdout?: string; stderr?: string } }> {
    if (command.kind === 'status') {
        return buildRemoteStatus({ workspace });
    }
    if (command.kind === 'doctor') {
        return buildRemoteDoctor({ workspace });
    }
    if (command.kind === 'test') {
        return buildRemoteTest({ workspace });
    }
    if (command.kind === 'transferStatus') {
        const settings = loadRemoteSettings(workspace);
        const resolved = resolveRemoteConfig(workspace);
        const deployServer = settings.transfer ? getServerById(settings.transfer.deployServer) : null;
        const status = buildRemoteTransferStatus({
            remotePath: resolved.config?.remotePath ?? null,
            transfer: settings.transfer,
            deployServer
        });
        return {
            ok: status.ready,
            diagnostics: [...resolved.diagnostics, ...status.diagnostics],
            nextActions: Array.from(new Set([...resolved.nextActions, ...status.nextActions]))
        };
    }

    const resolved = resolveRemoteConfig(workspace);
    if (!resolved.config) {
        return { ok: false, diagnostics: resolved.diagnostics, nextActions: resolved.nextActions };
    }

    const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
    const runner = createSshRunner(resolved.config.server, password);
    const remoteSettings = loadRemoteSettings(resolved.config.workspace);
    if (command.kind === 'bootstrap') {
        const artifact = findBootstrapArtifact(context.extensionPath);
        const uploader = createScpUploader(resolved.config.server, password);
        return executeRemoteBootstrap({ artifact, runner, uploader });
    }
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
        buildOrder: remoteSettings.buildOrder,
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
        vscode.window.showErrorMessage('Forja Remote: ' + message);
        return;
    }

    const stdout = result.remote?.stdout || result.stdout;
    if (stdout) {
        logger.info(command.id + ': ' + stdout.trim());
    }
    const summary = command.kind === 'status' && result.overall ? 'status: ' + result.overall : command.title + ' 完成';
    logger.info(command.id + ': ' + summary + next);
    vscode.window.showInformationMessage('Forja Remote: ' + summary);
}

function resolveWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return ''; }
    return folders[0].uri.fsPath;
}
