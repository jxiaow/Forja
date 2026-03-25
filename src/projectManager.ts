import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectInfo {
    proPath: string;        // .pro 文件完整路径
    projectDir: string;     // 项目目录（相对于 workspace）
    proFile: string;        // .pro 文件名
    target: string;         // TARGET 名称
    destDir: string;        // DESTDIR（相对于项目目录，可能含变量）
    qtModules: string[];    // QT 模块列表
    defines: string[];      // DEFINES
}

let _currentProject: ProjectInfo | null = null;

export function getCurrentProject(): ProjectInfo | null {
    return _currentProject;
}

export function setCurrentProject(project: ProjectInfo | null): void {
    _currentProject = project;
}

export function scanProFiles(root: string): string[] {
    const proFiles: string[] = [];

    function scan(dir: string) {
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

export function parseProFile(proPath: string): ProjectInfo {
    const content = fs.readFileSync(proPath, 'utf-8');
    const projectDir = path.dirname(proPath);
    const proFile = path.basename(proPath);

    // 解析 TARGET：平台块优先，其次全局
    let target = 'app';
    const isWin = process.platform === 'win32';
    const platformKey = isWin ? 'win32' : 'linux';
    const platformMatch = content.match(new RegExp(`${platformKey}\\s*\\{[^}]*TARGET\\s*=\\s*(\\S+)`, 's'));
    if (platformMatch) {
        target = platformMatch[1].trim();
    } else {
        const globalMatch = content.match(/^\s*TARGET\s*=\s*(\S+)/m);
        if (globalMatch) { target = globalMatch[1].trim(); }
    }

    // 解析 DESTDIR（取最后一个平台无关的赋值，简单处理变量）
    let destDir = '';
    const destMatches = [...content.matchAll(/^\s*DESTDIR\s*=\s*(.+)$/mg)];
    if (destMatches.length > 0) {
        destDir = destMatches[destMatches.length - 1][1].trim();
        // 去掉行尾注释
        destDir = destDir.replace(/#.*$/, '').trim();
        // 替换 $$PWD → 空（相对路径基准就是 projectDir）
        destDir = destDir.replace(/\$\$\{?PWD\}?/g, '');
        // $$CONFIGURATION / $$[QMAKE_SPEC] 等运行时变量用占位符，buildManager 里按 mode 替换
        destDir = destDir.replace(/\$\$\{?CONFIGURATION\}?/gi, '{MODE}');
        destDir = destDir.replace(/\$\$\{?BUILD_TYPE\}?/gi, '{MODE}');
        // 去掉其他未知 $$ 变量（避免传入 shell 被误解析）
        destDir = destDir.replace(/\$\$\{?\w+\}?/g, '');
        destDir = destDir.replace(/^[/\\]/, '').replace(/\\/g, '/').trim();
    }

    // 解析 QT 模块
    const qtMatch = content.match(/^\s*QT\s*\+?=\s*(.+)$/m);
    const qtModules = qtMatch ? qtMatch[1].trim().split(/\s+/) : ['core', 'gui', 'widgets'];

    // 解析 DEFINES
    const definesMatch = content.match(/^\s*DEFINES\s*\+?=\s*(.+)$/m);
    const defines = definesMatch ? definesMatch[1].trim().split(/\s+/) : [];

    return {
        proPath,
        projectDir: path.basename(projectDir),
        proFile,
        target,
        destDir,
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

    // 非强制模式：有已保存的项目直接加载，不弹选择框
    if (!forceSelect && savedProject) {
        const fullPath = path.join(root, savedProject);
        if (fs.existsSync(fullPath)) {
            const info = parseProFile(fullPath);
            info.projectDir = path.dirname(savedProject);
            _currentProject = info;
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
        _currentProject = info;
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
        _currentProject = info;
        return info;
    }

    return null;
}
