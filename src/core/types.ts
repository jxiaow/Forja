/**
 * Core types shared across all modules.
 * Extracted here to avoid core/ depending on qt/ or cpp/.
 */

export interface ProjectInfo {
    proPath: string;        // .pro 文件完整路径
    projectDir: string;     // 项目目录（相对于 workspace）
    proFile: string;        // .pro 文件名
    target: string;         // TARGET 名称（显示用，从 .pro 粗略解析）
    qtModules: string[];    // QT 模块列表
    defines: string[];      // DEFINES
}

/** 统一项目类型 — Qt 和 C++ 项目共用 */
export interface UnifiedProject {
    /** 显示名称 */
    name: string;
    /** 项目文件路径（.pro / .sln / Makefile / CMakeLists.txt） */
    path: string;
    /** 项目目录 */
    projectDir: string;
    /** 自动推导的项目类型 */
    kind: 'qt' | 'cpp';
    /** C++ 项目子类型 */
    cppType?: 'sln' | 'makefile' | 'cmake';
    /** Qt 项目详细信息（懒加载） */
    qtInfo?: ProjectInfo;
}

/** 项目分组 — 按顶层目录聚合 */
export interface ProjectGroup {
    /** 目录名（如 "xyplat/"） */
    label: string;
    /** 相对于 workspace 的路径 */
    relativePath: string;
    /** 该目录下的项目列表 */
    projects: UnifiedProject[];
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

// ── CLI execution result types (shared by qt/cli, cpp/shared, cli/commands) ──

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
