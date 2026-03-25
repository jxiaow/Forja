import * as fs from 'fs';
import * as path from 'path';
import { EnvInfo, VSInfo, QtInfo, execAsync, hasQmake, parseQtInfo, scanQt } from '../../env/envDetector';
import { log } from '../../core/logger';

// ── VS 检测 ──

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

// ── Qt 检测 ──

// Windows 编译器从路径推断
function detectCompiler(qtPath: string): string {
    if (qtPath.includes('msvc2022')) { return 'msvc2022'; }
    if (qtPath.includes('msvc2019')) { return 'msvc2019'; }
    if (qtPath.includes('mingw')) { return 'mingw'; }
    return 'msvc2019';
}

async function detectQt(manualPath?: string): Promise<{ qt: QtInfo | null; candidates: QtInfo[] }> {
    const candidates: QtInfo[] = [];

    // 1. 目录扫描（收集所有版本）
    const parentDirs = ['C:\\Qt', 'C:\\QtCompile', 'D:\\Qt', 'E:\\Qt'];
    const foundPaths = await scanQt(parentDirs, 'Win');
    for (const p of foundPaths) {
        candidates.push(await parseQtInfo(p, detectCompiler(p)));
    }

    // 2. 系统 PATH（where qmake）
    const whereOut = (await execAsync('where', ['qmake'])).trim().split('\n')[0].trim();
    if (whereOut && fs.existsSync(whereOut)) {
        const qtRoot = path.dirname(path.dirname(whereOut));
        if (hasQmake(qtRoot) && !candidates.some(c => c.path === qtRoot)) {
            log(`[Win] PATH 找到 Qt: "${qtRoot}"`);
            candidates.unshift(await parseQtInfo(qtRoot, detectCompiler(qtRoot)));
        }
    }

    // 3. 手动配置：验证有效性，插到最前面作为当前选中版本
    if (manualPath) {
        log(`[Win] 手动 Qt 路径: "${manualPath}"`);
        if (!hasQmake(manualPath)) {
            log('[Win] 手动路径无效');
        } else {
            const manual = await parseQtInfo(manualPath, detectCompiler(manualPath));
            // 去重后置顶
            const filtered = candidates.filter(c => c.path !== manualPath);
            const qt = manual;
            return { qt, candidates: [manual, ...filtered] };
        }
    }

    if (candidates.length === 0) { log('[Win] 未检测到 Qt'); return { qt: null, candidates: [] }; }
    return { qt: candidates[0], candidates };
}

// ── Jom 检测 ──

async function detectJom(qt: QtInfo | null): Promise<boolean> {
    if (!qt) { return false; }
    if (fs.existsSync(path.join(qt.path, 'bin', 'jom.exe'))) { return true; }
    const out = await execAsync('jom', ['/VERSION']);
    return out.trim().length > 0;
}

export async function detectEnvWin(manualQtPath?: string, manualVsPath?: string): Promise<EnvInfo> {
    const [vs, { qt, candidates }] = await Promise.all([detectVS(manualVsPath || undefined), detectQt(manualQtPath)]);
    const jom = await detectJom(qt);
    return { vs, qt, qtCandidates: candidates, jom };
}
