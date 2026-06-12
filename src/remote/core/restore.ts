import * as crypto from 'crypto';
import { buildRemoteRepoDirSetup } from './repoPath';
import { quoteRemoteArg, remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface ExecuteRemoteRestoreOptions {
    remotePath: string;
    repo: string;
    paths: string[];
    runner: RemoteRunner;
}

export interface ExecuteRemoteRestoreResult {
    ok: boolean;
    action: 'restore';
    mode: 'remote';
    repo: string;
    restored: string[];
    targetId?: string;
    stateCleaned?: boolean;
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export async function executeRemoteRestore(options: ExecuteRemoteRestoreOptions): Promise<ExecuteRemoteRestoreResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    const repoError = validateRelativePath(options.repo, 'repo');
    if (repoError) {
        diagnostics.push({ level: 'error', message: repoError });
        return result(false, options.repo, [], diagnostics);
    }
    if (options.paths.length === 0) {
        diagnostics.push({ level: 'error', message: 'remote restore 需要至少一个路径' });
        return result(false, options.repo, [], diagnostics);
    }
    for (const item of options.paths) {
        const pathError = validateRelativePath(item, 'restore 路径');
        if (pathError) {
            diagnostics.push({ level: 'error', message: pathError });
            return result(false, options.repo, [], diagnostics);
        }
    }

    const pathCommand = 'mkdir -p ' + remoteCommand([options.remotePath]) + ' && cd ' + remoteCommand([options.remotePath]) + ' && pwd -P';
    const pathResult = await options.runner.run(pathCommand, 10000);
    if (pathResult.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(pathResult.stderr) || 'remotePath 不可用，无法定位 remote state' });
        return result(false, options.repo, [], diagnostics);
    }
    const canonicalPath = pathResult.stdout.trim();
    const targetId = crypto.createHash('sha256').update(canonicalPath).digest('hex');

    const pathArgs = remoteCommand(options.paths);
    const command = buildRemoteRepoDirSetup(options.remotePath, options.repo, true) + ' cd "$repo_dir" && git ls-files --error-unmatch -- ' + pathArgs + ' && git restore -- ' + pathArgs;
    const executed = await options.runner.run(command, 30000);
    if (executed.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(executed.stderr) || '远端 restore 失败' });
        return result(false, options.repo, [], diagnostics, targetId, false);
    }

    const cleanup = await options.runner.run(buildOverlayCleanupCommand(targetId, options.repo, options.paths), 10000);
    if (cleanup.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(cleanup.stderr) || '远端 overlay state 清理失败' });
        return result(false, options.repo, [], diagnostics, targetId, false);
    }
    return result(true, options.repo, options.paths, diagnostics, targetId, true);
}

function validateRelativePath(value: string, label: string): string | null {
    if (!value || value.trim() !== value) {
        return '非法 ' + label + ': ' + value;
    }
    if (value.includes('\0')) {
        return '非法 ' + label + ': 包含 NUL';
    }
    if (value.startsWith('/') || value.startsWith('\\')) {
        return '非法 ' + label + ': ' + value;
    }
    const segments = value.split(/[\\/]+/);
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        return '非法 ' + label + ': ' + value;
    }
    return null;
}

function buildOverlayCleanupCommand(targetId: string, repo: string, paths: string[]): string {
    const stateDir = '"$HOME/.forja/remote-state/' + targetId + '"';
    const script = [
        "const fs=require('fs');const path=require('path');",
        "const stateDir=process.argv[1];const repo=process.argv[2];const paths=process.argv.slice(3);",
        "const manifestPath=path.join(stateDir,'overlay.json');",
        "if(!fs.existsSync(manifestPath)){process.exit(0);}",
        "const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));",
        "const repoState=manifest.repos&&manifest.repos[repo];if(!repoState){process.exit(0);}",
        "const selected=new Set(paths);",
        "for(const key of ['tracked','deletedTracked']){if(Array.isArray(repoState[key])){repoState[key]=repoState[key].filter(p=>!selected.has(p));}}",
        "const underlayRoot=path.resolve(stateDir,'underlay');",
        "if(repoState.underlayTracked){for(const p of paths){const entry=repoState.underlayTracked[p];if(entry&&entry.backupRef){const backupPath=path.resolve(underlayRoot,entry.backupRef);if(backupPath!==underlayRoot&&backupPath.startsWith(underlayRoot+path.sep)){fs.rmSync(backupPath,{force:true});}}delete repoState.underlayTracked[p];}}",
        "fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));"
    ].join('');
    return 'node -e ' + quoteRemoteArg(script) + ' -- ' + stateDir + ' ' + remoteCommand([repo, ...paths]);
}

function result(ok: boolean, repo: string, restored: string[], diagnostics: RemoteDiagnostic[], targetId?: string, stateCleaned?: boolean): ExecuteRemoteRestoreResult {
    return { ok, action: 'restore', mode: 'remote', repo, restored, targetId, stateCleaned, diagnostics, nextActions: [] };
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
