import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | null = null;

export function initLogger(): vscode.OutputChannel {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel('XYQt');
    }
    return _channel;
}

export function log(message: string): void {
    if (!_channel) { return; }
    const time = new Date().toLocaleTimeString();
    _channel.appendLine(`[${time}] ${message}`);
}
