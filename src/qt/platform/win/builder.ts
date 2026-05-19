import * as path from 'path';
import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../shellPlan';

export function getVsDevCmd(vsDevShell: string): string {
    return vsDevShell.replace(/Launch-VsDevShell\.ps1$/i, 'VsDevCmd.bat');
}

export const winConfig: PlatformConfig = {
    shellExecutable: 'cmd.exe',
    shellArgs: ['/c'],
    commandJoiner: ' && ',
    qmakeBin: 'qmake.exe',

    initCommands(cfg: BuildConfig): string[] {
        const cmds: string[] = [];
        if (cfg.vsDevShell) {
            cmds.push(`call "${getVsDevCmd(cfg.vsDevShell)}" -arch=${cfg.arch} -no_logo`);
        }
        // 把 Qt bin 目录加到 PATH（确保 qmake 可用）
        const qtBin = cfg.qtPath ? path.join(cfg.qtPath, 'bin') : '';
        if (qtBin) {
            cmds.push(`set "PATH=${qtBin};%PATH%"`);
        }
        // 如果 jomPath 已知且不在 Qt bin 目录下，把其所在目录也加到 PATH
        if (cfg.jomPath) {
            const jomDir = path.dirname(cfg.jomPath);
            if (jomDir !== qtBin) {
                cmds.push(`set "PATH=${jomDir};%PATH%"`);
            }
        }
        return cmds;
    },

    cdCommand(dir: string): string {
        return `cd /d "${dir}"`;
    },

    killCommand(exeName: string): string {
        return `(taskkill /F /IM "${exeName}.exe" >nul 2>nul || ver >nul)`;
    },

    stopCommands(exeName: string): string[] {
        return [`taskkill /F /IM "${exeName}.exe"`];
    },

    qmakeSpec: 'win32-msvc',
    qmakeExtraArgs(cfg: BuildConfig): string { return `CONFIG+=${cfg.arch}`; },
    qmakeMatcher: '$msCompile',

    buildCommand: 'jom',
    buildMatcher: '$msCompile',

    cleanCommand: 'jom clean',
    cleanMatcher: '$msCompile'
};
