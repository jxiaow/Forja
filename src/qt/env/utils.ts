import * as child_process from 'child_process';
import * as fs from 'fs';

const DEFAULT_EXEC_TIMEOUT = 30000;

export function execAsync(cmd: string, args: string[], timeoutMs: number = DEFAULT_EXEC_TIMEOUT): Promise<string> {
    return new Promise(resolve => {
        const proc = child_process.spawn(cmd, args, { windowsHide: true });
        let out = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                proc.kill();
                // 超时时在 stderr 输出提示（非 --json 模式下可见）
                process.stderr.write(`[forja] timeout: ${cmd} ${args.join(' ')} (${timeoutMs}ms)\n`);
                resolve('');
            }
        }, timeoutMs);

        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(out);
            }
        });
        proc.on('error', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve('');
            }
        });
    });
}

export function readDir(dir: string): string[] {
    try { return fs.readdirSync(dir); } catch { return []; }
}

export function isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
