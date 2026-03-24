import * as vscode from 'vscode';
import * as path from 'path';
import { PlatformBuilder, BuildConfig } from '../builder';

function initPath(cfg: BuildConfig): string | null {
    if (!cfg.qtPath) { return null; }
    return `export PATH="${cfg.qtPath}/bin:$PATH"`;
}

export const linuxBuilder: PlatformBuilder = {
    makeExec(commands: string[]): vscode.ShellExecution {
        const cmd = commands.join(' && ');
        return new vscode.ShellExecution(cmd);
    },

    killApp(exeName: string): string {
        return `pkill -f ${exeName} 2>/dev/null; true`;
    },

    qmakeCommands(cfg: BuildConfig) {
        const modeConfig = cfg.mode === 'debug' ? 'CONFIG+=debug CONFIG+=console' : 'CONFIG+=release';
        const cmds: string[] = [];
        const pathCmd = initPath(cfg);
        if (pathCmd) { cmds.push(pathCmd); }
        cmds.push(`cd "${cfg.projectDir}"`);
        cmds.push(`qmake ${cfg.proFile} -spec linux-g++ ${modeConfig}`);
        return { commands: cmds, matcher: '$gcc' };
    },

    buildCommands(cfg: BuildConfig) {
        const cmds: string[] = [];
        const pathCmd = initPath(cfg);
        cmds.push(this.killApp(cfg.exeName));
        if (pathCmd) { cmds.push(pathCmd); }
        cmds.push(`cd "${cfg.projectDir}"`);
        cmds.push('make -j$(nproc)');
        return { commands: cmds, matcher: [] };
    },

    cleanCommands(cfg: BuildConfig) {
        const cmds: string[] = [];
        const pathCmd = initPath(cfg);
        if (pathCmd) { cmds.push(pathCmd); }
        cmds.push(`cd "${cfg.projectDir}"`);
        cmds.push('make clean');
        return { commands: cmds, matcher: '$gcc' };
    },

    exePath(root: string, cfg: BuildConfig): string {
        return path.join(cfg.projectDir, cfg.exeName);
    },

    stopCommands(exeName: string): string[] {
        return [`pkill -f ${exeName}`];
    }
};
