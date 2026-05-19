import * as path from 'path';
import { BuildConfig } from '../platform/builder';
import { getState } from '../../core/stateManager';
import { decodePinnedProject } from '../project/pinnedProject';
import { resolveBuildConfig, mergeConfigInputs } from '../shared/configResolver';
import { getSetting, setSetting, QtPilotSettings } from '../../core/settingsStore';
import { resolveProjectRoot } from '../../core/workspaceResolver';

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

export function getJomPath(): string {
    return getSetting('jomPath');
}

export function getPinnedProject(): string {
    const saved = getSetting('pinnedProject');
    const parsed = decodePinnedProject(saved);
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

export function getTarget(): string {
    return getSetting('target');
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

export function getRccProjectPath(): string {
    return getSetting('rccProjectPath');
}

export function getCustomCommands(): { name: string; command: string }[] {
    return getSetting('customCommands');
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

    // Priority: settings > env detection > defaults
    const inputs = mergeConfigInputs(
        // Lowest priority: env detection from extension (runtime-detected values)
        {
            qtPath: env?.qt?.path || '',
            vsDevShell: env?.vs?.devShellPath || '',
            jomPath: env?.jom || ''
        },
        // Highest priority: explicit settings + current state
        {
            workspace: root,
            projectPath,
            mode: state.mode,
            arch: state.arch,
            qtPath: getQtPath(),
            vsDevShell: getVsDevShellPath(),
            jomPath: getJomPath(),
            target: getTarget()
        }
    );

    return resolveBuildConfig(inputs);
}

// ── 路径解析 ──

export function getEffectiveVsDevShell(): string {
    const state = getState();
    return getVsDevShellPath()
        || state.envInfo?.vs?.devShellPath
        || '';
}

export function getEffectiveQtPath(): string {
    const state = getState();
    return getQtPath()
        || state.envInfo?.qt?.path
        || '';
}
