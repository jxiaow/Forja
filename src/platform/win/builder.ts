import * as vscode from 'vscode';
import * as path from 'path';
import { PlatformBuilder, BuildConfig } from '../builder';

function getVsDevCmd(vsDevShell: string): string {
    return vsDevShell.replace(/Launch-VsDevShell\.ps1$/i, 'VsDevCmd.bat');
}

function initShell(vsDevShell: string, arch: string): string {
    return `call "${getVsDevCmd(vsDevShell)}" -arch=${arch} -no_logo`;
}

export const winBuilder: PlatformBuilder = {
    makeExec(commands: string[]): vscode.ShellExecution {
        return new vscode.ShellExecution(commands.join(' && '), { executable: 'cmd.exe', shellArgs: ['/c'] });
    },

    killApp(exeName: string): string {
        return `taskkill /F /IM ${exeName}.exe 2>nul & timeout /t 1 /nobreak >nul`;
    },

    qmakeCommands(cfg: BuildConfig) {
        const modeConfig = cfg.mode === 'debug' ? 'CONFIG+=debug CONFIG+=console' : 'CONFIG+=release';
        return {
            commands: [
                initShell(cfg.vsDevShell, cfg.arch),
                `cd /d "${cfg.projectDir}"`,
                `qmake ${cfg.proFile} -spec win32-msvc ${modeConfig} CONFIG+=${cfg.arch}`
            ],
            matcher: '$msCompile'
        };
    },

    buildCommands(cfg: BuildConfig) {
        return {
            commands: [
                this.killApp(cfg.exeName),
                initShell(cfg.vsDevShell, cfg.arch),
                `cd /d "${cfg.projectDir}"`,
                'jom'
            ],
            matcher: '$msCompile'
        };
    },

    cleanCommands(cfg: BuildConfig) {
        return {
            commands: [
                initShell(cfg.vsDevShell, cfg.arch),
                `cd /d "${cfg.projectDir}"`,
                'jom clean'
            ],
            matcher: '$msCompile'
        };
    },

    exePath(root: string, cfg: BuildConfig): string {
        if (cfg.destDir) { return path.join(cfg.projectDir, cfg.destDir, `${cfg.exeName}.exe`); }
        return path.join(cfg.projectDir, cfg.mode, cfg.arch, `${cfg.exeName}.exe`);
    },

    stopCommands(exeName: string): string[] {
        return [`taskkill /F /IM ${exeName}.exe`];
    }
};
