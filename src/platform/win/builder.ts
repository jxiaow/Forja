import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../builder';

function getVsDevCmd(vsDevShell: string): string {
    return vsDevShell.replace(/Launch-VsDevShell\.ps1$/i, 'VsDevCmd.bat');
}

export const winConfig: PlatformConfig = {
    shellExecutable: 'cmd.exe',
    shellArgs: ['/c'],
    commandJoiner: ' && ',

    initCommands(cfg: BuildConfig): string[] {
        if (!cfg.vsDevShell) { return []; }
        return [`call "${getVsDevCmd(cfg.vsDevShell)}" -arch=${cfg.arch} -no_logo`];
    },

    cdCommand(dir: string): string {
        return `cd /d "${dir}"`;
    },

    killCommand(exeName: string): string {
        return `taskkill /F /IM ${exeName}.exe 2>nul & timeout /t 1 /nobreak >nul`;
    },

    stopCommands(exeName: string): string[] {
        return [`taskkill /F /IM ${exeName}.exe`];
    },

    qmakeSpec: 'win32-msvc',
    qmakeExtraArgs(cfg: BuildConfig): string { return `CONFIG+=${cfg.arch}`; },
    qmakeMatcher: '$msCompile',

    buildCommand: 'jom',
    buildMatcher: '$msCompile',

    cleanCommand: 'jom clean',
    cleanMatcher: '$msCompile'
};
