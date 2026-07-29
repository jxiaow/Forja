import * as fs from 'fs';
import * as path from 'path';

export interface RemoteProblemSource {
    remote?: {
        result?: unknown;
        stdout?: string;
        stderr?: string;
    };
}

export interface RemoteProblemLine {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning';
    message: string;
}

export function extractRemoteProblemLines(result: RemoteProblemSource): RemoteProblemLine[] {
    const lines: string[] = [];
    const parsedResult = result.remote?.result;
    if (parsedResult && typeof parsedResult === 'object') {
        const errors = (parsedResult as { errors?: unknown }).errors;
        if (Array.isArray(errors)) {
            for (const error of errors) {
                if (typeof error === 'string') { lines.push(error); }
            }
        }
    }
    if (result.remote?.stdout) { lines.push(...result.remote.stdout.split(/\r?\n/)); }
    if (result.remote?.stderr) { lines.push(...result.remote.stderr.split(/\r?\n/)); }

    const problems: RemoteProblemLine[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        const problem = parseProblemLine(line);
        if (!problem) { continue; }
        const key = `${problem.file}:${problem.line}:${problem.column}:${problem.message}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        problems.push(problem);
    }
    return problems;
}

export function mapRemoteProblemPath(workspace: string, remotePath: string, rawFile: string): string | null {
    const normalizedWorkspace = path.resolve(workspace);
    const file = rawFile.replace(/\\/g, '/');
    const normalizedRemotePath = remotePath.replace(/\\/g, '/').replace(/\/+$/, '');

    let relative = '';
    if (file.startsWith(normalizedRemotePath + '/')) {
        relative = file.slice(normalizedRemotePath.length + 1);
    } else if (!path.posix.isAbsolute(file) && !/^[A-Za-z]:\//.test(file)) {
        relative = file;
    } else {
        return null;
    }

    if (!relative || relative.split('/').some(part => part === '..')) { return null; }
    const localPath = path.resolve(normalizedWorkspace, ...relative.split('/'));
    if (localPath !== normalizedWorkspace && !localPath.startsWith(normalizedWorkspace + path.sep)) { return null; }
    if (!fs.existsSync(localPath)) { return null; }
    return localPath;
}

function parseProblemLine(line: string): RemoteProblemLine | null {
    const text = line.trim();
    if (!text) { return null; }

    const msvc = /^(.*)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning)\s+[^:]+:\s*(.+)$/i.exec(text);
    if (msvc) {
        return {
            file: msvc[1],
            line: Number(msvc[2]),
            column: msvc[3] ? Number(msvc[3]) : 1,
            severity: /warning/i.test(msvc[4]) ? 'warning' : 'error',
            message: msvc[5]
        };
    }

    const gcc = /^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.+)$/i.exec(text);
    if (gcc) {
        return {
            file: gcc[1],
            line: Number(gcc[2]),
            column: gcc[3] ? Number(gcc[3]) : 1,
            severity: /warning/i.test(gcc[4]) ? 'warning' : 'error',
            message: gcc[5]
        };
    }

    return null;
}
