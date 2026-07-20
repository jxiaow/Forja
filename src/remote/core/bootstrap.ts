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
    nextAction?: string;
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
    nextAction?: string;
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
    const packageVersion = typeof raw.version === 'string' ? raw.version : '';
    if (!packageVersion) {
        return missing('package.json 缺少 version');
    }
    const binEntry = raw.bin?.forja;
    const version = resolveCliVersion(packageRoot, binEntry, packageVersion);
    let artifactPath = path.join(packageRoot, 'dist', `forja-${packageVersion}`, 'cli', `forja-cli-${version}.tgz`);
    if (!fs.existsSync(artifactPath) && binEntry === './cli/index.js') {
        const packed = packPackage(packageRoot, version);
        if (!packed.ok) { return packed; }
        artifactPath = packed.artifactPath!;
    } else if (!fs.existsSync(artifactPath) && binEntry === './out/cli/index.js') {
        const packed = packCompiledPackage(packageRoot, version);
        if (!packed.ok) { return packed; }
        artifactPath = packed.artifactPath!;
    }
    if (!fs.existsSync(artifactPath)) {
        return {
            ok: false,
            version,
            artifactPath,
            diagnostics: [{ level: 'error', message: `缺少 bootstrap artifact: ${artifactPath}` }],
            nextAction: 'npm run build:cli'
        };
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
    return { ok: true, version, artifactPath, sha256, diagnostics: [] };
}

