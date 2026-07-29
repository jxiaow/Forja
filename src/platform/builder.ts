import * as vscode from 'vscode';
import { PlatformConfig } from './platformConfig';

export interface BuildConfig {
    vsDevShell: string;
    qtPath: string;
    projectDir: string;
    proFile: string;
    arch: string;
    mode: string;
    qmakeTarget: string;   // 可选 TARGET 覆盖，空字符串表示不覆盖
}

export interface PlatformBuilder {
    makeExec(commands: string[]): vscode.ShellExecution;
    killApp(exeName: string): string;
    qmakeCommands(cfg: BuildConfig, extraConfigs?: string[]): { commands: string[]; matcher: string | string[] };
    buildCommands(cfg: BuildConfig): { commands: string[]; matcher: string | string[] };
    cleanCommands(cfg: BuildConfig): { commands: string[]; matcher: string | string[] };
    stopCommands(exeName: string): string[];
}

export function createBuilder(config: PlatformConfig): PlatformBuilder {
    function assembleCommands(cfg: BuildConfig, specificCmds: string[]): string[] {
        return [
            ...config.initCommands(cfg),
            config.cdCommand(cfg.projectDir),
            ...specificCmds
        ];
    }

    return {
        makeExec(commands: string[]): vscode.ShellExecution {
            const cmd = commands.join(config.commandJoiner);
            if (config.shellExecutable) {
                return new vscode.ShellExecution(cmd, {
                    executable: config.shellExecutable,
                    shellArgs: config.shellArgs || []
                });
            }
            return new vscode.ShellExecution(cmd);
        },

        killApp(exeName: string): string {
            return config.killCommand(exeName);
        },

        qmakeCommands(cfg: BuildConfig, extraConfigs: string[] = []) {
            const modeConfigs = cfg.mode === 'debug'
                ? ['CONFIG+=debug', 'CONFIG+=console']
                : ['CONFIG+=release', 'CONFIG+=console'];
            const extra = config.qmakeExtraArgs(cfg);
            const targetArg = cfg.qmakeTarget ? ` "TARGET=${cfg.qmakeTarget}"` : '';
            const configArgs = [...modeConfigs, ...extraConfigs].join(' ');
            const qmakeCmd = `qmake ${cfg.proFile} -spec ${config.qmakeSpec} ${configArgs}${extra ? ' ' + extra : ''}${targetArg}`;
            return {
                commands: assembleCommands(cfg, [qmakeCmd]),
                matcher: config.qmakeMatcher
            };
        },

        buildCommands(cfg: BuildConfig) {
            return {
                commands: assembleCommands(cfg, [config.buildCommand]),
                matcher: config.buildMatcher
            };
        },

        cleanCommands(cfg: BuildConfig) {
            return {
                commands: assembleCommands(cfg, [config.cleanCommand]),
                matcher: config.cleanMatcher
            };
        },

        stopCommands(exeName: string): string[] {
            return config.stopCommands(exeName);
        }
    };
}
