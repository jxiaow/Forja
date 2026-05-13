import * as fs from 'fs';
import * as path from 'path';
import { execAsync, readDir, isDir } from './utils';
import { detectEnvWin } from '../platform/win/envDetector';
import { detectEnvLinux } from '../platform/linux/envDetector';
import { log } from '../../core/logger';

// 重新导出，供 platform 子模块使用
export { execAsync, readDir, isDir };

export interface EnvInfo {
    vs: VSInfo | null;
    qt: QtInfo | null;
    qtCandidates: QtInfo[];
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

// 扫描目录列表，找到所有含 qmake 的 Qt 路径，按版本降序返回
export async function scanQt(parentDirs: string[], tag: string): Promise<string[]> {
    const scanRoots = collectQtDirs(parentDirs);
    log(`[${tag}] 扫描目录: ${scanRoots.join(', ') || '无'}`);
    const found: Array<{ path: string; version: string }> = [];
    for (const root of scanRoots) {
        const qtPath = findQmakeIn(root);
        if (!qtPath) { continue; }
        const m = qtPath.match(/(\d+\.\d+\.\d+)/);
        found.push({ path: qtPath, version: m ? m[1] : '0.0.0' });
    }
    found.sort((a, b) => compareVersion(b.version, a.version));
    if (found.length > 0) { log(`[${tag}] 扫描找到 ${found.length} 个 Qt: ${found.map(f => f.path).join(', ')}`); }
    return found.map(f => f.path);
}

// ── 入口 ──

export async function detectEnv(manualQtPath?: string, manualVsPath?: string): Promise<EnvInfo> {
    if (process.platform === 'win32') {
        return detectEnvWin(manualQtPath, manualVsPath);
    } else {
        return detectEnvLinux(manualQtPath);
    }
}
