import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/logger';

export interface ProjectInfo {
    proPath: string;        // .pro 文件完整路径
    projectDir: string;     // 项目目录（相对于 workspace）
    proFile: string;        // .pro 文件名
    target: string;         // TARGET 名称（显示用，从 .pro 粗略解析）
    qtModules: string[];    // QT 模块列表
    defines: string[];      // DEFINES
}

export interface MakefileInfo {
    target: string;         // 可执行文件名（不含 .exe）
    destDir: string;        // 输出目录
    exePath: string;        // 完整可执行文件绝对路径
}

const maxScanDepth = 5;

export function scanProFiles(root: string): string[] {
    const proFiles: string[] = [];

    function scan(dir: string, depth: number): void {
        if (depth > maxScanDepth) { return; }
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const skip = ['node_modules', '.git', 'build', 'debug', 'release', 'out'];
                if (entry.isDirectory() && !skip.includes(entry.name.toLowerCase())) {
                    scan(path.join(dir, entry.name), depth + 1);
                } else if (entry.isFile() && entry.name.endsWith('.pro')) {
                    proFiles.push(path.join(dir, entry.name));
                }
            }
        } catch {}
    }

    scan(root, 0);
    return proFiles.map(p => path.relative(root, p).replace(/\\/g, '/'));
}

// ── Makefile 解析（qmake 生成的最终值，最可靠） ──

