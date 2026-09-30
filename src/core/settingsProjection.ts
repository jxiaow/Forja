/**
 * workspaceStore → 视图配置 的纯投影函数（无 vscode 依赖，可单元测试）。
 *
 * activeTarget 与模块 kind 不一致时不得取用目标值，防止 Qt/C++ 跨类型污染。
 */
import { DEFAULT_SETTINGS, QtSettings, CppSettings } from './settingsIO';
import { type WorkspaceConfig, type TargetProfile } from './workspaceStore';

export function buildQtSettings(config: WorkspaceConfig, target: TargetProfile | null): QtSettings {
    const prefs = config.qtModulePrefs;
    const d = DEFAULT_SETTINGS.qt;

    // Only use target if it's a Qt project — prevent cross-type contamination
    const qtTarget = target?.kind === 'qt' ? target : null;

    let pinnedProject: QtSettings['pinnedProject'] = null;
    if (qtTarget && qtTarget.project) {
        pinnedProject = { root: config.workroot, relative: qtTarget.project };
    }

    return {
        mode: qtTarget ? qtTarget.mode : d.mode,
        arch: qtTarget ? qtTarget.arch : d.arch,
        vsInstall: qtTarget?.toolchain.vsInstall ?? d.vsInstall,
        qtPath: qtTarget?.toolchain.qtPath ?? d.qtPath,
        qtVersion: qtTarget?.toolchain.qtVersion ?? d.qtVersion,
        jomPath: qtTarget?.toolchain.jomPath ?? d.jomPath,
        pinnedProject,
        executableName: qtTarget?.toolchain.executableName ?? d.executableName,
        qmakeArgs: prefs.qmakeArgs,
        cStandard: prefs.cStandard,
        cppStandard: prefs.cppStandard,
        designerPath: prefs.designerPath,
        qtSourcePath: prefs.qtSourcePath,
        manualProPath: prefs.manualProPath,
        rccProjectPath: prefs.rccProjectPath,
        scanExcludeDirs: [...prefs.scanExcludeDirs],
        customCommands: prefs.customCommands.map(c => ({ ...c })),
        fileSyncPromptEnabled: prefs.fileSyncPromptEnabled,
        qmakeReminderEnabled: prefs.qmakeReminderEnabled,
        suppressedWarnings: prefs.suppressedWarnings.length > 0 ? [...prefs.suppressedWarnings] : undefined,
    };
}

export function buildCppSettings(config: WorkspaceConfig, target: TargetProfile | null): CppSettings {
    const prefs = config.cppModulePrefs;
    const d = DEFAULT_SETTINGS.cpp;

    // Only use target if it's a C++ project — prevent cross-type contamination
    const cppTarget = target?.kind === 'cpp' ? target : null;

    return {
        mode: cppTarget ? cppTarget.mode : d.mode,
        arch: cppTarget ? cppTarget.arch : d.arch,
        vsInstall: cppTarget?.toolchain.vsInstall ?? d.vsInstall,
        pinnedProject: (cppTarget && cppTarget.project) ? cppTarget.project : null,
        scanDepth: prefs.scanDepth,
        cmakeConfigureArgs: [...(prefs.cmakeConfigureArgs ?? [])],
    };
}
