import { quoteRemoteArg, remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface RemoteOverlayRestoreRepo {
    name: string;
    remotePath: string;
}

export interface ExecuteRemoteOverlayRestoreOptions {
    targetId: string;
    repos: RemoteOverlayRestoreRepo[];
    runner: RemoteRunner;
}

export interface ExecuteRemoteOverlayRestoreResult {
    ok: boolean;
    diagnostics: RemoteDiagnostic[];
}

export async function executeRemoteOverlayRestore(options: ExecuteRemoteOverlayRestoreOptions): Promise<ExecuteRemoteOverlayRestoreResult> {
    const diagnostics: RemoteDiagnostic[] = [];
    for (const repo of options.repos) {
        const restore = await options.runner.run(buildOverlayRestoreCommand(options.targetId, repo.name, repo.remotePath), 30000);
        if (restore.exitCode !== 0) {
            diagnostics.push({ level: 'error', message: trim(restore.stderr) || repo.name + ' overlay restore 失败' });
        }
    }
    return { ok: diagnostics.every(item => item.level !== 'error'), diagnostics };
}

export function buildOverlayRestoreCommand(targetId: string, repoName: string, repoDir: string): string {
    const stateDir = '"$HOME/.forja/remote-state/' + targetId + '"';
    const script = [
        "const fs=require('fs');const path=require('path');const cp=require('child_process');",
        "const stateDir=process.argv[1];const repo=process.argv[2];const repoDir=process.argv[3];",
        "const manifestPath=path.join(stateDir,'overlay.json');",
        "if(!fs.existsSync(manifestPath)){process.exit(0);}",
        "const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));",
        "const repoState=manifest.repos&&manifest.repos[repo];if(!repoState){process.exit(0);}",
        "function safeRel(p){return typeof p==='string'&&p&&!p.includes('\\0')&&!path.isAbsolute(p)&&!p.split(/[\\\\/]+/).some(s=>s===''||s==='.'||s==='..');}",
        "function runGit(args){const r=cp.spawnSync('git',args,{cwd:repoDir,encoding:'utf8'});if(r.status!==0){throw new Error((r.stderr||r.stdout||'git failed').trim());}}",
        "const underlayRoot=path.resolve(stateDir,'underlay');",
        "function restorePath(p){const entry=repoState.underlayTracked&&repoState.underlayTracked[p];if(entry&&entry.backupRef){const backup=path.resolve(underlayRoot,entry.backupRef);if(backup===underlayRoot||!backup.startsWith(underlayRoot+path.sep)){throw new Error('invalid underlay backup '+p);}const dst=path.resolve(repoDir,p);if(dst===repoDir||!dst.startsWith(repoDir+path.sep)){throw new Error('invalid restore path '+p);}fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(backup,dst);fs.rmSync(backup,{force:true});delete repoState.underlayTracked[p];}else{runGit(['restore','--',p]);}}",
        "for(const p of [...(repoState.tracked||[]),...(repoState.deletedTracked||[])]){if(!safeRel(p)){throw new Error('invalid overlay path '+p);}restorePath(p);}",
        "for(const p of (repoState.untracked||[])){if(!safeRel(p)){throw new Error('invalid overlay path '+p);}const target=path.resolve(repoDir,p);if(target!==repoDir&&target.startsWith(repoDir+path.sep)){fs.rmSync(target,{force:true});}}",
        "repoState.tracked=[];repoState.untracked=[];repoState.deletedTracked=[];",
        "fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));"
    ].join('');
    return 'node -e ' + quoteRemoteArg(script) + ' -- ' + stateDir + ' ' + remoteCommand([repoName]) + ' ' + repoDir;
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
