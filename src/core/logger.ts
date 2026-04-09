import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | null = null;

export function initLogger(): vscode.OutputChannel {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel('Qt Pilot');
    }
    return _channel;
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';
type ScopedLogger = {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
};

function _timestamp(): string {
    const now = new Date();
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function _parseScope(message: string): { scope: string; text: string } {
    const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!match) {
        return { scope: 'App', text: message };
    }
    return {
        scope: match[1],
        text: match[2] || ''
    };
}

function _write(level: LogLevel, message: string): void {
    if (!_channel) { return; }
    const parsed = _parseScope(message);
    _channel.appendLine(`[${_timestamp()}] [${level}] [${parsed.scope}] ${parsed.text}`);
}

export function log(message: string): void {
    _write('INFO', message);
}

export function warn(message: string): void {
    _write('WARN', message);
}

export function error(message: string): void {
    _write('ERROR', message);
}

export function createLogger(scope: string): ScopedLogger {
    return {
        info: (message: string) => _write('INFO', `[${scope}] ${message}`),
        warn: (message: string) => _write('WARN', `[${scope}] ${message}`),
        error: (message: string) => _write('ERROR', `[${scope}] ${message}`)
    };
}
