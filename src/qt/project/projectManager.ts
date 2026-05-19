import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../core/logger';
import { decodePinnedProject, encodePinnedProject } from './pinnedProject';
import { getEffectiveProjectName, getProjectSelectionLabel } from './projectDisplay';
import { getTarget } from '../services/configService';
import { getState } from '../../core/qtState';
import { getQtSetting, setQtSetting } from '../../core/settingsStore';
import { setProjectRoot } from '../../core/workspaceResolver';
import { scanProFiles as sharedScanProFiles, parseProFile as sharedParseProFile } from '../shared/projectScanner';
import { resolveRuntimeTarget, parseRuntimeLibPaths } from '../shared/runtimeTarget';

import { ProjectInfo } from './types';
export type { ProjectInfo } from './types';
export interface MakefileInfo {
    target: string;         // 可执行文件名（不含 .exe）
    destDir: string;        // 输出目录
    exePath: string;        // 完整可执行文件绝对路径
}

const logger = createLogger('Project');

export function scanProFiles(root: string): string[] {
    return sharedScanProFiles(root);
}

// ── Makefile 解析（委托给 shared/runtimeTarget） ──

export function getMakefileInfo(projectDir: string, mode?: string, arch?: string): MakefileInfo | null {
    logger.info(`Get MakefileInfo: projectDir="${projectDir}", mode="${mode}", arch="${arch}"`);
    const result = resolveRuntimeTarget(projectDir, mode || 'debug', arch || 'x86');
    if (!result) {
        logger.warn('resolveRuntimeTarget returned null');
        return null;
    }
    logger.info(`Resolved target="${result.target}", destDir="${result.destDir}", exePath="${result.exePath}", exists=${fs.existsSync(result.exePath)}`);
    return { target: result.target, destDir: result.destDir, exePath: result.exePath };
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
    return parseRuntimeLibPaths(projectDir);
}

export async function selectProject(context: vscode.ExtensionContext, forceSelect = false): Promise<ProjectInfo | null> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('请先打开工作区');
        return null;
    }

    const savedProject = getQtSetting('pinnedProject');

    if (!forceSelect && savedProject) {
        const savedRef = decodePinnedProject(savedProject);
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
        setQtSetting('pinnedProject', encodePinnedProject(item.root, item.relative));
        return info;
    }

    const selected = await vscode.window.showQuickPick(
        allProFiles.map(f => f.label),
        { placeHolder: `切换项目 · 当前 ${getEffectiveProjectName(getState().currentProject, getTarget(), '未选择项目')}` }
    );

    if (selected) {
        const item = allProFiles.find(f => f.label === selected);
        if (item) {
            const fullPath = path.join(item.root, item.relative);
            const info = parseProFile(fullPath);
            info.projectDir = path.dirname(item.relative);
            setProjectRoot(item.root);
            setQtSetting('pinnedProject', encodePinnedProject(item.root, item.relative));
            return info;
        }
    }

    return null;
}
