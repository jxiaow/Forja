import * as fs from 'fs';
import * as path from 'path';
import { EnvInfo, VSInfo, QtInfo, execAsync, hasQmake, parseQtInfo, scanQt } from '../../env/envDetector';
import { log } from '../../../core/loggerBase';

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
            if (n >= 18) { version = '2026'; }
            else if (n >= 17) { version = '2022'; }
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
    if (qtPath.includes('msvc2022_64')) { return 'msvc2022_64'; }
    if (qtPath.includes('msvc2022')) { return 'msvc2022'; }
    if (qtPath.includes('msvc2019_64')) { return 'msvc2019_64'; }
    if (qtPath.includes('msvc2019')) { return 'msvc2019'; }
    if (qtPath.includes('mingw')) { return 'mingw'; }
    return 'msvc2019';
}

/** 从注册表扫描 Qt 安装路径 */
async function _scanQtFromRegistry(): Promise<string[]> {
    const results: string[] = [];
    // 注册表扫描：Qt 安装器可能写入非标准路径
    // HKCU\Software\QtProject 下含 QtCreator 配置，递归查询较慢但能发现非硬编码路径
    const regKeys = [
        'HKCU\\Software\\QtProject',
        'HKLM\\SOFTWARE\\WOW6432Node\\Digia\\Versions',
        'HKLM\\SOFTWARE\\Digia\\Versions'
    ];
    for (const key of regKeys) {
        try {
            const out = await execAsync('reg', ['query', key, '/s'], 30000);
            // 提取看起来像 Qt 路径的值（包含 qmake 的目录）
            const lines = out.split('\n');
            for (const line of lines) {
                const match = line.match(/REG_SZ\s+(.+)/i);
                if (!match) { continue; }
                const value = match[1].trim();
                // 检查是否是有效的 Qt 编译器目录（含 bin/qmake.exe）
                if (hasQmake(value)) {
                    if (!results.includes(value)) {
                        log(`[Win] 注册表找到 Qt: "${value}"`);
                        results.push(value);
                    }
                }
                // 也检查是否是 Qt 根目录（需要向下找版本子目录）
                if (fs.existsSync(value) && !hasQmake(value)) {
                    const subPaths = await scanQt([value], 'Win');
                    for (const sp of subPaths) {
                        if (!results.includes(sp)) {
                            log(`[Win] 注册表子目录找到 Qt: "${sp}"`);
                            results.push(sp);
                        }
                    }
                }
            }
        } catch { /* registry key not found or access denied */ }
    }
    return results;
}

async function detectQt(manualPath?: string): Promise<{ qt: QtInfo | null; candidates: QtInfo[] }> {
    const candidates: QtInfo[] = [];

    // 1. 目录扫描（收集所有版本）
    const parentDirs = ['C:\\Qt', 'C:\\QtCompile', 'D:\\Qt', 'E:\\Qt'];
    const foundPaths = await scanQt(parentDirs, 'Win');
    for (const p of foundPaths) {
        candidates.push(await parseQtInfo(p, detectCompiler(p)));
    }

    // 1.5 注册表扫描（Qt 安装器可能写入非标准路径）
    const regPaths = await _scanQtFromRegistry();
    for (const rp of regPaths) {
        if (!candidates.some(c => c.path === rp)) {
            candidates.push(await parseQtInfo(rp, detectCompiler(rp)));
        }
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

async function detectJom(qt: QtInfo | null): Promise<string | null> {
    // 1. Qt 编译器目录下 bin/jom.exe
    if (qt) {
        const p = path.join(qt.path, 'bin', 'jom.exe');
        if (fs.existsSync(p)) { log(`[Win] 找到 jom: "${p}"`); return p; }
    }

    // 2. Qt 安装根目录下 Tools/QtCreator/bin/jom/jom.exe
    if (qt) {
        // 从 qt.path（如 C:\Qt\5.15.2\msvc2019）向上找 Qt 安装根
        let dir = qt.path;
        for (let i = 0; i < 4; i++) {
            const parent = path.dirname(dir);
            if (parent === dir) { break; }
            const jomPath = path.join(parent, 'Tools', 'QtCreator', 'bin', 'jom', 'jom.exe');
            if (fs.existsSync(jomPath)) {
                log(`[Win] 找到 jom: "${jomPath}"`);
                return jomPath;
            }
            dir = parent;
        }
    }

    // 3. 常见固定路径
    const knownPaths = ['C:\\Qt', 'C:\\QtCompile', 'D:\\Qt', 'E:\\Qt'];
    for (const root of knownPaths) {
        const jomPath = path.join(root, 'Tools', 'QtCreator', 'bin', 'jom', 'jom.exe');
        if (fs.existsSync(jomPath)) {
            log(`[Win] 找到 jom: "${jomPath}"`);
            return jomPath;
        }
        // 也检查根目录下直接放 jom 的情况（如 C:\QtCompile\jom\jom.exe）
        const jomDirect = path.join(root, 'jom', 'jom.exe');
        if (fs.existsSync(jomDirect)) {
            log(`[Win] 找到 jom: "${jomDirect}"`);
            return jomDirect;
        }
    }

    // 4. 系统 PATH
    try {
        const out = await execAsync('where', ['jom.exe']);
        const firstLine = out.trim().split('\n')[0].trim();
        if (firstLine && fs.existsSync(firstLine)) {
            log(`[Win] PATH 找到 jom: "${firstLine}"`);
            return firstLine;
        }
    } catch { /* jom not in PATH */ }

    return null;
}

// ── VS 扫描所有已安装实例 ──

async function scanVS(): Promise<VSInfo[]> {
    const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    if (!fs.existsSync(vswhere)) { return []; }
    try {
        const out = (await execAsync(vswhere, ['-all', '-property', 'installationPath'])).trim();
        if (!out) { return []; }
        const results: VSInfo[] = [];
        const seen = new Set<string>();
        for (const line of out.split('\n')) {
            const installPath = line.trim();
            if (!installPath) { continue; }
            const normalized = installPath.toLowerCase();
            if (seen.has(normalized)) { continue; }
            seen.add(normalized);
            const devShellPath = `${installPath}\\Common7\\Tools\\Launch-VsDevShell.ps1`;
            if (fs.existsSync(devShellPath)) {
                results.push(parseVsPath(devShellPath));
            }
        }
        return results;
    } catch {
        return [];
    }
}

export async function detectEnvWin(manualQtPath?: string, manualVsPath?: string): Promise<EnvInfo> {
    // 指定了哪个就跳过哪个的全量扫描，只验证指定路径
    const vsPromise = manualVsPath
        ? Promise.resolve(fs.existsSync(manualVsPath) ? parseVsPath(manualVsPath) : null)
        : detectVS();

    const qtPromise = manualQtPath
        ? (async () => {
            if (!hasQmake(manualQtPath)) { return { qt: null, candidates: [] as QtInfo[] }; }
            const qt = await parseQtInfo(manualQtPath, detectCompiler(manualQtPath));
            return { qt, candidates: [qt] };
        })()
        : detectQt();

    const vsCandidatesPromise = manualVsPath
        ? Promise.resolve(
            fs.existsSync(manualVsPath) ? [parseVsPath(manualVsPath)] : [] as VSInfo[]
        )
        : scanVS();

    const [vs, { qt, candidates }, vsCandidates] = await Promise.all([
        vsPromise,
        qtPromise,
        vsCandidatesPromise
    ]);
    const jom = await detectJom(qt);
    return { vs, qt, qtCandidates: candidates, vsCandidates, jom };
}
