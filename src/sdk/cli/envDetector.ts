/**
 * SDK CLI 环境检测 — VS 和 make 工具检测。
 * 不依赖 vscode。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

export interface VsInstallation {
    vsDevCmdPath: string;
    version: string;
    edition: string;
}

/**
 * 检测系统上已安装的 Visual Studio 版本（Windows only）。
 */
export function detectVsInstallations(): VsInstallation[] {
    if (process.platform !== 'win32') { return []; }

    const results: VsInstallation[] = [];
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const searchRoots = [programFiles, programFilesX86];
    const versions = ['2022', '2019', '2017'];
    const editions = ['Enterprise', 'Professional', 'Community', 'BuildTools'];

    for (const root of searchRoots) {
        for (const version of versions) {
            for (const edition of editions) {
                const vsDevCmd = path.join(root, 'Microsoft Visual Studio', version, edition, 'Common7', 'Tools', 'VsDevCmd.bat');
                if (fs.existsSync(vsDevCmd)) {
                    results.push({ vsDevCmdPath: vsDevCmd, version, edition });
                }
            }
        }
    }

    return results;
}

/**
 * 检测 make 工具（Linux/macOS）。
 */
export function detectMake(): string | null {
    if (process.platform === 'win32') { return null; }
    try {
        const result = cp.execSync('which make 2>/dev/null', { encoding: 'utf-8' }).trim();
        return result || null;
    } catch {
        return null;
    }
}
