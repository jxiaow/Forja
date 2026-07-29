import * as vscode from 'vscode';

export function getWindowsShellOptions(): vscode.ShellExecutionOptions {
  return {
    executable: 'cmd.exe',
    shellArgs: ['/c']
  };
}
