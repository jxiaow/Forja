import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { EnvInfo, QtInfo } from './envDetector';

function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise(resolve => {
        const proc = child_process.spawn(cmd, args);
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => resolve(out));
        proc.on('error', () => resolve(''));
    });
}

async function parseQtPath(qtPath: string): Promise<QtInfo> {
    let version = '';
    const qmake = path.join(qtPath, 'bin', 'qmake');
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
    let compiler = 'gcc';
    if (qtPath.includes('clang')) { compiler = 'clang'; }
    else if (qtPath.includes('gcc')) { compiler = 'gcc'; }
    return { version, compiler, path: qtPath };
}

async function detectQt(manualPath?: string): Promise<QtInfo | null> {
    if (manualPath) {
        if (!fs.existsSync(manualPath)) { return null; }
        if (!fs.existsSync(path.join(manualPath, 'bin', 'qmake'))) { return null; }
        return parseQtPath(manualPath);
    }
    // 环境变量优先
    const qtdir = process.env.QTDIR || process.env.Qt6_DIR || process.env.Qt5_DIR;
    if (qtdir && fs.existsSync(path.join(qtdir, 'bin', 'qmake'))) { return parseQtPath(qtdir); }
    // 扫描常用 Linux 安装路径
    const scanRoots = [
        '/opt/Qt', '/usr/local/Qt',
        `${process.env.HOME}/Qt`
    ].filter(Boolean) as string[];
    for (const root of scanRoots) {
        if (!fs.existsSync(root)) { continue; }
        try {
            for (const ver of fs.readdirSync(root)) {
                const verDir = path.join(root, ver);
                if (fs.existsSync(path.join(verDir, 'bin', 'qmake'))) { return parseQtPath(verDir); }
                if (fs.statSync(verDir).isDirectory()) {
                    for (const comp of fs.readdirSync(verDir)) {
                        const compDir = path.join(verDir, comp);
                        if (fs.existsSync(path.join(compDir, 'bin', 'qmake'))) { return parseQtPath(compDir); }
                    }
                }
            }
        } catch { continue; }
    }
    // 最后尝试系统 qmake
    const out = await execAsync('qmake', ['--version']);
    if (out.includes('Qt version')) {
        const m = out.match(/(\d+\.\d+\.\d+)/);
        return { version: m ? m[1] : 'unknown', compiler: 'gcc', path: '' };
    }
    return null;
}

async function detectMake(qt: QtInfo | null): Promise<boolean> {
    if (!qt) { return false; }
    const out = await execAsync('make', ['--version']);
    return out.toLowerCase().includes('make');
}

export async function detectEnvLinux(manualQtPath?: string): Promise<EnvInfo> {
    const qt = await detectQt(manualQtPath);
    const jom = await detectMake(qt);
    // Linux 无 VS
    return { vs: null, qt, jom };
}
