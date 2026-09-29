import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../shellPlan';
import { posixQuote } from '../../../core/shellQuote';

export const linuxConfig: PlatformConfig = {
    shellExecutable: null,
    shellArgs: null,
    commandJoiner: ' && ',
    qmakeBin: 'qmake',

    initCommands(cfg: BuildConfig): string[] {
        if (!cfg.qtPath) { return []; }
        return [
            `export PATH=${posixQuote(`${cfg.qtPath}/bin`)}:"$PATH"`,
            `export LD_LIBRARY_PATH=${posixQuote(`${cfg.qtPath}/lib`)}:"$HOME/.forja/compat/icu55/lib":"$LD_LIBRARY_PATH"`
        ];
    },

    cdCommand(dir: string): string {
        return `cd ${posixQuote(dir)}`;
    },

    qmakeSpec: 'linux-g++',
    qmakeExtraArgs(): string { return ''; },
    qmakeMatcher: '$gcc',

    buildCommand(cfg: BuildConfig): string {
        return cfg.jobs
            ? `make -j${cfg.jobs}`
            : 'make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)';
    },
    buildMatcher: '$gcc',

    cleanCommand: 'make clean',
    cleanMatcher: '$gcc'
};
