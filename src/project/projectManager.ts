import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../core/logger';
import { decodeSelectedProject, encodeSelectedProject } from '../core/selectedProject';
import { getEffectiveProjectName, getProjectSelectionLabel } from '../core/projectDisplay';
import { getQmakeTarget } from '../core/configService';
import { getState } from '../core/stateManager';
import { getSetting, setSetting } from '../core/settingsStore';
import { setProjectRoot } from '../core/workspaceResolver';
import { scanProFiles as sharedScanProFiles, parseProFile as sharedParseProFile } from '../coreCli/projectScanner';

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

const logger = createLogger('Project');

export function scanProFiles(root: string): string[] {
    return sharedScanProFiles(root);
}

// ── Makefile 解析（qmake 生成的最终值，最可靠） ──

// 读取文件内容，失败返回 null
function _readFile(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath)) { return null; }
        return fs.readFileSync(filePath, 'utf-8');
    } catch {}
    return null;
}

// 从已读取的内容中解析变量值（支持多空格对齐）
function _parseMakefileVar(content: string, varName: string): string | null {
    const match = content.match(new RegExp(`^${varName}[ \\t]+=[ \\t]*(.+)$`, 'm'));
    if (!match) {
        logger.warn(`Makefile var not found: "${varName}"`);
        return null;
    }
    return match[1].replace(/#.*$/, '').trim();
}

// 从 Makefile 头部注释读取生成时的 mode
function _parseMakefileMode(content: string): string | null {
    const match = content.match(/^#\s*Command:.*CONFIG\+=(\w+)/m);
    if (!match) { return null; }
    if (match[1] === 'release') { return 'release'; }
    if (match[1] === 'debug') { return 'debug'; }
    return null;
}

// 从主 Makefile 头部注释校验 mode 和 arch 是否匹配
function _validateMakefileConfig(content: string, mode: string, arch: string): boolean {
    const match = content.match(/^#\s*Command:.*$/m);
    if (!match) { return false; }
    const cmd = match[0];
    const hasMode = cmd.includes(`CONFIG+=${mode}`);
    const hasArch = cmd.includes(`CONFIG+=${arch}`);
    logger.info(`Validate Makefile config: cmd="${cmd.trim()}", hasMode=${hasMode}, hasArch=${hasArch}`);
    return hasMode && hasArch;
}

export function getMakefileInfo(projectDir: string, mode?: string, arch?: string): MakefileInfo | null {
    const mf = path.join(projectDir, 'Makefile');
    logger.info(`Get MakefileInfo: platform=${process.platform}, projectDir="${projectDir}", mode="${mode}", arch="${arch}"`);

    // 一次读取主 Makefile
    const mfContent = _readFile(mf);
    if (!mfContent) {
        logger.warn(`Makefile not found: ${mf}`);
        return null;
    }

    if (process.platform === 'win32') {
        // Windows: 校验 mode + arch，从 Makefile.Release/Debug 读 DESTDIR_TARGET
        if (mode && arch) {
            const valid = _validateMakefileConfig(mfContent, mode, arch);
            if (!valid) {
                logger.warn(`Makefile validation failed: mode=${mode}, arch=${arch}`);
                return null;
            }
            logger.info(`Makefile validation passed: mode=${mode}, arch=${arch}`);
        }
        const subMfPath = mode
            ? path.join(projectDir, `Makefile.${mode.charAt(0).toUpperCase() + mode.slice(1)}`)
            : mf;
        logger.info(`Use sub Makefile: ${subMfPath}`);
        // 一次读取子 Makefile
        const subContent = _readFile(subMfPath);
        if (!subContent) {
            logger.warn(`Sub Makefile not found: ${subMfPath}`);
            return null;
        }
        const destDirTarget = _parseMakefileVar(subContent, 'DESTDIR_TARGET');
        logger.info(`DESTDIR_TARGET="${destDirTarget}"`);
        if (!destDirTarget) { return null; }
        const exePath = path.join(projectDir, destDirTarget.replace(/\\/g, path.sep));
        const target = path.basename(destDirTarget.replace(/\.exe$/i, ''));
        const destDir = path.dirname(destDirTarget).replace(/\\/g, '/');
        logger.info(`Resolved target="${target}", destDir="${destDir}", exePath="${exePath}", exists=${fs.existsSync(exePath)}`);
        return { target, destDir, exePath };
    } else {
        // Linux: 只校验 mode，从主 Makefile 读 TARGET
        if (mode) {
            const mfMode = _parseMakefileMode(mfContent);
            logger.info(`Makefile mode="${mfMode}", current mode="${mode}"`);
            if (mfMode && mfMode !== mode) {
                logger.warn(`Makefile mode mismatch: makefile=${mfMode}, current=${mode}`);
                return null;
            }
            logger.info(`Makefile validation passed: mode=${mode}`);
        }
        const t = _parseMakefileVar(mfContent, 'TARGET');
        logger.info(`TARGET="${t}"`);
        if (!t) { return null; }
        const target = path.basename(t);
        const destDir = path.dirname(t) !== '.' ? path.dirname(t) : '';
        const exePath = path.join(projectDir, t);
        logger.info(`Resolved target="${target}", destDir="${destDir}", exePath="${exePath}", exists=${fs.existsSync(exePath)}`);
        return { target, destDir, exePath };
    }
}

// ── .pro 文件解析（只取显示名 + IntelliSense 需要的信息） ──

export function parseProFile(proPath: string): ProjectInfo {
    const info = sharedParseProFile(proPath);
    if (!info) {
        // Fallback for unreadable files — maintain existing behavior (throw)
        fs.readFileSync(proPath, 'utf-8'); // will throw
        // unreachable, but satisfies return type
        return { proPath, projectDir: '', proFile: path.basename(proPath), target: path.basename(proPath, '.pro'), qtModules: [], defines: [] };
    }
    return {
        proPath: info.proPath,
        projectDir: info.projectDir,
        proFile: info.proFile,
        target: info.target,
        qtModules: info.qtModules,
        defines: info.defines
    };
}

/** 从 Makefile 中读取 LIBS 变量，提取 -L 库搜索路径 */
export function parseLibPaths(projectDir: string): string[] {
    const mf = path.join(projectDir, 'Makefile');
    const content = _readFile(mf);
    if (!content) { return []; }
    const libs = _parseMakefileVar(content, 'LIBS');
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

    const savedProject = getSetting('selectedProject');

    if (!forceSelect && savedProject) {
        const savedRef = decodeSelectedProject(savedProject);
        if (savedRef) {
            const fullPath = path.join(savedRef.root, savedRef.relative);
            if (fs.existsSync(fullPath)) {
                const info = parseProFile(fullPath);
                info.projectDir = path.dirname(savedRef.relative);
                return info;
            }
        }
    }

    const allProFiles: { label: string; root: string; relative: string }[] = [];
    for (const folder of folders) {
        const root = folder.uri.fsPath;
        const proFiles = scanProFiles(root);
        for (const rel of proFiles) {
            const fullPath = path.join(root, rel);
            let label: string;
            try {
                const info = parseProFile(fullPath);
                label = getProjectSelectionLabel(info, rel, folders.length > 1 ? folder.name : '');
            } catch {
                logger.warn(`解析 .pro 失败, 使用路径显示: ${fullPath}`);
                label = getProjectSelectionLabel(null, rel, folders.length > 1 ? folder.name : '');
            }
            allProFiles.push({
                label,
                root,
                relative: rel
            });
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
        setProjectRoot(item.root);
        setSetting('selectedProject', encodeSelectedProject(item.root, item.relative));
        return info;
    }

    const selected = await vscode.window.showQuickPick(
        allProFiles.map(f => f.label),
        { placeHolder: `切换项目 · 当前 ${getEffectiveProjectName(getState().currentProject, getQmakeTarget(), '未选择项目')}` }
    );

    if (selected) {
        const item = allProFiles.find(f => f.label === selected);
        if (item) {
            const fullPath = path.join(item.root, item.relative);
            const info = parseProFile(fullPath);
            info.projectDir = path.dirname(item.relative);
            setProjectRoot(item.root);
            setSetting('selectedProject', encodeSelectedProject(item.root, item.relative));
            return info;
        }
    }

    return null;
}
