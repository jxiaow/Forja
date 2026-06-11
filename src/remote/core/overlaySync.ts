import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { resolveGitRoots } from '../../core/gitRepoResolver';
import { isIgnored } from '../../core/gitChangedFiles';
import { GitRunner } from './baseline';
import { RemoteUploader } from './bootstrap';
import { quoteRemoteArg, remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface OverlayFile {
    path: string;
    localPath: string;
}

export interface LocalOverlayRepoPlan {
    name: string;
    dir: string;
    trackedUploads: OverlayFile[];
    untrackedUploads: OverlayFile[];
    deletedTracked: string[];
    skipped: string[];
}

export interface LocalOverlayPlan {
    ok: boolean;
    action: 'overlayPlan';
    repos: LocalOverlayRepoPlan[];
    diagnostics: RemoteDiagnostic[];
}

export interface BuildLocalOverlayPlanOptions {
    workspace: string;
    ignore: string[];
    git?: GitRunner;
}

export interface ExecuteRemoteOverlaySyncOptions {
    remotePath: string;
    targetId: string;
    plan: LocalOverlayPlan;
    runner: RemoteRunner;
    uploader: RemoteUploader;
}

export interface RemoteOverlaySyncRepoResult {
    name: string;
    ok: boolean;
    uploaded: string[];
    deletedTracked: string[];
    diagnostics: RemoteDiagnostic[];
}

export interface ExecuteRemoteOverlaySyncResult {
    ok: boolean;
    action: 'overlaySync';
    mode: 'remote';
    repos: RemoteOverlaySyncRepoResult[];
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export async function buildLocalOverlayPlan(options: BuildLocalOverlayPlanOptions): Promise<LocalOverlayPlan> {
    const diagnostics: RemoteDiagnostic[] = [];
    const repos: LocalOverlayRepoPlan[] = [];
    const roots = resolveGitRoots(options.workspace);
    if (roots.length === 0) {
        diagnostics.push({ level: 'error', message: '未找到 git 仓库: ' + options.workspace });
        return { ok: false, action: 'overlayPlan', repos, diagnostics };
    }

    const git = options.git || defaultGitRunner();
    for (const root of roots) {
        const status = await git.exec(root.dir, ['status', '--porcelain', '-uall']);
        const repoPlan: LocalOverlayRepoPlan = { name: root.name, dir: root.dir, trackedUploads: [], untrackedUploads: [], deletedTracked: [], skipped: [] };
        if (status.exitCode !== 0) {
            diagnostics.push({ level: 'error', message: root.name + ' git status 失败: ' + trim(status.stderr) });
            repos.push(repoPlan);
            continue;
        }
        for (const line of status.stdout.split(/\r?\n/)) {
            if (!line.trim()) { continue; }
            const parsed = parseStatusLine(line);
            if (!parsed) { continue; }
            const pathError = validateOverlayPath(parsed.path);
            if (pathError) {
                diagnostics.push({ level: 'error', message: root.name + ' 非法 overlay 路径: ' + parsed.path });
                continue;
            }
            if (isIgnored(parsed.path, options.ignore)) {
                repoPlan.skipped.push(parsed.path);
                continue;
            }
            if (parsed.kind === 'untracked') {
                repoPlan.untrackedUploads.push({ path: parsed.path, localPath: path.join(root.dir, parsed.path) });
            } else if (parsed.kind === 'deleted') {
                repoPlan.deletedTracked.push(parsed.path);
            } else {
                repoPlan.trackedUploads.push({ path: parsed.path, localPath: path.join(root.dir, parsed.path) });
            }
        }
        repos.push(repoPlan);
    }
    return { ok: diagnostics.every(item => item.level !== 'error'), action: 'overlayPlan', repos, diagnostics };
}

export async function executeRemoteOverlaySync(options: ExecuteRemoteOverlaySyncOptions): Promise<ExecuteRemoteOverlaySyncResult> {
    const diagnostics: RemoteDiagnostic[] = [...options.plan.diagnostics];
    const repos: RemoteOverlaySyncRepoResult[] = [];
    if (!options.plan.ok) {
        return { ok: false, action: 'overlaySync', mode: 'remote', repos, diagnostics, nextActions: ['修复 overlay plan 诊断后重试'] };
    }

    for (const repo of options.plan.repos) {
        const repoDiagnostics: RemoteDiagnostic[] = [];
        const uploaded: string[] = [];
        const deletedTracked: string[] = [];
        const repoRemotePath = trimSlash(options.remotePath) + '/' + repo.name;
        const allUploads = [...repo.trackedUploads, ...repo.untrackedUploads];

        for (const item of allUploads) {
            const capture = await options.runner.run(buildCaptureUnderlayCommand(options.targetId, repo.name, repoRemotePath, item.path), 10000);
            if (capture.exitCode !== 0) {
                const error = { level: 'error' as const, message: trim(capture.stderr) || repo.name + ' underlay 捕获失败: ' + item.path };
                diagnostics.push(error);
                repoDiagnostics.push(error);
                repos.push({ name: repo.name, ok: false, uploaded, deletedTracked, diagnostics: repoDiagnostics });
                return { ok: false, action: 'overlaySync', mode: 'remote', repos, diagnostics, nextActions: ['修复 overlay sync 诊断后重试'] };
            }
            try {
                await options.uploader.upload(item.localPath, repoRemotePath + '/' + item.path);
                uploaded.push(item.path);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const diagnostic = { level: 'error' as const, message };
                diagnostics.push(diagnostic);
                repoDiagnostics.push(diagnostic);
                repos.push({ name: repo.name, ok: false, uploaded, deletedTracked, diagnostics: repoDiagnostics });
                return { ok: false, action: 'overlaySync', mode: 'remote', repos, diagnostics, nextActions: ['修复 overlay sync 诊断后重试'] };
            }
        }

        for (const rel of repo.deletedTracked) {
            const capture = await options.runner.run(buildCaptureUnderlayCommand(options.targetId, repo.name, repoRemotePath, rel), 10000);
            if (capture.exitCode !== 0) {
                const error = { level: 'error' as const, message: trim(capture.stderr) || repo.name + ' underlay 捕获失败: ' + rel };
                diagnostics.push(error);
                repoDiagnostics.push(error);
                repos.push({ name: repo.name, ok: false, uploaded, deletedTracked, diagnostics: repoDiagnostics });
                return { ok: false, action: 'overlaySync', mode: 'remote', repos, diagnostics, nextActions: ['修复 overlay sync 诊断后重试'] };
            }
            const remove = await options.runner.run('cd ' + remoteCommand([repoRemotePath]) + ' && rm -f -- ' + remoteCommand([rel]), 10000);
            if (remove.exitCode !== 0) {
                const error = { level: 'error' as const, message: trim(remove.stderr) || repo.name + ' tracked deletion 失败: ' + rel };
                diagnostics.push(error);
                repoDiagnostics.push(error);
                repos.push({ name: repo.name, ok: false, uploaded, deletedTracked, diagnostics: repoDiagnostics });
                return { ok: false, action: 'overlaySync', mode: 'remote', repos, diagnostics, nextActions: ['修复 overlay sync 诊断后重试'] };
            }
            deletedTracked.push(rel);
        }

        const tracked = repo.trackedUploads.map(item => item.path).filter(item => uploaded.includes(item));
        const untracked = repo.untrackedUploads.map(item => item.path).filter(item => uploaded.includes(item));
        const manifest = await options.runner.run(buildManifestUpdateCommand(options.targetId, repo.name, tracked, untracked, deletedTracked), 10000);
        if (manifest.exitCode !== 0) {
            const error = { level: 'error' as const, message: trim(manifest.stderr) || repo.name + ' overlay manifest 更新失败' };
            diagnostics.push(error);
            repoDiagnostics.push(error);
            repos.push({ name: repo.name, ok: false, uploaded, deletedTracked, diagnostics: repoDiagnostics });
            return { ok: false, action: 'overlaySync', mode: 'remote', repos, diagnostics, nextActions: ['修复 overlay sync 诊断后重试'] };
        }
        repos.push({ name: repo.name, ok: true, uploaded, deletedTracked, diagnostics: repoDiagnostics });
    }

    return { ok: diagnostics.every(item => item.level !== 'error'), action: 'overlaySync', mode: 'remote', repos, diagnostics, nextActions: [] };
}

function defaultGitRunner(): GitRunner {
    return {
        exec(cwd: string, args: string[]) {
            return new Promise(resolve => {
                cp.execFile('git', args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
                    resolve({ exitCode: error ? 1 : 0, stdout, stderr });
                });
            });
        }
    };
}

function parseStatusLine(line: string): { kind: 'tracked' | 'untracked' | 'deleted'; path: string } | null {
    if (line.startsWith('?? ')) {
        return { kind: 'untracked', path: cleanRenamePath(line.slice(3).trim()) };
    }
    const status = line.slice(0, 2);
    const rel = cleanRenamePath(line.slice(3).trim());
    if (!rel) { return null; }
    if (status.includes('D')) {
        return { kind: 'deleted', path: rel };
    }
    return { kind: 'tracked', path: rel };
}

function cleanRenamePath(value: string): string {
    const marker = ' -> ';
    const idx = value.indexOf(marker);
    return idx >= 0 ? value.slice(idx + marker.length) : value;
}

function validateOverlayPath(value: string): string | null {
    if (!value || value.includes('\0') || path.isAbsolute(value)) { return 'invalid'; }
    if (value.split(/[\\/]+/).some(segment => segment === '' || segment === '.' || segment === '..')) { return 'invalid'; }
    return null;
}

function buildCaptureUnderlayCommand(targetId: string, repoName: string, repoRemotePath: string, rel: string): string {
    const stateDir = '"$HOME/.forja/remote-state/' + targetId + '"';
    const backupRef = repoName + '/' + hashPath(rel) + '.bak';
    const script = [
        "const fs=require('fs');const path=require('path');const cp=require('child_process');",
        "const stateDir=process.argv[1];const repoDir=process.argv[2];const rel=process.argv[3];const backupRef=process.argv[4];",
        "function run(args){return cp.spawnSync('git',args,{cwd:repoDir,encoding:'utf8'});}",
        "const tracked=run(['ls-files','--error-unmatch','--',rel]);if(tracked.status!==0){process.exit(0);}",
        "const dirty=run(['status','--porcelain','--',rel]);if(dirty.status!==0||!dirty.stdout.trim()){process.exit(0);}",
        "const src=path.resolve(repoDir,rel);if(src===repoDir||!src.startsWith(repoDir+path.sep)||!fs.existsSync(src)){process.exit(0);}",
        "const dst=path.resolve(stateDir,'underlay',backupRef);const root=path.resolve(stateDir,'underlay');if(dst===root||!dst.startsWith(root+path.sep)){throw new Error('invalid backupRef');}",
        "fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);"
    ].join('');
    return 'node -e ' + quoteRemoteArg(script) + ' -- ' + stateDir + ' ' + remoteCommand([repoRemotePath, rel, backupRef]);
}

function buildManifestUpdateCommand(targetId: string, repoName: string, tracked: string[], untracked: string[], deletedTracked: string[]): string {
    const stateDir = '"$HOME/.forja/remote-state/' + targetId + '"';
    const payload = JSON.stringify({ tracked, untracked, deletedTracked });
    const script = [
        "const fs=require('fs');const path=require('path');",
        "const stateDir=process.argv[1];const repo=process.argv[2];const payload=JSON.parse(process.argv[3]);",
        "const manifestPath=path.join(stateDir,'overlay.json');fs.mkdirSync(stateDir,{recursive:true});",
        "let manifest={version:1,repos:{}};if(fs.existsSync(manifestPath)){manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));if(!manifest.repos){manifest.repos={};}}",
        "const current=manifest.repos[repo]||{};const underlayTracked=current.underlayTracked||{};const underlayRoot=path.join(stateDir,'underlay');",
        "for(const p of [...payload.tracked,...payload.deletedTracked]){const backupRef=repo+'/'+require('crypto').createHash('sha256').update(p).digest('hex')+'.bak';if(fs.existsSync(path.join(underlayRoot,backupRef))){underlayTracked[p]={backupRef,capturedAt:new Date().toISOString()};}}",
        "manifest.repos[repo]={tracked:payload.tracked,untracked:payload.untracked,deletedTracked:payload.deletedTracked,underlayTracked,lastSyncedAt:new Date().toISOString()};",
        "fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));"
    ].join('');
    return 'node -e ' + quoteRemoteArg(script) + ' -- ' + stateDir + ' ' + remoteCommand([repoName, payload]);
}

function hashPath(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function trimSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
