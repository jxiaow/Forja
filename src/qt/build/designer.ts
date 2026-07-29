/**
 * Qt Designer launcher — shared between CLI and VSCode.
 * No vscode dependency.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

export interface DesignerResult {
    ok: boolean;
    filePath?: string;
    designerPath?: string;
    error?: string;
}

/**
 * Launch Qt Designer to open a .ui file.
 * Waits for spawn to succeed or fail before returning.
 * @param filePath Absolute path to the .ui file
 * @param designerPath Optional explicit designer executable path
 * @param qtPath Optional Qt installation path for finding designer
 */
export async function launchDesigner(filePath: string, designerPath?: string, qtPath?: string): Promise<DesignerResult> {
    if (!fs.existsSync(filePath)) {
        return { ok: false, error: `.ui file does not exist: ${filePath}` };
    }
    if (path.extname(filePath).toLowerCase() !== '.ui') {
        return { ok: false, error: 'Only .ui files are supported' };
    }

    const designerExe = resolveDesignerExecutable(designerPath, qtPath);

    // Verify designer executable exists before spawning (unless it's just 'designer' in PATH)
    if (designerExe !== 'designer' && !fs.existsSync(designerExe)) {
        return { ok: false, error: `Qt Designer not found at: ${designerExe}` };
    }

    return new Promise((resolve) => {
        const proc = cp.spawn(designerExe, [filePath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });

        let settled = false;

        proc.once('spawn', () => {
            if (!settled) {
                settled = true;
                proc.unref();
                resolve({ ok: true, filePath, designerPath: designerExe });
            }
        });

        proc.once('error', (err: Error) => {
            if (!settled) {
                settled = true;
                resolve({ ok: false, error: `Failed to launch Qt Designer: ${err.message}` });
            }
        });
    });
}

function resolveDesignerExecutable(designerPath?: string, qtPath?: string): string {
    const configured = (designerPath || '').trim();
    if (configured) { return configured; }

    const candidates: string[] = [];
    const qt = (qtPath || '').trim();
    if (qt) {
        candidates.push(
            path.join(qt, 'designer.exe'),
            path.join(qt, 'bin', 'designer.exe'),
            path.join(qt, 'designer'),
            path.join(qt, 'bin', 'designer')
        );
    }

    for (const p of candidates) {
        try { if (fs.existsSync(p)) { return p; } } catch { /* try next */ }
    }
    return 'designer';
}
