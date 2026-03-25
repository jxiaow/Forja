import * as vscode from 'vscode';

export interface BuildConfig {
    vsDevShell: string;
    qtPath: string;
    projectDir: string;
    proFile: string;
    exeName: string;
    destDir: string;        // DESTDIR，已解析变量，相对于 projectDir
    arch: string;
    mode: string;
}

export interface PlatformBuilder {
    makeExec(commands: string[]): vscode.ShellExecution;
    killApp(exeName: string): string;
    qmakeCommands(cfg: BuildConfig): { commands: string[]; matcher: string | string[] };
    buildCommands(cfg: BuildConfig): { commands: string[]; matcher: string | string[] };
    cleanCommands(cfg: BuildConfig): { commands: string[]; matcher: string | string[] };
    exePath(root: string, cfg: BuildConfig): string;
    stopCommands(exeName: string): string[];
}