function _parseMakefileVar(makefilePath: string, varName: string): string | null {
    try {
        if (!fs.existsSync(makefilePath)) { return null; }
        const content = fs.readFileSync(makefilePath, 'utf-8');
        // 支持多空格对齐（qmake 生成的 Makefile 用空格对齐变量名）
        const match = content.match(new RegExp(`^${varName}[ \\t]+=[ \\t]*(.+)$`, 'm'));
        if (!match) {
            log(`[parseMakefileVar] "${varName}" 未匹配`);
            return null;
        }
        return match[1].replace(/#.*$/, '').trim();
    } catch {}
    return null;
}

// 从 Makefile 头部注释读取生成时的 mode（CONFIG+=release 或 CONFIG+=debug）
function _parseMakefileMode(makefilePath: string): string | null {
    try {
        if (!fs.existsSync(makefilePath)) { return null; }
        const content = fs.readFileSync(makefilePath, 'utf-8');
        const match = content.match(/^#\s*Command:.*CONFIG\+=(\w+)/m);
        if (!match) { return null; }
        if (match[1] === 'release') { return 'release'; }
        if (match[1] === 'debug') { return 'debug'; }
    } catch {}
    return null;
}

// 从主 Makefile 头部注释校验 mode 和 arch 是否匹配
function _validateMakefileConfig(makefilePath: string, mode: string, arch: string): boolean {
    try {
        const content = fs.readFileSync(makefilePath, 'utf-8');
        const match = content.match(/^#\s*Command:.*$/m);
        if (!match) { return false; }
        const cmd = match[0];
        const hasMode = cmd.includes(`CONFIG+=${mode}`);
        const hasArch = cmd.includes(`CONFIG+=${arch}`);
        log(`[validateMakefileConfig] cmd="${cmd.trim()}", hasMode=${hasMode}, hasArch=${hasArch}`);
        return hasMode && hasArch;
    } catch {}
    return false;
}

export function getMakefileInfo(projectDir: string, mode?: string, arch?: string): MakefileInfo | null {
    const mf = path.join(projectDir, 'Makefile');
    log(`[getMakefileInfo] platform=${process.platform}, projectDir="${projectDir}", mode="${mode}", arch="${arch}"`);
    if (!fs.existsSync(mf)) {
        log(`[getMakefileInfo] Makefile 不存在: ${mf}`);
        return null;
    }
    log(`[getMakefileInfo] Makefile 存在: ${mf}`);

    if (process.platform === 'win32') {
        // Windows: 校验 mode + arch，从 Makefile.Release/Debug 读 DESTDIR_TARGET
        if (mode && arch) {
            const valid = _validateMakefileConfig(mf, mode, arch);
            if (!valid) {
                log(`[getMakefileInfo] 校验失败: mode=${mode} arch=${arch} 与 Makefile 不匹配，请重新运行 QMake`);
                return null;
            }
            log(`[getMakefileInfo] 校验通过: mode=${mode} arch=${arch}`);
        }
        const subMf = mode
            ? path.join(projectDir, `Makefile.${mode.charAt(0).toUpperCase() + mode.slice(1)}`)
            : mf;
        log(`[getMakefileInfo] 子 Makefile: ${subMf}`);
        if (!fs.existsSync(subMf)) {
            log(`[getMakefileInfo] 子 Makefile 不存在: ${subMf}`);
            return null;
        }
        const destDirTarget = _parseMakefileVar(subMf, 'DESTDIR_TARGET');
        log(`[getMakefileInfo] DESTDIR_TARGET="${destDirTarget}"`);
        if (!destDirTarget) { return null; }
        const exePath = path.join(projectDir, destDirTarget.replace(/\\/g, path.sep));
        const target = path.basename(destDirTarget.replace(/\.exe$/i, ''));
        const destDir = path.dirname(destDirTarget).replace(/\\/g, '/');
        log(`[getMakefileInfo] target="${target}", destDir="${destDir}", exePath="${exePath}", exists=${fs.existsSync(exePath)}`);
        return { target, destDir, exePath };
    } else {
        // Linux: 只校验 mode，从主 Makefile 读 TARGET
        if (mode) {
            const mfMode = _parseMakefileMode(mf);
            log(`[getMakefileInfo] mfMode="${mfMode}", mode="${mode}"`);
            if (mfMode && mfMode !== mode) {
                log(`[getMakefileInfo] 校验失败: Makefile mode=${mfMode} 与当前 mode=${mode} 不匹配，请重新运行 QMake`);
                return null;
            }
            log(`[getMakefileInfo] 校验通过: mode=${mode}`);
        }
        const t = _parseMakefileVar(mf, 'TARGET');
        log(`[getMakefileInfo] TARGET="${t}"`);
        if (!t) { return null; }
        // Linux 的 TARGET 已包含完整相对路径，如 build_linux/debug/XYWinQTPri
        const target = path.basename(t);
        const destDir = path.dirname(t) !== '.' ? path.dirname(t) : '';
        const exePath = path.join(projectDir, t);
        log(`[getMakefileInfo] target="${target}", destDir="${destDir}", exePath="${exePath}", exists=${fs.existsSync(exePath)}`);
        return { target, destDir, exePath };
    }
}

// ── .pro 文件解析（只取显示名 + IntelliSense 需要的信息） ──

export function parseProFile(proPath: string): ProjectInfo {
    const content = fs.readFileSync(proPath, 'utf-8');
    const projectDir = path.dirname(proPath);
    const proFile = path.basename(proPath);

    // TARGET：粗略解析，仅用于 UI 显示
    let target = path.basename(proFile, '.pro');
    const targetMatch = content.match(/^\s*TARGET\s*=\s*(\S+)/m);
    if (targetMatch) { target = targetMatch[1].trim(); }

    // QT 模块
    const qtMatch = content.match(/^\s*QT\s*\+?=\s*(.+)$/m);
    const qtModules = qtMatch ? qtMatch[1].trim().split(/\s+/) : ['core', 'gui', 'widgets'];

    // DEFINES
    const definesMatch = content.match(/^\s*DEFINES\s*\+?=\s*(.+)$/m);
    const defines = definesMatch ? definesMatch[1].trim().split(/\s+/) : [];

    return {
        proPath,
        projectDir: path.basename(projectDir),
        proFile,
        target,
        qtModules,
        defines
    };
}

/** 从 Makefile 中读取 LIBS 变量，提取 -L 库搜索路径（qmake 已展开所有变量和 scope） */
export function parseLibPaths(projectDir: string): string[] {
    const mf = path.join(projectDir, 'Makefile');
    const libs = _parseMakefileVar(mf, 'LIBS');
    if (!libs) { return []; }
    const paths: string[] = [];
    const matches = libs.matchAll(/-L(\S+)/g);
    for (const m of matches) {
        const p = m[1];
        const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(projectDir, p);
        if (fs.existsSync(abs)) {
            paths.push(abs);
        }
    }
    return paths;
}

export async function selectProject(context: vscode.ExtensionContext, forceSelect = false): Promise<ProjectInfo | null> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('请先打开工作区');
        return null;
    }

    const config = vscode.workspace.getConfiguration('xyQt');
    const savedProject = config.get<string>('selectedProject');

    // 已保存的项目：尝试在所有 workspace folders 中定位
    if (!forceSelect && savedProject) {
        for (const folder of folders) {
            const fullPath = path.join(folder.uri.fsPath, savedProject);
            if (fs.existsSync(fullPath)) {
                const info = parseProFile(fullPath);
                info.projectDir = path.dirname(savedProject);
                return info;
            }
        }
    }

    // 扫描所有 workspace folders
    const allProFiles: { label: string; root: string; relative: string }[] = [];
    for (const folder of folders) {
        const root = folder.uri.fsPath;
        const proFiles = scanProFiles(root);
        for (const rel of proFiles) {
            const folderName = folders.length > 1 ? `[${folder.name}] ` : '';
            allProFiles.push({ label: folderName + rel, root, relative: rel });
        }
    }

    if (allProFiles.length === 0) {
        vscode.window.showWarningMessage('未找到 .pro 文件，请在配置面板中手动设置');
        return null;
    }

    if (allProFiles.length === 1 && !forceSelect) {
        const item = allProFiles[0];
        const fullPath = path.join(item.root, item.relative);
        const info = parseProFile(fullPath);
        info.projectDir = path.dirname(item.relative);
        await config.update('selectedProject', item.relative, vscode.ConfigurationTarget.Workspace);
        return info;
    }

    const selected = await vscode.window.showQuickPick(
        allProFiles.map(f => f.label),
        { placeHolder: '选择项目' }
    );

    if (selected) {
        const item = allProFiles.find(f => f.label === selected);
        if (item) {
            const fullPath = path.join(item.root, item.relative);
            const info = parseProFile(fullPath);
            info.projectDir = path.dirname(item.relative);
            await config.update('selectedProject', item.relative, vscode.ConfigurationTarget.Workspace);
            return info;
        }
    }

    return null;
}
