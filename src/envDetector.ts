import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

export interface EnvInfo {
    vs: VSInfo | null;
    qt: QtInfo | null;
    jom: boolean;
}

export interface VSInfo {
    version: string;
    edition: string;
    installPath: string;
    devShellPath: string;
}

export interface QtInfo {
    version: string;
    compiler: string;
    path: string;
}

let _envInfo: EnvInfo | null = null;

export function getEnvInfo(): EnvInfo | null {
    return _envInfo;
}

// 异步执行命令，返回 stdout
function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise(resolve => {
        const proc = child_process.spawn(cmd, args, { windowsHide: true });
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => resolve(out));
        proc.on('error', () => resolve(''));
    });
}

function parseVsPath(devShellPath: string): VSInfo {
    // 从 VsDevCmd.bat 或 Launch-VsDevShell.ps1 路径推断 installPath
    const installPath = devShellPath.replace(/\\Common7\\Tools\\[^\\]+$/i, '');
    
    // 匹配年份（2022, 2019, 2017）或版本号（17, 16, 15, 18 等）
    let version = 'unknown';
    const yearMatch = installPath.match(/(2022|2019|2017)/);
    if (yearMatch) {
        version = yearMatch[1];
    } else {
        const verMatch = installPath.match(/\\(\d{2})\\/);
        if (verMatch) {
            // 版本号转年份
            const verNum = parseInt(verMatch[1]);
            if (verNum >= 17) version = '2022';
            else if (verNum === 16) version = '2019';
            else if (verNum === 15) version = '2017';
            else version = verMatch[1];
        }
    }
    
    let edition = 'Community';
    if (installPath.includes('Professional')) { edition = 'Professional'; }
    else if (installPath.includes('Enterprise')) { edition = 'Enterprise'; }
    return { version, edition, installPath, devShellPath };
}

async function detectVS(manualPath?: string): Promise<VSInfo | null> {
    // 手动配置优先：直接从路径解析，不跑 vswhere
    if (manualPath) {
        if (!fs.existsSync(manualPath)) { return null; }
        return parseVsPath(manualPath);
    }
    const vswherePath = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    if (!fs.existsSync(vswherePath)) { return null; }
    try {
        const output = (await execAsync(vswherePath, ['-latest', '-property', 'installationPath'])).trim();
        if (!output) { return null; }
        const installPath = output;
        const devShellPath = `${installPath}\\Common7\\Tools\\Launch-VsDevShell.ps1`;
        return parseVsPath(devShellPath);
    } catch {
        return null;
    }
}

async function parseQtPath(qtPath: string): Promise<QtInfo> {
    // 优先跑 qmake --version 获取准确版本
    let version = '';
    const qmake = path.join(qtPath, 'bin', 'qmake.exe');
    if (fs.existsSync(qmake)) {
        const out = await execAsync(qmake, ['--version']);
        const m = out.match(/(\d+\.\d+\.\d+)/);
        if (m) { version = m[1]; }
    }
    // 兜底：从路径字符串里提取
    if (!version) {
        const m = qtPath.match(/(\d+\.\d+\.\d+)/);
        if (m) { version = m[1]; }
    }
    if (!version) { version = 'unknown'; }
    let compiler = 'msvc2019';
    if (qtPath.includes('msvc2022')) { compiler = 'msvc2022'; }
    else if (qtPath.includes('msvc2019')) { compiler = 'msvc2019'; }
    else if (qtPath.includes('mingw')) { compiler = 'mingw'; }
    return { version, compiler, path: qtPath };
}

async function detectQt(manualPath?: string): Promise<QtInfo | null> {
    // 手动配置优先：路径不存在或没有 qmake.exe 则视为无效
    if (manualPath) {
        if (!fs.existsSync(manualPath)) { return null; }
        if (!fs.existsSync(path.join(manualPath, 'bin', 'qmake.exe'))) { return null; }
        return parseQtPath(manualPath);
    }
    // 环境变量优先
    const qtdir = process.env.QTDIR || process.env.Qt6_DIR || process.env.Qt5_DIR;
    if (qtdir && fs.existsSync(path.join(qtdir, 'bin', 'qmake.exe'))) { return parseQtPath(qtdir); }
    // 扫描常用根目录，自动发现 Qt 安装（深度：根目录/版本/编译器）
    const scanRoots = ['C:\\Qt', 'C:\\QtCompile', 'D:\\Qt', 'E:\\Qt'];
    for (const root of scanRoots) {
        if (!fs.existsSync(root)) { continue; }
        try {
            for (const ver of fs.readdirSync(root)) {
                const verDir = path.join(root, ver);
                // 直接是 Qt 目录（如 C:\QtCompile\msvc2019-accessible）
                if (fs.existsSync(path.join(verDir, 'bin', 'qmake.exe'))) {
                    return parseQtPath(verDir);
                }
                // 版本/编译器 两层（如 C:\Qt\6.5.3\msvc2019_64）
                if (fs.statSync(verDir).isDirectory()) {
                    for (const compiler of fs.readdirSync(verDir)) {
                        const compDir = path.join(verDir, compiler);
                        if (fs.existsSync(path.join(compDir, 'bin', 'qmake.exe'))) {
                            return parseQtPath(compDir);
                        }
                    }
                }
            }
        } catch { continue; }
    }
    return null;
}

async function detectJom(qt: QtInfo | null): Promise<boolean> {
    if (!qt) { return false; }
    // 先查 Qt bin 目录
    if (fs.existsSync(path.join(qt.path, 'bin', 'jom.exe'))) { return true; }
    // 再查 PATH
    const out = await execAsync('jom', ['/VERSION']);
    return out.trim().length > 0;
}

export async function detectEnv(manualQtPath?: string, manualVsPath?: string): Promise<EnvInfo> {
    const [vs, qt] = await Promise.all([detectVS(manualVsPath || undefined), detectQt(manualQtPath)]);
    const jom = await detectJom(qt);
    _envInfo = { vs, qt, jom };
    return _envInfo;
}
