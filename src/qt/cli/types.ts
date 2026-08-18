export type {
    CliAction, CliExecutionMode, CliBuildMode, CliArch,
    CliDiagnostic, CliResolvedConfig, CliResult,
} from '../../core/types';
import type { CliAction, CliExecutionMode, CliBuildMode, CliArch } from '../../core/types';

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface CliOptions {
    action: CliAction;
    executionMode: CliExecutionMode;
    workspace: string | null;
    project: string | null;
    mode: CliBuildMode | null;
    arch: CliArch | null;
    qtPath: string | null;
    vsDevShell: string | null;
    target: string | null;
    executableName?: string | null;
    qmakeArgs?: string | null;
    jomPath?: string | null;
    rccProjectPath?: string | null;
    jobs?: number;
    detach?: boolean;
    saveLocal: boolean;
    json: boolean;
}
