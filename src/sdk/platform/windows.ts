import * as vscode from 'vscode';
import { BuildMode, Arch, BuildAction } from '../types';

export interface WindowsBuildConfig {
  vsDevCmdPath: string;
  slnPath: string;
  mode: BuildMode;
  arch: Arch;
  action: BuildAction;
}

export function buildWindowsCommand(config: WindowsBuildConfig): string {
  const modeStr = config.mode === 'debug' ? 'Debug' : 'Release';
  return `call "${config.vsDevCmdPath}" -arch=${config.arch} -no_logo && devenv "${config.slnPath}" /${config.action} "${modeStr}|${config.arch}"`;
}

export function getWindowsShellOptions(): vscode.ShellExecutionOptions {
  return {
    executable: 'cmd.exe',
    shellArgs: ['/c']
  };
}
