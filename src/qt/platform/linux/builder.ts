import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../shellPlan';

export const linuxConfig: PlatformConfig = {
    shellExecutable: null,
    shellArgs: null,
    commandJoiner: ' && ',
    qmakeBin: 'qmake',

    initCommands(cfg: BuildConfig): string[] {
        if (!cfg.qtPath) { return []; }
        return [
            `export PATH="${cfg.qtPath}/bin:$PATH"`,
            `export LD_LIBRARY_PATH="${cfg.qtPath}/lib:$HOME/.forja/compat/icu55/lib:$LD_LIBRARY_PATH"`
        ];
    },

    cdCommand(dir: string): string {
        return `cd "${dir}"`;
    },

    killCommand(exeName: string, exePath?: string): string {
        if (exePath) {
            // Only kill processes whose executable path matches our build output
            return `for _p in $(pgrep -x "${exeName}" 2>/dev/null); do `
                + `[ "$(readlink /proc/$_p/exe 2>/dev/null)" = "${exePath}" ] && kill $_p 2>/dev/null; `
                + `done; true`;
        }
        return `pkill -x "${exeName}" 2>/dev/null; true`;
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
