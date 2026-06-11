import { RepoBaselineState } from './baseline';
import { quoteRemoteArg, remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface ExecuteRemoteBranchSyncOptions {
    remotePath: string;
    targetId: string;
    repos: RepoBaselineState[];
    runner: RemoteRunner;
}

export interface RemoteBranchSyncRepoResult {
    name: string;
    mode: 'git' | 'files';
    ok: boolean;
    skipped: boolean;
    branch?: string;
    preservedTracked: string[];
    diagnostics: RemoteDiagnostic[];
}

export interface ExecuteRemoteBranchSyncResult {
    ok: boolean;
    action: 'branchSync';
    mode: 'remote';
    repos: RemoteBranchSyncRepoResult[];
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export async function executeRemoteBranchSync(options: ExecuteRemoteBranchSyncOptions): Promise<ExecuteRemoteBranchSyncResult> {
    const repos: RemoteBranchSyncRepoResult[] = [];
    const diagnostics: RemoteDiagnostic[] = [];

    for (const repo of options.repos) {
        if (repo.mode === 'files') {
            const warning = { level: 'warning' as const, message: repo.name + ' 是 files-only，跳过 branchSync' };
            diagnostics.push(warning);
            repos.push({ name: repo.name, mode: repo.mode, ok: true, skipped: true, preservedTracked: [], diagnostics: [warning] });
            continue;
        }
        if (!repo.branch) {
            const error = { level: 'error' as const, message: repo.name + ' 缺少 target branch，无法执行 branchSync' };
            diagnostics.push(error);
            repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, preservedTracked: [], diagnostics: [error] });
            continue;
        }

        const repoDiagnostics: RemoteDiagnostic[] = [];
        const repoDir = remoteCommand([options.remotePath]) + '/' + remoteCommand([repo.name]);
        const overlay = await options.runner.run(buildOverlayRestoreCommand(options.targetId, repo.name, repoDir), 30000);
        if (overlay.exitCode !== 0) {
            const error = { level: 'error' as const, message: trim(overlay.stderr) || repo.name + ' overlay restore 失败' };
            diagnostics.push(error);
            repoDiagnostics.push(error);
            repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, branch: repo.branch, preservedTracked: [], diagnostics: repoDiagnostics });
            continue;
        }

        const trackedDirty = await options.runner.run('cd ' + repoDir + ' && git status --porcelain -uno', 10000);
        if (trackedDirty.exitCode !== 0) {
            const error = { level: 'error' as const, message: trim(trackedDirty.stderr) || repo.name + ' preserved dirty 检查失败' };
            diagnostics.push(error);
            repoDiagnostics.push(error);
            repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, branch: repo.branch, preservedTracked: [], diagnostics: repoDiagnostics });
            continue;
        }
        const preservedTracked = parseTrackedPorcelain(trackedDirty.stdout);

        let stashActive = false;
        if (preservedTracked.length > 0) {
            const stash = await options.runner.run('cd ' + repoDir + ' && git stash push -m ' + quoteRemoteArg('forja-remote-preserve') + ' -- ' + remoteCommand(preservedTracked), 30000);
            if (stash.exitCode !== 0) {
                const error = { level: 'error' as const, message: trim(stash.stderr) || repo.name + ' preserved dirty stash 失败' };
                diagnostics.push(error);
                repoDiagnostics.push(error);
                repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, branch: repo.branch, preservedTracked, diagnostics: repoDiagnostics });
                continue;
            }
            stashActive = true;
        }

        const fetch = await options.runner.run('cd ' + repoDir + ' && git fetch --prune', 60000);
        if (fetch.exitCode !== 0) {
            const error = { level: 'error' as const, message: trim(fetch.stderr) || repo.name + ' git fetch 失败' };
            diagnostics.push(error);
            repoDiagnostics.push(error);
            await rollbackPreservedStash(options.runner, repoDir, stashActive, diagnostics, repoDiagnostics, repo.name);
            repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, branch: repo.branch, preservedTracked, diagnostics: repoDiagnostics });
            continue;
        }

        const checkout = await options.runner.run('cd ' + repoDir + ' && git checkout ' + remoteCommand([repo.branch]), 30000);
        if (checkout.exitCode !== 0) {
            const error = { level: 'error' as const, message: trim(checkout.stderr) || repo.name + ' git checkout 失败' };
            diagnostics.push(error);
            repoDiagnostics.push(error);
            await rollbackPreservedStash(options.runner, repoDir, stashActive, diagnostics, repoDiagnostics, repo.name);
            repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, branch: repo.branch, preservedTracked, diagnostics: repoDiagnostics });
            continue;
        }

        const pull = await options.runner.run('cd ' + repoDir + ' && git pull --ff-only', 60000);
        if (pull.exitCode !== 0) {
            const error = { level: 'error' as const, message: trim(pull.stderr) || repo.name + ' git pull --ff-only 失败' };
            diagnostics.push(error);
            repoDiagnostics.push(error);
            await rollbackPreservedStash(options.runner, repoDir, stashActive, diagnostics, repoDiagnostics, repo.name);
            repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, branch: repo.branch, preservedTracked, diagnostics: repoDiagnostics });
            continue;
        }

        if (preservedTracked.length > 0) {
            const pop = await options.runner.run('cd ' + repoDir + ' && git stash pop', 30000);
            if (pop.exitCode !== 0) {
                const error = { level: 'error' as const, message: trim(pop.stderr) || repo.name + ' preserved dirty stash pop 失败' };
                diagnostics.push(error);
                repoDiagnostics.push(error);
                repos.push({ name: repo.name, mode: repo.mode, ok: false, skipped: false, branch: repo.branch, preservedTracked, diagnostics: repoDiagnostics });
                continue;
            }
            stashActive = false;
        }

        repos.push({ name: repo.name, mode: repo.mode, ok: true, skipped: false, branch: repo.branch, preservedTracked, diagnostics: repoDiagnostics });
    }

    const ok = diagnostics.every(item => item.level !== 'error');
    return { ok, action: 'branchSync', mode: 'remote', repos, diagnostics, nextActions: ok ? [] : ['修复 branchSync 诊断后重试'] };
}

async function rollbackPreservedStash(runner: RemoteRunner, repoDir: string, stashActive: boolean, diagnostics: RemoteDiagnostic[], repoDiagnostics: RemoteDiagnostic[], repoName: string): Promise<void> {
    if (!stashActive) { return; }
    const pop = await runner.run('cd ' + repoDir + ' && git stash pop', 30000);
    if (pop.exitCode !== 0) {
        const error = { level: 'error' as const, message: trim(pop.stderr) || repoName + ' preserved dirty stash rollback 失败' };
        diagnostics.push(error);
        repoDiagnostics.push(error);
    }
}

function buildOverlayRestoreCommand(targetId: string, repoName: string, repoDir: string): string {
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

function parseTrackedPorcelain(stdout: string): string[] {
    const paths: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim() || line.startsWith('?? ') || line.startsWith('!! ')) { continue; }
        const raw = line.length > 3 ? line.slice(3).trim() : '';
        if (!raw) { continue; }
        const renameArrow = ' -> ';
        const idx = raw.indexOf(renameArrow);
        paths.push(idx >= 0 ? raw.slice(idx + renameArrow.length) : raw);
    }
    return [...new Set(paths)];
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
