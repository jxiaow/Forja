import { BuildConfig } from './builder';

export interface PlatformConfig {
    shellExecutable: string | null;
    shellArgs: string[] | null;
    commandJoiner: string;

    initCommands(cfg: BuildConfig): string[];
    cdCommand(dir: string): string;
    killCommand(exeName: string): string;
    stopCommands(exeName: string): string[];

    qmakeSpec: string;
    qmakeExtraArgs(cfg: BuildConfig): string;
    qmakeMatcher: string | string[];

    buildCommand: string;
    buildMatcher: string | string[];

    cleanCommand: string;
    cleanMatcher: string | string[];
}
