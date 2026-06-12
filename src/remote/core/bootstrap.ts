import * as crypto from 'crypto';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface BootstrapArtifactResult {
    ok: boolean;
    version?: string;
    artifactPath?: string;
    sha256?: string;
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export interface RemoteUploader {
    upload(localPath: string, remotePath: string): Promise<void>;
}

export interface ExecuteRemoteBootstrapOptions {
    artifact: BootstrapArtifactResult;
    runner: RemoteRunner;
    uploader: RemoteUploader;
}

export interface ExecuteRemoteBootstrapResult {
    ok: boolean;
    action: 'bootstrap';
    mode: 'remote';
    version?: string;
    artifact?: string;
    sha256?: string;
    remoteBin: string;
    stages: Array<{ name: string; ok: boolean; message?: string }>;
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
}

export function findBootstrapArtifact(root: string = process.cwd()): BootstrapArtifactResult {
    const packageRoot = findPackageRoot(root);
    if (!packageRoot) {
        return missing('未找到 package.json');
    }
    const packagePath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(packagePath)) {
        return missing('未找到 package.json');
    }
    const raw = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown; bin?: Record<string, unknown> };
    const version = typeof raw.version === 'string' ? raw.version : '';
    if (!version) {
        return missing('package.json 缺少 version');
    }
    let artifactPath = path.join(packageRoot, 'dist', `forja-${version}`, 'cli', `forja-cli-${version}.tgz`);
    if (!fs.existsSync(artifactPath) && raw.bin?.forja === './cli/index.js') {
        const packed = packStandalonePackage(packageRoot, version);
        if (!packed.ok) { return packed; }
        artifactPath = packed.artifactPath!;
    }
    if (!fs.existsSync(artifactPath)) {
        return {
            ok: false,
            version,
            artifactPath,
            diagnostics: [{ level: 'error', message: `缺少 bootstrap artifact: ${artifactPath}` }],
            nextActions: ['npm run build:cli', 'npm run package:all']
        };
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
    return { ok: true, version, artifactPath, sha256, diagnostics: [], nextActions: [] };
}

