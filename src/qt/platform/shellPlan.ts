import type { PlatformConfig } from './platformConfig';

export interface BuildConfig {
    vsDevShell: string;
    qtPath: string;
    projectDir: string;
    proFile: string;
    arch: string;
    mode: string;
    qmakeTarget: string;   // 可选 TARGET 覆盖，空字符串表示不覆盖
    jomPath: string;       // jom.exe 完整路径，空字符串表示依赖 PATH
}

export interface ShellCommandLine {
    commandLine: string;
    shellExecutable: string | null;
    shellArgs: string[];
}

export interface CommandPlan {
    commands: string[];
    matcher: string | string[];
}

export interface ShellPlanBuilder {
    makeCommandLine(commands: string[]): ShellCommandLine;
    qmakeCommands(cfg: BuildConfig, extraConfigs?: string[]): CommandPlan;
    buildCommands(cfg: BuildConfig): CommandPlan;
    cleanCommands(cfg: BuildConfig): CommandPlan;
    stopCommands(exeName: string): string[];
}

export function createShellPlanBuilder(config: PlatformConfig): ShellPlanBuilder {
    function assembleCommands(cfg: BuildConfig, specificCmds: string[]): string[] {
        return [
            ...config.initCommands(cfg),
            config.cdCommand(cfg.projectDir),
            ...specificCmds
        ];
    }

    return {
        makeCommandLine(commands: string[]): ShellCommandLine {
            return {
                commandLine: commands.join(config.commandJoiner),
                shellExecutable: config.shellExecutable,
                shellArgs: config.shellArgs || []
            };
        },

        qmakeCommands(cfg: BuildConfig, extraConfigs: string[] = []): CommandPlan {
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

        buildCommands(cfg: BuildConfig): CommandPlan {
            return {
                commands: assembleCommands(cfg, [config.buildCommand]),
                matcher: config.buildMatcher
            };
        },

        cleanCommands(cfg: BuildConfig): CommandPlan {
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
