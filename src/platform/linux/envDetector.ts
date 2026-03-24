import * as fs from 'fs';
import * as path from 'path';
import { EnvInfo, QtInfo, execAsync, hasQmake, parseQtInfo, scanQt } from '../../envDetector';
import { log } from '../../logger';

// Linux 默认编译器从路径推断
function detectCompiler(qtPath: string): string {
    if (qtPath.includes('clang')) { return 'clang'; }
    return 'gcc';
}

async function detectQt(manualPath?: string): Promise<QtInfo | null> {
    // 1. 手动配置优先
    if (manualPath) {
        log(`[Linux] 手动 Qt 路径: "${manualPath}"`);
        if (!hasQmake(manualPath)) { log('[Linux] 手动路径无效'); return null; }
        return parseQtInfo(manualPath, detectCompiler(manualPath));
    }

    // 2. 环境变量
    const qtdir = process.env.QTDIR || process.env.Qt6_DIR || process.env.Qt5_DIR;
    if (qtdir && hasQmake(qtdir)) {
        log(`[Linux] 环境变量找到 Qt: "${qtdir}"`);
        return parseQtInfo(qtdir, detectCompiler(qtdir));
    }

    // 3. 目录扫描（选版本最高的）
    const parentDirs = ['/opt', '/usr/local', process.env.HOME || ''];
    const found = await scanQt(parentDirs, 'Linux');
    if (found) { return parseQtInfo(found, detectCompiler(found)); }

    // 4. 系统 PATH（which qmake）
    const whichOut = (await execAsync('which', ['qmake'])).trim();
    if (whichOut && fs.existsSync(whichOut)) {
        const qtRoot = path.dirname(path.dirname(whichOut));
        if (hasQmake(qtRoot)) {
            log(`[Linux] PATH 找到 Qt: "${qtRoot}"`);
            return parseQtInfo(qtRoot, detectCompiler(qtRoot));
        }
    }

    log('[Linux] 未检测到 Qt');
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
    return { vs: null, qt, jom };
}
