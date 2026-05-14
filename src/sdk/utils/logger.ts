import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Compilot SDK');
  }
  return outputChannel;
}

export function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toLocaleTimeString();
  const errStr = error instanceof Error ? error.message : String(error ?? '');
  outputChannel?.appendLine(`[${timestamp}] ERROR: ${message}${errStr ? ' - ' + errStr : ''}`);
}

export function getOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}
