import * as child_process from 'child_process';
import * as fs from 'fs';

export function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise(resolve => {
        const proc = child_process.spawn(cmd, args, { windowsHide: true });
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => resolve(out));
        proc.on('error', () => resolve(''));
    });
}

export function readDir(dir: string): string[] {
    try { return fs.readdirSync(dir); } catch { return []; }
}

export function isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
