import { BuildMode, BuildAction } from '../types';

export interface LinuxBuildConfig {
  makefileDir: string;
  mode: BuildMode;
  action: BuildAction;
}

export function buildLinuxCommand(config: LinuxBuildConfig): string {
  const NPROC = '$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)';
  switch (config.action) {
    case 'Build':
      return `cd "${config.makefileDir}" && make -j${NPROC} MODE=${config.mode}`;
    case 'Clean':
      return `cd "${config.makefileDir}" && make clean`;
    case 'Rebuild':
      return `cd "${config.makefileDir}" && make clean && make -j${NPROC} MODE=${config.mode}`;
  }
}
