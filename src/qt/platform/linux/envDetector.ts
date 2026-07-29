import * as fs from 'fs';
import * as path from 'path';
import { EnvInfo, QtInfo, execAsync, hasQmake, parseQtInfo, scanQt } from '../../env/envDetector';
import { log } from '../../../core/loggerBase';

// Linux 默认编译器从路径推断
function detectCompiler(qtPath: string): string {
    if (qtPath.includes('clang')) { return 'clang'; }
    return 'gcc';
}

async function detectQt(manualPath?: string): Promise<{ qt: QtInfo | null; candidates: QtInfo[] }> {
    const candidates: QtInfo[] = [];

    // 1. 目录扫描（收集所有版本）
    const parentDirs = ['/opt', '/usr/local', process.env.HOME || ''];
    const foundPaths = await scanQt(parentDirs, 'Linux');
    for (const p of foundPaths) {
        candidates.push(await parseQtInfo(p, detectCompiler(p)));
    }

    // 2. 系统 PATH（which qmake）
    const whichOut = (await execAsync('which', ['qmake'])).trim();
    if (whichOut && fs.existsSync(whichOut)) {
        const qtRoot = path.dirname(path.dirname(whichOut));
        if (hasQmake(qtRoot) && !candidates.some(c => c.path === qtRoot)) {
            log(`[Linux] PATH 找到 Qt: "${qtRoot}"`);
            candidates.unshift(await parseQtInfo(qtRoot, detectCompiler(qtRoot)));
        }
    }

    // 3. 手动配置：验证有效性，插到最前面作为当前选中版本
    if (manualPath) {
        log(`[Linux] 手动 Qt 路径: "${manualPath}"`);
        if (!hasQmake(manualPath)) {
            log('[Linux] 手动路径无效');
        } else {
            const manual = await parseQtInfo(manualPath, detectCompiler(manualPath));
            const filtered = candidates.filter(c => c.path !== manualPath);
            return { qt: manual, candidates: [manual, ...filtered] };
        }
    }

    if (candidates.length === 0) { log('[Linux] 未检测到 Qt'); return { qt: null, candidates: [] }; }
    return { qt: candidates[0], candidates };
}

async function detectMake(qt: QtInfo | null): Promise<string | null> {
    if (!qt) { return null; }
    try {
        const out = await execAsync('which', ['make']);
        const makePath = out.trim();
        if (makePath && fs.existsSync(makePath)) { return makePath; }
    } catch { /* which not found OK */ }
    try {
        const out = await execAsync('make', ['--version']);
        if (out.toLowerCase().includes('make')) { return 'make'; }
    } catch { /* make not available */ }
    return null;
}

export async function detectEnvLinux(manualQtPath?: string): Promise<EnvInfo> {
    const { qt, candidates } = await detectQt(manualQtPath);
    const jom = await detectMake(qt);
    return { vs: null, qt, qtCandidates: candidates, vsCandidates: [], jom };
}
