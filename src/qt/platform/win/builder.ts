import * as path from 'path';
import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../shellPlan';

export function getVsDevCmd(vsDevShell: string): string {
    return vsDevShell.replace(/Launch-VsDevShell\.ps1$/i, 'VsDevCmd.bat');
}

function buildProcessKillCommand(exeName: string): string {
    const imageName = exeName.replace(/\.exe$/i, '') + '.exe';
    // taskkill /F /IM <exe> — 强制终止目标进程
    // 2>nul — 进程不存在时屏蔽错误信息
    // || ver>nul — 进程不存在时 taskkill 返回非零，确保链继续
    return `taskkill /F /IM ${imageName} 2>nul || ver>nul`;
}

export const winConfig: PlatformConfig = {
    shellExecutable: 'cmd.exe',
    shellArgs: ['/c'],
    commandJoiner: ' && ',
    qmakeBin: 'qmake.exe',

    initCommands(cfg: BuildConfig): string[] {
        const cmds: string[] = [];
        // set PATH 必须在 VsDevCmd.bat 之前：cmd 的 %PATH% 在命令行解析阶段展开，
        // 如果放在 VsDevCmd 之后，%PATH% 展开的是旧值，会覆盖 VsDevCmd 设置的 MSVC 路径。
        // VsDevCmd.bat 会在当前 PATH 基础上追加 MSVC 工具路径，所以先设置 Qt/jom 路径是安全的。
        const qtBin = cfg.qtPath ? path.win32.join(cfg.qtPath, 'bin') : '';
        if (qtBin) {
            cmds.push(`set "PATH=${qtBin};%PATH%"`);
        }
        if (cfg.jomPath) {
            const jomDir = path.dirname(cfg.jomPath);
            if (jomDir !== qtBin) {
                cmds.push(`set "PATH=${jomDir};%PATH%"`);
            }
        }
        if (cfg.vsDevShell) {
            cmds.push(`call "${getVsDevCmd(cfg.vsDevShell)}" -arch=${cfg.arch} -no_logo`);
        }
        return cmds;
    },

    cdCommand(dir: string): string {
        return `cd /d "${dir}"`;
    },

    killCommand(exeName: string): string {
        return buildProcessKillCommand(exeName);
    },

    stopCommands(exeName: string): string[] {
        return [buildProcessKillCommand(exeName)];
    },

    qmakeSpec: 'win32-msvc',
    qmakeExtraArgs(cfg: BuildConfig): string { return `CONFIG+=${cfg.arch}`; },
    qmakeMatcher: '$msCompile',

    buildCommand: 'jom',
    buildMatcher: '$msCompile',

    cleanCommand: 'jom clean',
    cleanMatcher: '$msCompile'
};
