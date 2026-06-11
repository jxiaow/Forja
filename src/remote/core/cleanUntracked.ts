import { quoteRemoteArg, remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface ExecuteRemoteCleanUntrackedOptions {
    remotePath: string;
    repo: string;
    paths: string[];
    recursive: boolean;
    runner: RemoteRunner;
}

export interface ExecuteRemoteCleanUntrackedResult {
    ok: boolean;
    action: 'cleanUntracked';
    mode: 'remote';
    repo: string;
    cleaned: string[];
    recursive: boolean;
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export async function executeRemoteCleanUntracked(options: ExecuteRemoteCleanUntrackedOptions): Promise<ExecuteRemoteCleanUntrackedResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    const repoError = validateRelativePath(options.repo, 'repo');
    if (repoError) {
        diagnostics.push({ level: 'error', message: repoError });
        return result(false, options, [], diagnostics);
    }
    if (options.paths.length === 0) {
        diagnostics.push({ level: 'error', message: 'remote clean-untracked 需要至少一个路径' });
        return result(false, options, [], diagnostics);
    }
    for (const item of options.paths) {
        const pathError = validateRelativePath(item, 'clean-untracked 路径');
        if (pathError) {
            diagnostics.push({ level: 'error', message: pathError });
            return result(false, options, [], diagnostics);
        }
    }

    const command = 'cd ' + remoteCommand([options.remotePath]) + '/' + remoteCommand([options.repo]) + ' && ' + buildCleanCommand(options.paths, options.recursive);
    const executed = await options.runner.run(command, 30000);
    if (executed.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(executed.stderr) || '远端 clean-untracked 失败' });
        return result(false, options, [], diagnostics);
    }
    return result(true, options, options.paths, diagnostics);
}

function buildCleanCommand(paths: string[], recursive: boolean): string {
    const script = [
        "const cp=require('child_process');const fs=require('fs');const path=require('path');",
        "const recursive=process.argv[1]==='1';const selected=process.argv.slice(2);",
        "const output=cp.execFileSync('git',['ls-files','--others','--exclude-standard','--',...selected],{encoding:'utf8'});",
        "const untracked=new Set(output.split(/\\r?\\n/).filter(Boolean));",
        "for(const p of selected){if(!untracked.has(p)){throw new Error('not an untracked path: '+p);}const resolved=path.resolve(process.cwd(),p);if(resolved===process.cwd()||!resolved.startsWith(process.cwd()+path.sep)){throw new Error('unsafe path: '+p);}const stat=fs.lstatSync(resolved);if(stat.isDirectory()&&!recursive){throw new Error('directory requires --recursive: '+p);}fs.rmSync(resolved,{force:true,recursive});}"
    ].join('');
    return 'node -e ' + quoteRemoteArg(script) + ' -- ' + remoteCommand([recursive ? '1' : '0', ...paths]);
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

function result(
    ok: boolean,
    options: ExecuteRemoteCleanUntrackedOptions,
    cleaned: string[],
    diagnostics: RemoteDiagnostic[]
): ExecuteRemoteCleanUntrackedResult {
    return { ok, action: 'cleanUntracked', mode: 'remote', repo: options.repo, cleaned, recursive: options.recursive, diagnostics, nextActions: [] };
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
