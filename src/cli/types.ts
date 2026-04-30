export type CliAction = 'init' | 'detect' | 'projects' | 'qmake' | 'build' | 'run' | 'stop';
export type CliExecutionMode = 'dryRun' | 'execute';
export type CliBuildMode = 'debug' | 'release';
export type CliArch = 'x86' | 'x64';
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
    saveLocal: boolean;
    json: boolean;
}

export interface CliDiagnostic {
    level: DiagnosticLevel;
    message: string;
    hint?: string;
}

export interface CliResult {
    ok: boolean;
    action: CliAction;
    mode: CliExecutionMode;
    workspace: string;
    project: string | null;
    commands: string[];
    exitCode: number | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    logFile: string | null;
    diagnostics: CliDiagnostic[];
}
