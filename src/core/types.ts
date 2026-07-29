/**
 * Core types shared across all modules.
 * Extracted here to avoid core/ depending on qt/ or sdk/.
 */

export interface ProjectInfo {
    proPath: string;        // .pro 文件完整路径
    projectDir: string;     // 项目目录（相对于 workspace）
    proFile: string;        // .pro 文件名
    target: string;         // TARGET 名称（显示用，从 .pro 粗略解析）
    qtModules: string[];    // QT 模块列表
    defines: string[];      // DEFINES
}

export interface VSInfo {
    version: string;
    edition: string;
    installPath: string;
    devShellPath: string;
}

export interface QtInfo {
    version: string;
    compiler: string;
    path: string;
}

export interface EnvInfo {
    vs: VSInfo | null;
    qt: QtInfo | null;
    qtCandidates: QtInfo[];
    vsCandidates: VSInfo[];
    jom: string | null;
}

// ── CLI execution result types (shared by qt/cli, sdk/shared, cli/commands) ──

export type CliAction = 'init' | 'use' | 'status' | 'env' | 'projects' | 'qmake' | 'build' | 'clean' | 'run' | 'ps' | 'rcc';
export type CliExecutionMode = 'dryRun' | 'execute';
export type CliBuildMode = 'debug' | 'release';
export type CliArch = 'x86' | 'x64';

export interface CliDiagnostic {
    level: 'info' | 'warning' | 'error';
    message: string;
}

export interface CliResolvedConfig {
    mode: CliBuildMode;
    arch: CliArch;
    qtPath: string;
    vsDevShell: string;
    target: string;
    jomPath?: string;
    qtVersion?: string;
    vsVersion?: string;
    project?: string;
}

export interface CliResult {
    ok: boolean;
    action: CliAction;
    mode: CliExecutionMode;
    workspace: string;
    project: string | null;
    commands: string[];
    shellCommand: string;
    nextAction?: string;
    exitCode: number | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    errors: string[];
    warningSummary?: { total: number; summary: string };
    logFile: string | null;
    buildLogFile?: string;
    executablePath?: string;
    pid?: number;
    runtimeExitCode?: number;
    diagnostics: CliDiagnostic[];
    resolved: CliResolvedConfig | null;
    rccProjectPath?: string;
    data?: Record<string, unknown>;
}