function resolveCliVersion(packageRoot: string, binEntry: unknown, fallback: string): string {
    const versionFile = binEntry === './out/cli/index.js'
        ? path.join(packageRoot, 'out', 'version.js')
        : path.join(packageRoot, 'version.js');
    if (!fs.existsSync(versionFile)) { return fallback; }
    const source = fs.readFileSync(versionFile, 'utf8');
    return source.match(/exports\.VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || fallback;
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

function packCompiledPackage(packageRoot: string, version: string): BootstrapArtifactResult {
    const compiledRoot = path.join(packageRoot, 'out');
    const entryPoint = path.join(compiledRoot, 'cli', 'index.js');
    if (!fs.existsSync(entryPoint)) {
        return missing(`本地 CLI 尚未编译: ${entryPoint}`, 'npm run compile');
    }

    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bootstrap-compiled-'));
    try {
        fs.cpSync(compiledRoot, path.join(stagingRoot, 'out'), {
            recursive: true,
            filter: source => {
                const relative = path.relative(compiledRoot, source);
                if (!relative) { return true; }
                const firstSegment = relative.split(path.sep)[0];
                return firstSegment !== 'test' && !source.endsWith('.map');
            }
        });
        fs.writeFileSync(path.join(stagingRoot, 'package.json'), JSON.stringify({
            name: 'forja',
            version,
            bin: { forja: './out/cli/index.js' },
            files: ['out/**', 'package.json'],
            engines: { node: '>=18.0.0' }
        }, null, 2) + '\n');
        return packPackage(stagingRoot, version);
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
}

function packPackage(packageRoot: string, version: string): BootstrapArtifactResult {
    const outDir = path.join(os.tmpdir(), 'forja-bootstrap-artifacts', version);
    fs.mkdirSync(outDir, { recursive: true });
    try {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const stdout = cp.execFileSync(npm, ['pack', packageRoot, '--pack-destination', outDir, '--json'], { encoding: 'utf8' });
        const parsed = JSON.parse(stdout) as Array<{ filename?: string }>;
        const filename = parsed[0]?.filename || `forja-${version}.tgz`;
        const artifactPath = path.join(outDir, filename);
        if (fs.existsSync(artifactPath)) {
            return { ok: true, version, artifactPath, diagnostics: [] };
        }
        return missing(`standalone bootstrap artifact 生成失败: ${artifactPath}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            version,
            diagnostics: [{ level: 'error', message: `standalone bootstrap artifact 生成失败: ${message}` }],
            nextAction: '确认本机 npm 可用后重试 forja doctor fix --remote'
        };
    }
}

export async function executeRemoteBootstrap(options: ExecuteRemoteBootstrapOptions): Promise<ExecuteRemoteBootstrapResult> {
    const artifact = options.artifact;
    const remoteBin = '$HOME/.local/bin/forja';
    const stages: ExecuteRemoteBootstrapResult['stages'] = [];
    const diagnostics: RemoteDiagnostic[] = [...artifact.diagnostics];

    if (!artifact.ok || !artifact.version || !artifact.artifactPath || !artifact.sha256) {
        diagnostics.push({ level: 'error', message: 'bootstrap artifact 不可用' });
        return { ok: false, action: 'bootstrap', mode: 'remote', version: artifact.version, artifact: artifact.artifactPath, sha256: artifact.sha256, remoteBin, stages, diagnostics, nextAction: artifact.nextAction };
    }

    const version = artifact.version;
    const artifactName = path.basename(artifact.artifactPath);
    const remoteArtifact = `.forja/bootstrap/${artifactName}`;
    const remoteArtifactForShell = homePath('.forja', 'bootstrap', artifactName);
    const installPrefix = homePath('.local');
    const publicBin = homePath('.local', 'bin', 'forja');

    const preflight = await options.runner.run(`command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && mkdir -p ${homePath('.forja', 'bootstrap')} ${installPrefix} && test -w ${homePath('.forja')} && test -w ${installPrefix}`, 10000);
    stages.push({ name: 'preflight', ok: preflight.exitCode === 0, message: trim(preflight.stderr) });
    if (preflight.exitCode !== 0) {
        const detail = trim(preflight.stderr);
        diagnostics.push({ level: 'error', message: '远端缺少 node 或 npm，或 ~/.forja、~/.local 不可写，无法执行 bootstrap 安装' + (detail ? ': ' + detail : '') });
        return failure(artifact, remoteBin, stages, diagnostics, bootstrapFallbackAction());
    }

    const prepare = await options.runner.run(`mkdir -p ${homePath('.forja', 'bootstrap')} ${installPrefix}`, 10000);
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

    const install = await options.runner.run(`npm install -g --prefix ${installPrefix} ${remoteArtifactForShell}`, 120000);
    stages.push({ name: 'install', ok: install.exitCode === 0, message: trim(install.stderr) });
    if (install.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(install.stderr) || '远端 npm install 失败' });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    const publicVersion = await options.runner.run(`cd /tmp && ${publicBin} --version`, 10000);
    const publicVersionText = publicVersion.stdout.trim();
    stages.push({ name: 'verifyPublicBin', ok: publicVersion.exitCode === 0 && publicVersionText === version, message: publicVersionText || trim(publicVersion.stderr) });
    if (publicVersion.exitCode !== 0 || publicVersionText !== version) {
        diagnostics.push({ level: 'error', message: `远端 forja 入口版本不匹配: ${publicVersionText || trim(publicVersion.stderr)}` });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    const removeLegacyBin = await options.runner.run(`rm -f ${homePath('.forja', 'bin', 'forja')}`, 10000);
    stages.push({ name: 'removeLegacyBin', ok: removeLegacyBin.exitCode === 0, message: trim(removeLegacyBin.stderr) });
    if (removeLegacyBin.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(removeLegacyBin.stderr) || '旧远端 forja 入口清理失败' });
        return failure(artifact, remoteBin, stages, diagnostics);
    }

    const pathVersion = await options.runner.run('cd /tmp && command -v forja >/dev/null 2>&1 && forja --version', 10000);
    const pathVersionText = pathVersion.stdout.trim();
    const pathReady = pathVersion.exitCode === 0 && pathVersionText === version;
    stages.push({ name: 'verifyPath', ok: pathReady, message: pathVersionText || trim(pathVersion.stderr) });
    if (!pathReady) {
        diagnostics.push({
            level: 'warning',
            message: '$HOME/.local/bin 尚未在远端 PATH 中生效；请将 export PATH="$HOME/.local/bin:$PATH" 加入 shell profile 后重新登录'
        });
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
        nextAction: pathReady ? undefined : '将 $HOME/.local/bin 加入远端 PATH 后重新登录'
    };
}

function failure(
    artifact: BootstrapArtifactResult,
    remoteBin: string,
    stages: ExecuteRemoteBootstrapResult['stages'],
    diagnostics: RemoteDiagnostic[],
    nextAction?: string
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
        nextAction
    };
}

function bootstrapFallbackAction(): string {
    return '在远端预装 Node.js 和 npm 后重试 forja doctor fix --remote';
}

function homePath(...segments: string[]): string {
    return '$HOME/' + segments.map(segment => /^[A-Za-z0-9._-]+$/.test(segment) ? segment : remoteCommand([segment])).join('/');
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}

function missing(message: string, nextAction = 'npm run build:cli'): BootstrapArtifactResult {
    return { ok: false, diagnostics: [{ level: 'error', message }], nextAction };
}
