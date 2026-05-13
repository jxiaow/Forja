export type CliAction = 'init' | 'detect' | 'projects' | 'status' | 'qmake' | 'build' | 'clean' | 'run' | 'stop' | 'sync';
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
    server?: string | null;
    saveLocal: boolean;
    json: boolean;
}

export interface CliDiagnostic {
    level: DiagnosticLevel;
    message: string;
    hint?: string;
}

export interface CliResolvedConfig {
    mode: CliBuildMode;
    arch: CliArch;
    qtPath: string;
    vsDevShell: string;
    qmakeTarget: string;
}

export interface CliResult {
    ok: boolean;
    action: CliAction;
    mode: CliExecutionMode;
    workspace: string;
    project: string | null;
    commands: string[];
    /** 拼接好的完整 shell 命令，可直接在 workspace 目录下执行 */
    shellCommand: string;
    candidates: string[];
    nextActions: string[];
    exitCode: number | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    logFile: string | null;
    diagnostics: CliDiagnostic[];
    resolved: CliResolvedConfig | null;
}
