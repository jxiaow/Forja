import * as vscode from 'vscode';
import { PlatformConfig } from './platformConfig';
import { BuildConfig, CommandPlan, createShellPlanBuilder } from './shellPlan';

export { BuildConfig };

export interface PlatformBuilder {
    makeExec(commands: string[]): vscode.ShellExecution;
    qmakeCommands(cfg: BuildConfig, extraConfigs?: string[]): CommandPlan;
    buildCommands(cfg: BuildConfig): CommandPlan;
    cleanCommands(cfg: BuildConfig): CommandPlan;
}

export function createBuilder(config: PlatformConfig): PlatformBuilder {
    const shellBuilder = createShellPlanBuilder(config);

    return {
        makeExec(commands: string[]): vscode.ShellExecution {
            const exec = shellBuilder.makeCommandLine(commands);
            if (exec.shellExecutable) {
                return new vscode.ShellExecution(exec.commandLine, {
                    executable: exec.shellExecutable,
                    shellArgs: exec.shellArgs
                });
            }
            return new vscode.ShellExecution(exec.commandLine);
        },

        qmakeCommands(cfg: BuildConfig, extraConfigs: string[] = []): CommandPlan {
            return shellBuilder.qmakeCommands(cfg, extraConfigs);
        },

        buildCommands(cfg: BuildConfig): CommandPlan {
            return shellBuilder.buildCommands(cfg);
        },

        cleanCommands(cfg: BuildConfig): CommandPlan {
            return shellBuilder.cleanCommands(cfg);
        }
    };
}
