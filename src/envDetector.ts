import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { detectEnvWin } from './platform/win/envDetector';
import { detectEnvLinux } from './platform/linux/envDetector';
import { log } from './logger';

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

// ── 共享工具 ──

export function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise(resolve => {
        const proc = child_process.spawn(cmd, args, { windowsHide: true });
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => resolve(out));
        proc.on('error', () => resolve(''));
    });
}

export function readDir(dir: string): string[] {
    try { return fs.readdirSync(dir); } catch { return []; }
}

export function isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// ── Qt 扫描公共逻辑 ──

const isWin = process.platform === 'win32';
const qmakeName = isWin ? 'qmake.exe' : 'qmake';

// 判断目录是否包含 bin/qmake
export function hasQmake(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'bin', qmakeName));
}

// 在一个根目录下搜索 qmake（最多三层深度）
function findQmakeIn(root: string): string | null {
    if (hasQmake(root)) { return root; }
    for (const l1 of readDir(root)) {
        const l1Dir = path.join(root, l1);
        if (!isDir(l1Dir)) { continue; }
        if (hasQmake(l1Dir)) { return l1Dir; }
        for (const l2 of readDir(l1Dir)) {
            const l2Dir = path.join(l1Dir, l2);
            if (isDir(l2Dir) && hasQmake(l2Dir)) { return l2Dir; }
        }
    }
    return null;
}

// 收集候选扫描根目录：
//   - 父目录本身（如 C:\Qt 直接含版本子目录）
//   - 父目录下 qt* 开头的子目录（如 /usr/local/qt5.13.2）
function collectQtDirs(parentDirs: string[]): string[] {
    const roots: string[] = [];
    const seen = new Set<string>();
    const add = (p: string) => { if (!seen.has(p) && isDir(p)) { seen.add(p); roots.push(p); } };
    for (const parent of parentDirs) {
        if (!parent || !isDir(parent)) { continue; }
        add(parent); // 父目录本身也作为候选（Windows C:\Qt 场景）
        for (const name of readDir(parent)) {
            if (!name.toLowerCase().startsWith('qt')) { continue; }
            add(path.join(parent, name));
        }
    }
    return roots;
}

// 从版本字符串提取数字用于比较，如 "5.13.2" → [5, 13, 2]
function versionWeight(v: string): number[] {
    const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : [0, 0, 0];
}

// 比较版本号，返回 >0 表示 a 更新
function compareVersion(a: string, b: string): number {
    const va = versionWeight(a);
    const vb = versionWeight(b);
    for (let i = 0; i < 3; i++) {
        if (va[i] !== vb[i]) { return va[i] - vb[i]; }
    }
    return 0;
}

// 解析 Qt 路径：跑 qmake --version 获取版本，兜底从路径提取
export async function parseQtInfo(qtPath: string, defaultCompiler: string): Promise<QtInfo> {
    let version = '';
    const qmake = path.join(qtPath, 'bin', qmakeName);
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
    return { version, compiler: defaultCompiler, path: qtPath };
}

// 扫描目录列表，找到所有含 qmake 的 Qt 路径，返回版本最高的
export async function scanQt(parentDirs: string[], tag: string): Promise<string | null> {
    const scanRoots = collectQtDirs(parentDirs);
    log(`[${tag}] 扫描目录: ${scanRoots.join(', ') || '无'}`);
    let bestPath: string | null = null;
    let bestVersion = '';
    for (const root of scanRoots) {
        const found = findQmakeIn(root);
        if (!found) { continue; }
        // 从路径提取版本用于比较
        const m = found.match(/(\d+\.\d+\.\d+)/);
        const ver = m ? m[1] : '0.0.0';
        if (!bestPath || compareVersion(ver, bestVersion) > 0) {
            bestPath = found;
            bestVersion = ver;
        }
    }
    if (bestPath) { log(`[${tag}] 扫描找到 Qt: "${bestPath}" (${bestVersion})`); }
    return bestPath;
}

// ── 入口 ──

export function getEnvInfo(): EnvInfo | null {
    return _envInfo;
}

export async function detectEnv(manualQtPath?: string, manualVsPath?: string): Promise<EnvInfo> {
    if (process.platform === 'win32') {
        _envInfo = await detectEnvWin(manualQtPath, manualVsPath);
    } else {
        _envInfo = await detectEnvLinux(manualQtPath);
    }
    return _envInfo;
}
