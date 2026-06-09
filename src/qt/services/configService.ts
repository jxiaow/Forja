import * as path from 'path';
import { BuildConfig } from '../platform/builder';
import { getState } from '../../vscode/qtState';
import { decodePinnedProject } from '../project/pinnedProject';
import { resolveBuildConfig, mergeConfigInputs } from '../shared/configResolver';
import { getQtSetting, setQtSetting, QtSettings, resolveVsDevShellPath } from '../../vscode/settingsStore';
import { resolveProjectRoot } from '../../vscode/workspaceResolver';

// ── 配置读取 ──

export function getWorkspaceRoot(): string {
    return resolveProjectRoot();
}

export function getVsDevShellPath(): string {
    return resolveVsDevShellPath(getQtSetting('vsInstall'));
}

export function getQtPath(): string {
    return getQtSetting('qtPath');
}

export function getDesignerPath(): string {
    return getQtSetting('designerPath');
}

export function getQtSourcePath(): string {
    return getQtSetting('qtSourcePath');
}

export function getJomPath(): string {
    return getQtSetting('jomPath');
}

export function getPinnedProject(): string {
    const saved = getQtSetting('pinnedProject');
    const parsed = decodePinnedProject(saved);
    if (parsed) {
        return parsed.relative;
    }
    return '';
}

export function getCStandard(): string {
    return getQtSetting('cStandard');
}

export function getCppStandard(): string {
    return getQtSetting('cppStandard');
}

export function getScanExcludeDirs(): string[] {
    return getQtSetting('scanExcludeDirs');
}

export function getTarget(): string {
    return getQtSetting('target');
}

export function getQmakeArgs(): string {
    return getQtSetting('qmakeArgs');
}

export function getRuntimeProcessName(): string {
    return getQtSetting('runtimeProcessName');
}

export function getManualProPath(): string {
    return getQtSetting('manualProPath');
}

export function getFileSyncPromptEnabled(): boolean {
    return getQtSetting('fileSyncPromptEnabled');
}

export function getQmakeReminderEnabled(): boolean {
    return getQtSetting('qmakeReminderEnabled');
}

export function getRccProjectPath(): string {
    return getQtSetting('rccProjectPath');
}

export function getCustomCommands(): { name: string; command: string }[] {
    return getQtSetting('customCommands');
}

export function updateConfig<K extends keyof QtSettings>(key: K, value: QtSettings[K]): void {
    setQtSetting(key, value);
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
                : root ? path.join(root, project.projectDir) : project.projectDir;
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
            target: getTarget(),
            qmakeArgs: getQmakeArgs()
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
