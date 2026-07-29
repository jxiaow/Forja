import { ServerConfig } from '../../core/serverStore';
import { RemoteTransferSettings } from '../../core/settingsIO';
import { buildScpArgs, buildSshArgs, sshTarget } from '../../core/ssh';
import { remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface ExecuteRemoteTransferOptions {
    remotePath: string;
    transfer: RemoteTransferSettings;
    deployServer: ServerConfig;
    runner: RemoteRunner;
}

export interface ExecuteRemoteTransferResult {
    ok: boolean;
    action: 'transfer';
    mode: 'remote';
    deployServer: string;
    deployPath: string;
    transferred: Array<{ source: string; destination: string }>;
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

export interface RemoteTransferStatusResult {
    ready: boolean;
    configured: boolean;
    deployServer: {
        id: string | null;
        name: string | null;
        exists: boolean;
        authMode: ServerConfig['authMode'] | null;
    };
    deployPath: string | null;
    artifacts: string[];
    plan: Array<{ source: string; destination: string }>;
    diagnostics: RemoteDiagnostic[];
    nextAction?: string;
}

export function buildRemoteTransferStatus(options: {
    remotePath: string | null;
    transfer: RemoteTransferSettings | null;
    deployServer: ServerConfig | null;
}): RemoteTransferStatusResult {
    const diagnostics: RemoteDiagnostic[] = [];
    let nextAction: string | undefined = undefined
    if (!options.transfer) {
        return {
            ready: false,
            configured: false,
            deployServer: { id: null, name: null, exists: false, authMode: null },
            deployPath: null,
            artifacts: [],
            plan: [],
            diagnostics: [{ level: 'warning', message: 'remote transfer 尚未配置' }],
            nextAction: 'forja remote transfer --server <name> --path <deployPath> --artifact <path>'
        };
    }

    const deployPathError = validateDeployPath(options.transfer.deployPath);
    if (deployPathError) { diagnostics.push({ level: 'error', message: deployPathError }); }
    for (const artifact of options.transfer.artifacts) {
        const artifactError = validateRelativePath(artifact, 'artifact');
        if (artifactError) { diagnostics.push({ level: 'error', message: artifactError }); }
    }
    if (options.transfer.artifacts.length === 0) {
        diagnostics.push({ level: 'error', message: 'remote transfer 需要至少一个 artifact' });
    }
    if (!options.remotePath) {
        diagnostics.push({ level: 'error', message: 'sync remotePath 未配置，无法生成 transfer plan' });
        nextAction = '配置 sync server 和 remotePath';
    }
    if (!options.deployServer) {
        diagnostics.push({ level: 'error', message: '部署服务器不存在: ' + options.transfer.deployServer });
        nextAction = '检查 ~/.forja/servers.json';
    } else if (options.deployServer.authMode === 'password') {
        diagnostics.push({ level: 'error', message: 'remote transfer direct 模式不支持部署机 password auth，请在编译机到部署机之间配置 SSH key' });
        nextAction = '在编译机配置到部署机的 SSH key';
    }

    const plan = options.remotePath && diagnostics.length === 0
        ? options.transfer.artifacts.map(artifact => ({
            source: joinRemotePath(options.remotePath!, artifact),
            destination: joinRemotePath(options.transfer!.deployPath, basename(artifact))
        }))
        : [];

    return {
        ready: diagnostics.every(item => item.level !== 'error'),
        configured: true,
        deployServer: {
            id: options.transfer.deployServer,
            name: options.deployServer?.name ?? null,
            exists: options.deployServer !== null,
            authMode: options.deployServer?.authMode ?? null
        },
        deployPath: options.transfer.deployPath,
        artifacts: options.transfer.artifacts,
        plan,
        diagnostics,
        nextAction
    };
}

export async function executeRemoteTransfer(options: ExecuteRemoteTransferOptions): Promise<ExecuteRemoteTransferResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    const transferred: ExecuteRemoteTransferResult['transferred'] = [];
    const deployPathError = validateDeployPath(options.transfer.deployPath);
    if (deployPathError) {
        diagnostics.push({ level: 'error', message: deployPathError });
        return result(false, options, transferred, diagnostics);
    }
    if (options.transfer.artifacts.length === 0) {
        diagnostics.push({ level: 'error', message: 'remote transfer 需要至少一个 artifact' });
        return result(false, options, transferred, diagnostics);
    }
    if (options.deployServer.authMode === 'password') {
        diagnostics.push({ level: 'error', message: 'remote transfer direct 模式不支持部署机 password auth，请在编译机到部署机之间配置 SSH key' });
        return result(false, options, transferred, diagnostics, '在编译机配置到部署机的 SSH key');
    }
    for (const artifact of options.transfer.artifacts) {
        const artifactError = validateRelativePath(artifact, 'artifact');
        if (artifactError) {
            diagnostics.push({ level: 'error', message: artifactError });
            return result(false, options, transferred, diagnostics);
        }
    }

    const mkdir = await options.runner.run(buildDeployMkdirCommand(options.deployServer, options.transfer.deployPath), 30000);
    if (mkdir.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(mkdir.stderr) || '部署机目录创建失败' });
        return result(false, options, transferred, diagnostics);
    }

    for (const artifact of options.transfer.artifacts) {
        const source = joinRemotePath(options.remotePath, artifact);
        const destination = joinRemotePath(options.transfer.deployPath, basename(artifact));
        const transfer = await options.runner.run(buildScpCommand(options.deployServer, source, destination), 300000);
        if (transfer.exitCode !== 0) {
            diagnostics.push({ level: 'error', message: trim(transfer.stderr) || `artifact 传输失败: ${artifact}` });
            return result(false, options, transferred, diagnostics);
        }
        transferred.push({ source, destination });
    }
    return result(true, options, transferred, diagnostics);
}

