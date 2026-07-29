import { BuildMode, BuildAction } from '../types';

export interface LinuxBuildConfig {
  makefileDir: string;
  mode: BuildMode;
  action: BuildAction;
}

export function buildLinuxCommand(config: LinuxBuildConfig): string {
  switch (config.action) {
    case 'Build':
      return `cd "${config.makefileDir}" && make -j$(nproc) MODE=${config.mode}`;
    case 'Clean':
      return `cd "${config.makefileDir}" && make clean`;
    case 'Rebuild':
      return `cd "${config.makefileDir}" && make clean && make -j$(nproc) MODE=${config.mode}`;
  }
}
