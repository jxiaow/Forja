import { stagedWorkspaceRepoPath } from './stagedWorkspace';
import { RemoteRepoPlan } from './repoStrategy';
import { remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface ExecuteWorkspaceLinksOptions {
    stagedWorkspace: string;
    plans: RemoteRepoPlan[];
    runner: RemoteRunner;
}

export interface WorkspaceLinkResult {
    ok: boolean;
    action: 'workspaceLink';
    mode: 'remote';
    linked: string[];
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export async function executeWorkspaceLinks(options: ExecuteWorkspaceLinksOptions): Promise<WorkspaceLinkResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    const linked: string[] = [];

    for (const plan of options.plans) {
        if (plan.role !== 'remote-only' || plan.mount !== 'symlink') { continue; }
        if (!plan.remotePath) {
            diagnostics.push({ level: 'error', message: plan.remoteName + ' remote-only symlink 缺少 remotePath' });
            continue;
        }
        const linkPath = stagedWorkspaceRepoPath(options.stagedWorkspace, plan.remoteName);
        const command = [
            'set -e;',
            'test -d ' + remoteCommand([plan.remotePath]) + ';',
            'mkdir -p ' + remoteCommand([options.stagedWorkspace]) + ';',
            'ln -sfn ' + remoteCommand([plan.remotePath]) + ' ' + remoteCommand([linkPath])
        ].join(' ');
        const result = await options.runner.run(command, 10000);
        if (result.exitCode !== 0) {
            diagnostics.push({ level: 'error', message: plan.remoteName + ' workspace link 失败: ' + trim(result.stderr || result.stdout) });
            continue;
        }
        linked.push(plan.remoteName);
    }

    const ok = diagnostics.every(item => item.level !== 'error');
    return {
        ok,
        action: 'workspaceLink',
        mode: 'remote',
        linked,
        diagnostics,
        nextActions: ok ? [] : ['检查 remote-only 依赖路径后重试']
    };
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