function buildDeployMkdirCommand(server: ServerConfig, deployPath: string): string {
    return 'ssh ' + shellArgs(buildSshArgs(server)) + ' ' + remoteCommand([sshTarget(server), 'mkdir -p ' + remoteCommand([deployPath])]);
}

function buildScpCommand(server: ServerConfig, source: string, destination: string): string {
    const target = `${sshTarget(server)}:${destination}`;
    return 'scp ' + shellArgs(buildScpArgs(server)) + ' ' + remoteCommand([source, target]);
}

function shellArgs(args: string[]): string {
    return args.length > 0 ? remoteCommand(args) : '';
}

function validateDeployPath(value: string): string | null {
    if (!value || value.trim() !== value || value.includes('\0')) {
        return '非法 deployPath: ' + value;
    }
    if (!value.startsWith('/')) {
        return 'deployPath 必须是部署机绝对路径: ' + value;
    }
    return null;
}

function validateRelativePath(value: string, label: string): string | null {
    if (!value || value.trim() !== value) {
        return '非法 ' + label + ': ' + value;
    }
    if (value.includes('\0') || value.startsWith('/') || value.startsWith('\\')) {
        return '非法 ' + label + ': ' + value;
    }
    const segments = value.split(/[\\/]+/);
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        return '非法 ' + label + ': ' + value;
    }
    return null;
}

function joinRemotePath(root: string, relative: string): string {
    return root.replace(/\/+$/, '') + '/' + relative.replace(/^\/+/, '');
}

function basename(value: string): string {
    const normalized = value.replace(/\\/g, '/');
    return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function result(
    ok: boolean,
    options: ExecuteRemoteTransferOptions,
    transferred: ExecuteRemoteTransferResult['transferred'],
    diagnostics: RemoteDiagnostic[],
    nextAction?: string
): ExecuteRemoteTransferResult {
    return {
        ok,
        action: 'transfer',
        mode: 'remote',
        deployServer: options.deployServer.name || options.deployServer.id,
        deployPath: options.transfer.deployPath,
        transferred,
        diagnostics,
        nextAction
    };
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
