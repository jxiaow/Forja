import * as path from 'path';
import { BuildConfig } from '../qt/platform/builder';
import { getState } from './stateManager';
import { decodeSelectedProject } from '../qt/project/selectedProject';
import { resolveBuildConfig, mergeConfigInputs } from '../qt/shared/configResolver';
import { readLocalCache } from '../qt/shared/localState';
import { getSetting, setSetting, QtPilotSettings } from './settingsStore';
import { resolveProjectRoot } from './workspaceResolver';

// ── 配置读取 ──

export function getWorkspaceRoot(): string {
    return resolveProjectRoot();
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

export function updateConfig<K extends keyof QtPilotSettings>(key: K, value: QtPilotSettings[K]): void {
    setSetting(key, value);
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

    // Priority: settings > env detection > .compilot/cache.json > defaults
    const localCache = root ? readLocalCache(root) : null;

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
    const localCache = root ? readLocalCache(root) : null;
    return getVsDevShellPath()
        || state.envInfo?.vs?.devShellPath
        || localCache?.detected.vs?.devShellPath
        || '';
}

export function getEffectiveQtPath(): string {
    const state = getState();
    const root = getWorkspaceRoot();
    const localCache = root ? readLocalCache(root) : null;
    return getQtPath()
        || state.envInfo?.qt?.path
        || localCache?.detected.qt?.path
        || '';
}
