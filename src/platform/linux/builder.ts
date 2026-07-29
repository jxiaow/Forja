import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../shellPlan';

export const linuxConfig: PlatformConfig = {
    shellExecutable: null,
    shellArgs: null,
    commandJoiner: ' && ',

    initCommands(cfg: BuildConfig): string[] {
        if (!cfg.qtPath) { return []; }
        return [`export PATH="${cfg.qtPath}/bin:$PATH"`];
    },

    cdCommand(dir: string): string {
        return `cd "${dir}"`;
    },

    killCommand(exeName: string): string {
        return `pkill -x ${exeName} 2>/dev/null; true`;
    },

    stopCommands(exeName: string): string[] {
        return [`pkill -x ${exeName}`];
    },

    qmakeSpec: 'linux-g++',
    qmakeExtraArgs(): string { return ''; },
    qmakeMatcher: '$gcc',

    buildCommand: 'make -j$(nproc)',
    buildMatcher: [],

    cleanCommand: 'make clean',
    cleanMatcher: '$gcc'
};
