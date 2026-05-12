import * as vscode from 'vscode';
import * as path from 'path';
import { BuildConfig } from '../platform/builder';
import { getState } from './stateManager';
import { decodeSelectedProject } from './selectedProject';
import { resolveBuildConfig, mergeConfigInputs } from '../coreCli/configResolver';
import { readLocalCache, readLocalConfig } from '../coreCli/localState';
import { getSetting, setSetting } from './settingsStore';

// ── 配置读取 ──

export function getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
}

export function getVsDevShellPath(): string {
    return getSetting('vsDevShellPath');
}

export function getQtPath(): string {
    return getSetting('qtPath');
}

export function getDesignerPath(): string {
    return getSetting('designerPath');
}

export function getQtSourcePath(): string {
    return getSetting('qtSourcePath');
}

export function getSelectedProject(): string {
    const saved = getSetting('selectedProject');
    const parsed = decodeSelectedProject(saved);
    if (parsed) {
        return parsed.relative;
    }
    return '';
}

export function getCStandard(): string {
    return getSetting('cStandard');
}

export function getCppStandard(): string {
    return getSetting('cppStandard');
}

export function getScanExcludeDirs(): string[] {
    return getSetting('scanExcludeDirs');
}

export function getQmakeTarget(): string {
    return getSetting('qmakeTarget');
}

export function getManualProPath(): string {
    return getSetting('manualProPath');
}

export function getFileSyncPromptEnabled(): boolean {
    return getSetting('fileSyncPromptEnabled');
}

export function getQmakeReminderEnabled(): boolean {
    return getSetting('qmakeReminderEnabled');
}

export function updateConfig(key: string, value: unknown): void {
    setSetting(key as any, value as any);
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

    // Priority: settings > env detection > .qtpilot/config.json > .qtpilot/cache.json > defaults
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
        // Highest priority: explicit settings + current state
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
