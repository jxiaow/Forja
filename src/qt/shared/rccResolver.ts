/**
 * RCC 资源编译 — 共享逻辑（不依赖 vscode，CLI 和扩展复用）
 */
import * as fs from 'fs';
import * as path from 'path';

export interface RccTarget {
    name: string;
    dir: string;
}

/**
 * 解析 RCC 项目路径：配置优先，否则自动扫描
 */
export function resolveRccProjectPath(configuredPath: string, workspace: string): string | null {
    // 配置优先
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }
    // 自动扫描
    const candidate = path.join(workspace, 'XYRcc');
    if (fs.existsSync(candidate)) { return candidate; }
    const parent = path.dirname(workspace);
    const parentCandidate = path.join(parent, 'XYRcc');
    if (fs.existsSync(parentCandidate)) { return parentCandidate; }
    return null;
}

/**
 * 递归扫描 RCC 项目目录，找到所有含 <name>.qrc 的子目录
 */
export function scanRccTargets(rccProjectPath: string): RccTarget[] {
    const targets: RccTarget[] = [];
    const scanDir = (dir: string) => {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subDir = path.join(dir, entry.name);
                    const qrcFile = path.join(subDir, `${entry.name}.qrc`);
                    if (fs.existsSync(qrcFile)) {
                        targets.push({ name: entry.name, dir: subDir });
                    } else {
                        scanDir(subDir);
                    }
                }
            }
        } catch (e) {
            // 权限不足或其他 IO 错误时记录，不中断扫描
            console.warn(`[rccResolver] scanRccTargets failed on "${dir}": ${e instanceof Error ? e.message : e}`);
        }
    };
    scanDir(rccProjectPath);
    return targets;
}

/**
 * 检查是否有 rcc target 需要重新编译
 * 比较 .rcc 输出文件和 .qrc 及其引用资源的 mtime
 */
export function rccNeedsRebuild(targets: RccTarget[]): boolean {
    for (const target of targets) {
        const rccFile = path.join(target.dir, `${target.name}.rcc`);
        const qrcFile = path.join(target.dir, `${target.name}.qrc`);

        if (!fs.existsSync(rccFile)) { return true; }

        const rccMtime = fs.statSync(rccFile).mtimeMs;

        if (fs.statSync(qrcFile).mtimeMs > rccMtime) { return true; }

        try {
            const qrcContent = fs.readFileSync(qrcFile, 'utf-8');
            const fileMatches = qrcContent.matchAll(/<file[^>]*>([^<]+)<\/file>/g);
            for (const match of fileMatches) {
                const resPath = path.join(target.dir, match[1]);
                if (fs.existsSync(resPath) && fs.statSync(resPath).mtimeMs > rccMtime) {
                    return true;
                }
            }
        } catch { /* qrc read failure tolerated */ }
    }
    return false;
}

/**
 * 生成 rcc 编译命令序列（跨平台）
 */
export function buildRccCommands(
    targets: RccTarget[],
    qtPath: string,
    outputDir: string | null,
    platform: 'win32' | 'linux'
): string[] {
    const isWin = platform === 'win32';
    const commands: string[] = [];

    const qtBin = qtPath ? path.join(qtPath, 'bin') : '';
    if (qtBin) {
        commands.push(isWin ? `set "PATH=${qtBin};%PATH%"` : `export PATH="${qtBin}:$PATH"`);
    }

    for (const target of targets) {
        const rccOutput = path.join(target.dir, `${target.name}.rcc`);
        commands.push(isWin ? `cd /d "${target.dir}"` : `cd "${target.dir}"`);
        commands.push(`rcc -binary "${target.name}.qrc" -o "${target.name}.rcc"`);
        if (outputDir) {
            if (isWin) {
                commands.push(`copy /Y "${rccOutput}" "${outputDir}\\"`);
            } else {
                commands.push(`cp "${rccOutput}" "${outputDir}/"`);
            }
        }
    }

    return commands;
}