export function findPackageRoot(start: string): string | null {
    let current = path.resolve(start);
    while (true) {
        if (fs.existsSync(path.join(current, 'package.json'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

function packStandalonePackage(packageRoot: string, version: string): BootstrapArtifactResult {
    const outDir = path.join(os.tmpdir(), 'forja-bootstrap-artifacts', version);
    fs.mkdirSync(outDir, { recursive: true });
    try {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const stdout = cp.execFileSync(npm, ['pack', packageRoot, '--pack-destination', outDir, '--json'], { encoding: 'utf8' });
        const parsed = JSON.parse(stdout) as Array<{ filename?: string }>;
        const filename = parsed[0]?.filename || `forja-${version}.tgz`;
        const artifactPath = path.join(outDir, filename);
        if (fs.existsSync(artifactPath)) {
            return { ok: true, version, artifactPath, diagnostics: [], nextActions: [] };
        }
        return missing(`standalone bootstrap artifact 生成失败: ${artifactPath}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            version,
            diagnostics: [{ level: 'error', message: `standalone bootstrap artifact 生成失败: ${message}` }],
            nextActions: ['确认本机 npm 可用后重试 forja remote bootstrap']
        };
    }
}

export async function executeRemoteBootstrap(options: ExecuteRemoteBootstrapOptions): Promise<ExecuteRemoteBootstrapResult> {
    const artifact = options.artifact;
    const remoteBin = '$HOME/.forja/bin/forja';
    const stages: ExecuteRemoteBootstrapResult['stages'] = [];
    const diagnostics: RemoteDiagnostic[] = [...artifact.diagnostics];

    if (!artifact.ok || !artifact.version || !artifact.artifactPath || !artifact.sha256) {
        diagnostics.push({ level: 'error', message: 'bootstrap artifact 不可用' });
        return { ok: false, action: 'bootstrap', mode: 'remote', version: artifact.version, artifact: artifact.artifactPath, sha256: artifact.sha256, remoteBin, stages, diagnostics, nextActions: artifact.nextActions };
    }

    const version = artifact.version;
    const artifactName = path.basename(artifact.artifactPath);
    const remoteArtifact = `.forja/bootstrap/${artifactName}`;
    const remoteArtifactForShell = homePath('.forja', 'bootstrap', artifactName);
    const runtimePrefix = homePath('.forja', 'runtime', version);
    const runtimeBin = homePath('.forja', 'runtime', version, 'bin', 'forja');
    const publicBin = homePath('.forja', 'bin', 'forja');

    const preflight = await options.runner.run(`command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && mkdir -p ${homePath('.forja', 'bootstrap')} ${homePath('.forja', 'runtime', version)} ${homePath('.forja', 'bin')} && test -w ${homePath('.forja')}`, 10000);
    stages.push({ name: 'preflight', ok: preflight.exitCode === 0, message: trim(preflight.stderr) });
    if (preflight.exitCode !== 0) {
        const detail = trim(preflight.stderr);
        diagnostics.push({ level: 'error', message: '远端缺少 node 或 npm，或 ~/.forja 不可写，无法执行 bootstrap 安装' + (detail ? ': ' + detail : '') });
        return failure(artifact, remoteBin, stages, diagnostics, bootstrapFallbackActions());
    }

    const prepare = await options.runner.run(`mkdir -p ${homePath('.forja', 'bootstrap')} ${homePath('.forja', 'runtime', version)} ${homePath('.forja', 'bin')}`, 10000);
    stages.push({ name: 'prepare', ok: prepare.exitCode === 0, message: trim(prepare.stderr) });
    if (prepare.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(prepare.stderr) || '远端 bootstrap 目录创建失败' });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    try {
        await options.uploader.upload(artifact.artifactPath, remoteArtifact);
        stages.push({ name: 'upload', ok: true, message: remoteArtifact });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stages.push({ name: 'upload', ok: false, message });
        diagnostics.push({ level: 'error', message: `上传 bootstrap artifact 失败: ${message}` });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    const install = await options.runner.run(`npm install -g --prefix ${runtimePrefix} ${remoteArtifactForShell}`, 120000);
    stages.push({ name: 'install', ok: install.exitCode === 0, message: trim(install.stderr) });
    if (install.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(install.stderr) || '远端 npm install 失败' });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    const runtimeVersion = await options.runner.run(`${runtimeBin} --version`, 10000);
    const runtimeVersionText = runtimeVersion.stdout.trim();
    stages.push({ name: 'verifyRuntime', ok: runtimeVersion.exitCode === 0 && runtimeVersionText === version, message: runtimeVersionText || trim(runtimeVersion.stderr) });
    if (runtimeVersion.exitCode !== 0 || runtimeVersionText !== version) {
        diagnostics.push({ level: 'error', message: `远端 forja runtime 版本不匹配: ${runtimeVersionText || trim(runtimeVersion.stderr)}` });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    const link = await options.runner.run(`ln -sfn ${runtimeBin} ${publicBin}`, 10000);
    stages.push({ name: 'link', ok: link.exitCode === 0, message: trim(link.stderr) });
    if (link.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(link.stderr) || '远端 forja 链接创建失败' });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    const publicVersion = await options.runner.run(`${publicBin} --version`, 10000);
    const publicVersionText = publicVersion.stdout.trim();
    stages.push({ name: 'verifyPublicBin', ok: publicVersion.exitCode === 0 && publicVersionText === version, message: publicVersionText || trim(publicVersion.stderr) });
    if (publicVersion.exitCode !== 0 || publicVersionText !== version) {
        diagnostics.push({ level: 'error', message: `远端 forja 入口版本不匹配: ${publicVersionText || trim(publicVersion.stderr)}` });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    return {
        ok: true,
        action: 'bootstrap',
        mode: 'remote',
        version,
        artifact: artifact.artifactPath,
        sha256: artifact.sha256,
        remoteBin,
        stages,
        diagnostics,
        nextActions: []
    };
}

function failure(
    artifact: BootstrapArtifactResult,
    remoteBin: string,
    stages: ExecuteRemoteBootstrapResult['stages'],
    diagnostics: RemoteDiagnostic[],
    nextActions: string[] = []
): ExecuteRemoteBootstrapResult {
    return {
        ok: false,
        action: 'bootstrap',
        mode: 'remote',
        version: artifact.version,
        artifact: artifact.artifactPath,
        sha256: artifact.sha256,
        remoteBin,
        stages,
        diagnostics,
        nextActions
    };
}

function bootstrapFallbackActions(): string[] {
    return [
        '在远端预装 Node.js 和 npm 后重试 forja remote bootstrap',
        '配置 remoteForjaBin 指向远端已有 forja CLI',
        'forja remote doctor --json'
    ];
}

function homePath(...segments: string[]): string {
    return '$HOME/' + segments.map(segment => /^[A-Za-z0-9._-]+$/.test(segment) ? segment : remoteCommand([segment])).join('/');
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}

function missing(message: string): BootstrapArtifactResult {
    return { ok: false, diagnostics: [{ level: 'error', message }], nextActions: ['npm run build:cli', 'npm run package:all'] };
}
