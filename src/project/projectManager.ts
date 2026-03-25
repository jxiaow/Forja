import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectInfo {
    proPath: string;        // .pro 文件完整路径
    projectDir: string;     // 项目目录（相对于 workspace）
    proFile: string;        // .pro 文件名
    target: string;         // TARGET 名称（显示用，从 .pro 粗略解析）
    qtModules: string[];    // QT 模块列表
    defines: string[];      // DEFINES
}

export interface MakefileInfo {
    target: string;         // 可执行文件名（不含 .exe）
    destDir: string;        // 输出目录（已展开的最终值）
}

export function scanProFiles(root: string): string[] {
    const proFiles: string[] = [];

    function scan(dir: string): void {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const skip = ['node_modules', '.git', 'build', 'debug', 'release', 'out'];
                if (entry.isDirectory() && !skip.includes(entry.name.toLowerCase())) {
                    scan(path.join(dir, entry.name));
                } else if (entry.isFile() && entry.name.endsWith('.pro')) {
                    proFiles.push(path.join(dir, entry.name));
                }
            }
        } catch {}
    }

    scan(root);
    return proFiles.map(p => path.relative(root, p).replace(/\\/g, '/'));
}

// ── Makefile 解析（qmake 生成的最终值，最可靠） ──

function _parseMakefileVar(makefilePath: string, varName: string): string | null {
    try {
        if (!fs.existsSync(makefilePath)) { return null; }
        const content = fs.readFileSync(makefilePath, 'utf-8');
        const match = content.match(new RegExp(`^${varName}\\s*=\\s*(.+)$`, 'm'));
        if (!match) { return null; }
        // 去掉行尾注释（如 qmake 生成的 #avoid trailing-slash linebreak）
        return match[1].replace(/#.*$/, '').trim();
    } catch {}
    return null;
}

export function getMakefileInfo(projectDir: string, mode?: string): MakefileInfo | null {
    // 按 mode 优先选对应的 Makefile，再 fallback 到通用 Makefile
    const modeFile = mode === 'release' ? 'Makefile.Release'
                   : mode === 'debug'   ? 'Makefile.Debug'
                   : null;
    const candidates = [
        modeFile ? path.join(projectDir, modeFile) : null,
        path.join(projectDir, 'Makefile'),
        path.join(projectDir, 'Makefile.Debug'),
        path.join(projectDir, 'Makefile.Release')
    ].filter((p): p is string => p !== null);

    let target: string | null = null;
    let destDir: string | null = null;

    for (const mf of candidates) {
        if (!target) {
            const t = _parseMakefileVar(mf, 'TARGET');
            if (t) { target = t.replace(/\.exe$/i, ''); }
        }
        if (!destDir) {
            const d = _parseMakefileVar(mf, 'DESTDIR');
            if (d) { destDir = d.replace(/\\/g, '/').replace(/\/$/, ''); }
        }
        if (target && destDir) { break; }
    }

    if (!target) { return null; }
    return { target, destDir: destDir || '' };
}

// ── .pro 文件解析（只取显示名 + IntelliSense 需要的信息） ──

export function parseProFile(proPath: string): ProjectInfo {
    const content = fs.readFileSync(proPath, 'utf-8');
    const projectDir = path.dirname(proPath);
    const proFile = path.basename(proPath);

    // TARGET：粗略解析，仅用于 UI 显示
    let target = path.basename(proFile, '.pro');
    const targetMatch = content.match(/^\s*TARGET\s*=\s*(\S+)/m);
    if (targetMatch) { target = targetMatch[1].trim(); }

    // QT 模块
    const qtMatch = content.match(/^\s*QT\s*\+?=\s*(.+)$/m);
    const qtModules = qtMatch ? qtMatch[1].trim().split(/\s+/) : ['core', 'gui', 'widgets'];

    // DEFINES
    const definesMatch = content.match(/^\s*DEFINES\s*\+?=\s*(.+)$/m);
    const defines = definesMatch ? definesMatch[1].trim().split(/\s+/) : [];

    return {
        proPath,
        projectDir: path.basename(projectDir),
        proFile,
        target,
        qtModules,
        defines
    };
}

export async function selectProject(context: vscode.ExtensionContext, forceSelect = false): Promise<ProjectInfo | null> {
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!root) {
        vscode.window.showErrorMessage('请先打开工作区');
        return null;
    }

    const config = vscode.workspace.getConfiguration('xyQt');
    const savedProject = config.get<string>('selectedProject');

    if (!forceSelect && savedProject) {
        const fullPath = path.join(root, savedProject);
        if (fs.existsSync(fullPath)) {
            const info = parseProFile(fullPath);
            info.projectDir = path.dirname(savedProject);
            return info;
        }
    }

    const proFiles = scanProFiles(root);

    if (proFiles.length === 0) {
        vscode.window.showWarningMessage('未找到 .pro 文件，请在配置面板中手动设置');
        return null;
    }

    if (proFiles.length === 1 && !forceSelect) {
        const fullPath = path.join(root, proFiles[0]);
        const info = parseProFile(fullPath);
        info.projectDir = path.dirname(proFiles[0]);
        await config.update('selectedProject', proFiles[0], vscode.ConfigurationTarget.Workspace);
        return info;
    }

    const selected = await vscode.window.showQuickPick(proFiles, {
        placeHolder: '选择项目'
    });

    if (selected) {
        const fullPath = path.join(root, selected);
        const info = parseProFile(fullPath);
        info.projectDir = path.dirname(selected);
        await config.update('selectedProject', selected, vscode.ConfigurationTarget.Workspace);
        return info;
    }

    return null;
}
