/**
 * 纯 console 日志实现 — 用于 CLI 或无 VSCode 环境。
 * 不依赖 vscode。
 */

export type ScopedLogger = {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
};

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

let _silent = false;

/** 静默模式：--json 时调用，抑制 INFO/WARN 输出 */
export function setSilent(silent: boolean): void {
    _silent = silent;
}

/** 日志输出重定向（VSCode 扩展用：桥接到 OutputChannel） */
type OutputWriter = (line: string) => void;
let _outputWriter: OutputWriter | null = null;

export function setOutputWriter(writer: OutputWriter | null): void {
    _outputWriter = writer;
}

function _timestamp(): string {
    const now = new Date();
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function _write(level: LogLevel, message: string): void {
    if (_silent && level !== 'ERROR') { return; }
    const line = `[${_timestamp()}] [${level}] ${message}`;
    if (_outputWriter) {
        _outputWriter(line);
    } else {
        process.stderr.write(line + '\n');
    }
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

export function createLoggerBase(scope: string): ScopedLogger {
    return {
        info: (message: string) => _write('INFO', `[${scope}] ${message}`),
        warn: (message: string) => _write('WARN', `[${scope}] ${message}`),
        error: (message: string) => _write('ERROR', `[${scope}] ${message}`)
    };
}
