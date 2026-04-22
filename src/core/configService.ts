import * as vscode from 'vscode';
import * as path from 'path';
import { BuildConfig } from '../platform/builder';
import { getState } from './stateManager';

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
    const saved = cfg().get<string>('selectedProject', '');
    if (!saved) { return ''; }
    try {
        const parsed = JSON.parse(saved) as { relative?: string };
        if (typeof parsed.relative === 'string') {
            return parsed.relative;
        }
    } catch {}
    return saved;
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
    let projectDir = '';
    if (project) {
        // proPath 是绝对路径，最可靠
        if (project.proPath) {
            projectDir = path.dirname(project.proPath);
        } else if (project.projectDir) {
            projectDir = path.isAbsolute(project.projectDir)
                ? project.projectDir
                : path.join(root, project.projectDir);
        }
    }
    return {
        vsDevShell: getVsDevShellPath() || env?.vs?.devShellPath || '',
        qtPath: getQtPath() || env?.qt?.path || '',
        projectDir,
        proFile: project?.proFile || '',
        arch: state.arch,
        mode: state.mode,
        qmakeTarget: getQmakeTarget()
    };
}

// ── 路径解析 ──

export function getEffectiveVsDevShell(): string {
    const state = getState();
    return getVsDevShellPath() || state.envInfo?.vs?.devShellPath || '';
}

export function getEffectiveQtPath(): string {
    const state = getState();
    return getQtPath() || state.envInfo?.qt?.path || '';
}
