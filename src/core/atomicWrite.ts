/**
 * Atomic JSON file write — write to temp then rename, so a crash
 * mid-write never leaves a half-written config behind.
 * No vscode dependency.
 */
import * as fs from 'fs';
import * as path from 'path';

export function atomicWriteFileSync(filePath: string, data: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    const tmpPath = filePath + '.tmp.' + process.pid;
    try {
        fs.writeFileSync(tmpPath, data, 'utf8');
        fs.renameSync(tmpPath, filePath);
    } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw e;
    }
}
