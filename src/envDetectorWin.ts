import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { EnvInfo, VSInfo, QtInfo } from './envDetector';

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
    const installPath = devShellPath.replace(/\\Common7\\Tools\\[^\\]+$/i, '');
    let version = 'unknown';
    const yearMatch = installPath.match(/(2022|2019|2017)/);
    if (yearMatch) {
        version = yearMatch[1];
    } else {
        const verMatch = installPath.match(/\\(\d{2})\\/);
        if (verMatch) {
            const n = parseInt(verMatch[1]);
            if (n >= 17) { version = '2022'; }
            else if (n === 16) { version = '2019'; }
            else if (n === 15) { version = '2017'; }
            else { version = verMatch[1]; }
        }
    }
    let edition = 'Community';
    if (installPath.includes('Professional')) { edition = 'Professional'; }
    else if (installPath.includes('Enterprise')) { edition = 'Enterprise'; }
    return { version, edition, installPath, devShellPath };
}

async function detectVS(manualPath?: string): Promise<VSInfo | null> {
    if (manualPath) {
        if (!fs.existsSync(manualPath)) { return null; }
        return parseVsPath(manualPath);
    }
    const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    if (!fs.existsSync(vswhere)) { return null; }
    try {
        const installPath = (await execAsync(vswhere, ['-latest', '-property', 'installationPath'])).trim();
        if (!installPath) { return null; }
        return parseVsPath(`${installPath}\\Common7\\Tools\\Launch-VsDevShell.ps1`);
    } catch {
        return null;
    }
}

async function parseQtPath(qtPath: string): Promise<QtInfo> {
    let version = '';
    const qmake = path.join(qtPath, 'bin', 'qmake.exe');
    if (fs.existsSync(qmake)) {
        const out = await execAsync(qmake, ['--version']);
        const m = out.match(/(\d+\.\d+\.\d+)/);
        if (m) { version = m[1]; }
    }
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
    if (manualPath) {
        if (!fs.existsSync(manualPath)) { return null; }
        if (!fs.existsSync(path.join(manualPath, 'bin', 'qmake.exe'))) { return null; }
        return parseQtPath(manualPath);
    }
    const qtdir = process.env.QTDIR || process.env.Qt6_DIR || process.env.Qt5_DIR;
    if (qtdir && fs.existsSync(path.join(qtdir, 'bin', 'qmake.exe'))) { return parseQtPath(qtdir); }
    const scanRoots = ['C:\\Qt', 'C:\\QtCompile', 'D:\\Qt', 'E:\\Qt'];
    for (const root of scanRoots) {
        if (!fs.existsSync(root)) { continue; }
        try {
            for (const ver of fs.readdirSync(root)) {
                const verDir = path.join(root, ver);
                if (fs.existsSync(path.join(verDir, 'bin', 'qmake.exe'))) { return parseQtPath(verDir); }
                if (fs.statSync(verDir).isDirectory()) {
                    for (const comp of fs.readdirSync(verDir)) {
                        const compDir = path.join(verDir, comp);
                        if (fs.existsSync(path.join(compDir, 'bin', 'qmake.exe'))) { return parseQtPath(compDir); }
                    }
                }
            }
        } catch { continue; }
    }
    return null;
}

async function detectJom(qt: QtInfo | null): Promise<boolean> {
    if (!qt) { return false; }
    if (fs.existsSync(path.join(qt.path, 'bin', 'jom.exe'))) { return true; }
    const out = await execAsync('jom', ['/VERSION']);
    return out.trim().length > 0;
}

export async function detectEnvWin(manualQtPath?: string, manualVsPath?: string): Promise<EnvInfo> {
    const [vs, qt] = await Promise.all([detectVS(manualVsPath || undefined), detectQt(manualQtPath)]);
    const jom = await detectJom(qt);
    return { vs, qt, jom };
}
