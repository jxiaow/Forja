import * as vscode from 'vscode';
import * as path from 'path';
import { BuildConfig } from '../platform/builder';
import { getState } from './stateManager';
import { decodeSelectedProject } from './selectedProject';
import { resolveBuildConfig, mergeConfigInputs } from '../coreCli/configResolver';
import { readLocalCache, readLocalConfig } from '../coreCli/localState';

// ── 配置读取 ──

function cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('qtPilot');
}

export function getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
}

export function getVsDevShellPath(): string {
    return cfg().get<string>('vsDevShellPath', '');
}

export function getQtPath(): string {
    return cfg().get<string>('qtPath', '');
}

export function getDesignerPath(): string {
    return cfg().get<string>('designerPath', '');
}

export function getQtSourcePath(): string {
    return cfg().get<string>('qtSourcePath', '');
}

export function getSelectedProject(): string {
    const saved = cfg().get<unknown>('selectedProject');
    const parsed = decodeSelectedProject(saved);
    if (parsed) {
        return parsed.relative;
    }
    return typeof saved === 'string' ? saved : '';
}

export function getCStandard(): string {
    return cfg().get<string>('cStandard', 'c11');
}

export function getCppStandard(): string {
    return cfg().get<string>('cppStandard', 'c++11');
}

export function getScanExcludeDirs(): string[] {
    return cfg().get<string[]>('scanExcludeDirs', []);
}

export function getQmakeTarget(): string {
    return cfg().get<string>('qmakeTarget', '');
}

export function getManualProPath(): string {
    return cfg().get<string>('manualProPath', '');
}

export function getFileSyncPromptEnabled(): boolean {
    return cfg().get<boolean>('fileSyncPromptEnabled', true);
}

export function getQmakeReminderEnabled(): boolean {
    return cfg().get<boolean>('qmakeReminderEnabled', true);
}

export async function updateConfig(key: string, value: unknown): Promise<void> {
    await cfg().update(key, value, vscode.ConfigurationTarget.Workspace);
}

// ── BuildConfig 组装 ──

export function getBuildConfig(): BuildConfig {
    const state = getState();
    const root = getWorkspaceRoot();
    const project = state.currentProject;
    const env = state.envInfo;

    let projectPath: string | null = null;
    if (project) {
        if (project.proPath) {
            projectPath = project.proPath;
        } else if (project.projectDir && project.proFile) {
            const dir = path.isAbsolute(project.projectDir)
                ? project.projectDir
                : path.join(root, project.projectDir);
            projectPath = path.join(dir, project.proFile);
        }
    }

    // Priority: VSCode settings > env detection > .work/qt-pilot/config.json > .work/qt-pilot/cache.json > defaults
    const localCache = root ? readLocalCache(root) : null;
    const localConfig = root ? readLocalConfig(root) : null;

    const inputs = mergeConfigInputs(
        // Lowest priority: local cache (auto-detected values)
        {
            qtPath: localCache?.detected.qt?.path || '',
            vsDevShell: localCache?.detected.vs?.devShellPath || ''
        },
        // Environment detection from extension (same level as cache, but fresher)
        {
            qtPath: env?.qt?.path || '',
            vsDevShell: env?.vs?.devShellPath || ''
        },
        // Local config (user-saved CLI config — higher than auto-detection)
        {
            qtPath: localConfig?.qtPath || '',
            vsDevShell: localConfig?.vsDevShell || ''
        },
        // Highest priority: explicit VSCode settings + current state
        {
            workspace: root,
            projectPath,
            mode: state.mode,
            arch: state.arch,
            qtPath: getQtPath(),
            vsDevShell: getVsDevShellPath(),
            qmakeTarget: getQmakeTarget()
        }
    );

    return resolveBuildConfig(inputs);
}

// ── 路径解析 ──

export function getEffectiveVsDevShell(): string {
    const state = getState();
    const root = getWorkspaceRoot();
    const localConfig = root ? readLocalConfig(root) : null;
    const localCache = root ? readLocalCache(root) : null;
    return getVsDevShellPath()
        || localConfig?.vsDevShell
        || state.envInfo?.vs?.devShellPath
        || localCache?.detected.vs?.devShellPath
        || '';
}

export function getEffectiveQtPath(): string {
    const state = getState();
    const root = getWorkspaceRoot();
    const localConfig = root ? readLocalConfig(root) : null;
    const localCache = root ? readLocalCache(root) : null;
    return getQtPath()
        || localConfig?.qtPath
        || state.envInfo?.qt?.path
        || localCache?.detected.qt?.path
        || '';
}
