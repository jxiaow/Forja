/**
 * 统一日志入口。
 * VSCode 环境：输出到 OutputChannel。
 * CLI / 非 VSCode 环境：委托给 loggerBase（纯 console）。
 */
import type * as vscode from 'vscode';
import { createLoggerBase, log as baseLog, warn as baseWarn, error as baseError } from '../core/loggerBase';
import type { ScopedLogger } from '../core/loggerBase';

export type { ScopedLogger };

let _channel: vscode.OutputChannel | null = null;
let _useConsole = false;
let _initialized = false;

export function initLogger(): vscode.OutputChannel | null {
    if (_initialized) { return _channel; }
    _initialized = true;
    try {
        const vscodeApi = require('vscode') as typeof vscode;
        _channel = vscodeApi.window.createOutputChannel('Compilot');
    } catch {
        _useConsole = true;
        return null;
    }
    return _channel;
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

function _timestamp(): string {
    const now = new Date();
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function _write(level: LogLevel, message: string): void {
    if (_channel) {
        const parsed = _parseScope(message);
        const line = `[${_timestamp()}] [${level}] [${parsed.scope}] ${parsed.text}`;
        _channel.appendLine(line);
    } else {
        // Delegate to base logger (console)
        if (level === 'ERROR') { baseError(message); }
        else if (level === 'WARN') { baseWarn(message); }
        else { baseLog(message); }
    }
}

function _parseScope(message: string): { scope: string; text: string } {
    const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!match) {
        return { scope: 'App', text: message };
    }
    return { scope: match[1], text: match[2] || '' };
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
    if (!_initialized) {
        // Not yet initialized — check if we can access vscode
        try {
            require('vscode');
        } catch {
            _useConsole = true;
            _initialized = true;
        }
    }
    // If in console mode, use base logger directly (no vscode overhead)
    if (_useConsole && !_channel) {
        return createLoggerBase(scope);
    }
    return {
        info: (message: string) => _write('INFO', `[${scope}] ${message}`),
        warn: (message: string) => _write('WARN', `[${scope}] ${message}`),
        error: (message: string) => _write('ERROR', `[${scope}] ${message}`)
    };
}
