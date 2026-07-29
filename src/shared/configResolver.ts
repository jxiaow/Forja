import * as path from 'path';
import type { CliArch, CliBuildMode } from '../cli/types';
import type { BuildConfig } from '../platform/shellPlan';

/**
 * Raw inputs for config resolution — can come from VSCode settings,
 * CLI args, local state, or environment detection.
 */
export interface ConfigInputs {
    workspace: string;
    projectPath: string | null;
    mode: CliBuildMode;
    arch: CliArch;
    qtPath: string;
    vsDevShell: string;
    qmakeTarget: string;
}

/**
 * Resolve a BuildConfig (platform/shellPlan compatible) from raw inputs.
 * This is the single source of truth for assembling build parameters,
 * shared between the VSCode extension and the CLI.
 */
export function resolveBuildConfig(inputs: ConfigInputs): BuildConfig {
    const projectDir = inputs.projectPath
        ? path.dirname(inputs.projectPath)
        : inputs.workspace;
    const proFile = inputs.projectPath
        ? path.basename(inputs.projectPath)
        : '';

    return {
        vsDevShell: inputs.vsDevShell,
        qtPath: inputs.qtPath,
        projectDir,
        proFile,
        arch: inputs.arch,
        mode: inputs.mode,
        qmakeTarget: inputs.qmakeTarget
    };
}

/**
 * Merge multiple config sources with priority (later sources override earlier).
 * Null/empty values are skipped so lower-priority sources fill gaps.
 */
export function mergeConfigInputs(...sources: Partial<ConfigInputs>[]): ConfigInputs {
    const result: ConfigInputs = {
        workspace: '',
        projectPath: null,
        mode: 'debug',
        arch: 'x86',
        qtPath: '',
        vsDevShell: '',
        qmakeTarget: ''
    };

    for (const source of sources) {
        if (source.workspace) { result.workspace = source.workspace; }
        if (source.projectPath) { result.projectPath = source.projectPath; }
        if (source.mode) { result.mode = source.mode; }
        if (source.arch) { result.arch = source.arch; }
        if (source.qtPath) { result.qtPath = source.qtPath; }
        if (source.vsDevShell) { result.vsDevShell = source.vsDevShell; }
        if (source.qmakeTarget) { result.qmakeTarget = source.qmakeTarget; }
    }

    return result;
}
