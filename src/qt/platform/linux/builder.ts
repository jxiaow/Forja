import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../shellPlan';

export const linuxConfig: PlatformConfig = {
    shellExecutable: null,
    shellArgs: null,
    commandJoiner: ' && ',
    qmakeBin: 'qmake',

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

    buildCommand: 'make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)',
    buildMatcher: '$gcc',

    cleanCommand: 'make clean',
    cleanMatcher: '$gcc'
};
