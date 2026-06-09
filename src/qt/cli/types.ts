export type CliAction = 'init' | 'use' | 'status' | 'env' | 'projects' | 'qmake' | 'build' | 'clean' | 'run' | 'stop' | 'ps' | 'rcc';
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
    qmakeArgs?: string | null;
    detach?: boolean;
    saveLocal: boolean;
    json: boolean;
}

export interface CliDiagnostic {
    level: DiagnosticLevel;
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
    /** 拼接好的完整 shell 命令，可直接在 workspace 目录下执行 */
    shellCommand: string;
    nextActions: string[];
    exitCode: number | null;
    durationMs: number;
    stdout: string;
    stderr: string;
    /** Extracted error lines from compiler output (when exitCode !== 0) */
    errors: string[];
    /** Warning summary: total count and deduplicated breakdown */
    warningSummary?: { total: number; summary: string };
    logFile: string | null;
    /** build/run --detach 编译步骤的日志路径（成功时也有） */
    buildLogFile?: string;
    /** run 成功时解析出的可执行文件绝对路径 */
    executablePath?: string;
    /** run --detach 成功时解析出的目标进程 PID */
    pid?: number;
    diagnostics: CliDiagnostic[];
    resolved: CliResolvedConfig | null;
    /** RCC 项目路径（status 时返回） */
    rccProjectPath?: string;
    /** 结构化数据载体（env/projects/status 用），替代 stdout JSON hack */
    data?: Record<string, unknown>;
}
