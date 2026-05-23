import * as vscode from 'vscode';
import { executeRemoteBridge, RemoteBridgeAction, RemoteBridgeTarget } from '../core/bridge';
import { resolveRemoteConfig } from '../core/config';
import { executePreparedRemoteAction } from '../core/pipeline';
import { createScpUploader, createSshRunner } from '../core/shell';
import { buildRemoteStatus, buildRemoteTest } from '../core/status';
import { RemoteDiagnostic } from '../core/types';
import { createLogger } from '../../vscode/logger';

const logger = createLogger('RemoteCommands');

type RemoteVscodeCommandKind = 'status' | 'test' | 'preparedAction' | 'bridgeAction';

interface RemoteVscodeCommandDefinition {
    id: string;
    title: string;
    kind: RemoteVscodeCommandKind;
    target?: RemoteBridgeTarget;
    remoteAction?: RemoteBridgeAction;
    args?: string[];
}

export const REMOTE_VSCODE_COMMANDS: readonly RemoteVscodeCommandDefinition[] = [
    { id: 'compilot.remote.status', title: 'Compilot Remote: Status', kind: 'status' },
    { id: 'compilot.remote.test', title: 'Compilot Remote: Test', kind: 'test' },
    { id: 'compilot.remote.qt.build', title: 'Compilot Remote Qt: Build', kind: 'preparedAction', target: 'qt', remoteAction: 'build' },
    { id: 'compilot.remote.qt.clean', title: 'Compilot Remote Qt: Clean', kind: 'preparedAction', target: 'qt', remoteAction: 'clean' },
    { id: 'compilot.remote.qt.qmake', title: 'Compilot Remote Qt: QMake', kind: 'preparedAction', target: 'qt', remoteAction: 'qmake' },
    { id: 'compilot.remote.qt.runDetached', title: 'Compilot Remote Qt: Run Detached', kind: 'preparedAction', target: 'qt', remoteAction: 'run', args: ['--detach'] },
    { id: 'compilot.remote.qt.stop', title: 'Compilot Remote Qt: Stop', kind: 'bridgeAction', target: 'qt', remoteAction: 'stop' },
    { id: 'compilot.remote.qt.ps', title: 'Compilot Remote Qt: PS', kind: 'bridgeAction', target: 'qt', remoteAction: 'ps' },
    { id: 'compilot.remote.sdk.build', title: 'Compilot Remote SDK: Build', kind: 'preparedAction', target: 'sdk', remoteAction: 'build' },
    { id: 'compilot.remote.sdk.rebuild', title: 'Compilot Remote SDK: Rebuild', kind: 'preparedAction', target: 'sdk', remoteAction: 'rebuild' },
    { id: 'compilot.remote.sdk.clean', title: 'Compilot Remote SDK: Clean', kind: 'preparedAction', target: 'sdk', remoteAction: 'clean' }
];

export function registerRemoteCommands(context: vscode.ExtensionContext): void {
    for (const command of REMOTE_VSCODE_COMMANDS) {
        context.subscriptions.push(vscode.commands.registerCommand(command.id, () => executeRemoteVscodeCommand(context, command)));
    }
}

async function executeRemoteVscodeCommand(context: vscode.ExtensionContext, command: RemoteVscodeCommandDefinition): Promise<void> {
    const workspace = resolveWorkspaceRoot();
    if (!workspace) {
        vscode.window.showWarningMessage('Compilot Remote: 请先打开工作区');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: command.title,
        cancellable: false
    }, async () => {
        try {
            const result = await executeCommand(workspace, command);
            reportResult(command, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(message);
            vscode.window.showErrorMessage('Compilot Remote: ' + message);
        }
    });
}

async function executeCommand(workspace: string, command: RemoteVscodeCommandDefinition): Promise<{ ok?: boolean; overall?: string; diagnostics?: RemoteDiagnostic[]; nextActions?: string[]; stdout?: string; stderr?: string; remote?: { stdout?: string; stderr?: string } }> {
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
        return executeRemoteBridge({
            target: command.target!,
            action: command.remoteAction!,
            args: command.args || [],
            json: true,
            remotePath: resolved.config.remotePath,
            runner
        });
    }

    return executePreparedRemoteAction({
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
