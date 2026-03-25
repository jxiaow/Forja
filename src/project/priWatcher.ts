import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 找到文件所在目录最近的 .pri 或 .pro 文件
function findPriOrPro(dir: string, root: string): string | null {
    let current = dir;
    while (current.startsWith(root)) {
        const entries = fs.readdirSync(current);
        const pri = entries.find(e => e.endsWith('.pri'));
        if (pri) return path.join(current, pri);
        const pro = entries.find(e => e.endsWith('.pro'));
        if (pro) return path.join(current, pro);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

function readPriContent(priPath: string): string {
    return fs.readFileSync(priPath, 'utf-8');
}

function getRelativePath(priPath: string, filePath: string): string {
    const rel = path.relative(path.dirname(priPath), filePath).replace(/\\/g, '/');
    return `$$PWD/${rel}`;
}

function isInPri(content: string, relPath: string): boolean {
    return content.includes(relPath);
}

async function promptSync(priPath: string, filePath: string, action: 'add' | 'remove') {
    const ext = path.extname(filePath);
    const relPath = getRelativePath(priPath, filePath);
    const priName = path.basename(priPath);
    const verb = action === 'add' ? '添加到' : '从';
    const verb2 = action === 'add' ? '' : '中移除';

    const answer = await vscode.window.showInformationMessage(
        `${action === 'add' ? '新建' : '删除'}了 ${path.basename(filePath)}，是否${verb} ${priName} ${verb2}？`,
        '是', '否'
    );
    if (answer !== '是') return;

    let content = readPriContent(priPath);
    if (action === 'add') {
        content = addToPri(content, relPath, ext);
    } else {
        content = removeFromPri(content, relPath);
    }
    fs.writeFileSync(priPath, content, 'utf-8');
    vscode.window.showInformationMessage(`已更新 ${priName}`);
}

function addToPri(content: string, relPath: string, ext: string): string {
    if (isInPri(content, relPath)) return content;

    let section = '';
    if (ext === '.cpp') section = 'SOURCES';
    else if (ext === '.h') section = 'HEADERS';
    else if (ext === '.ui') section = 'FORMS';
    else return content;

    // 找到对应 section 末尾追加
    const regex = new RegExp(`(${section}\\s*\\+?=(?:[^\\n]*\\\\\\n)*[^\\n]*)`, 'm');
    if (regex.test(content)) {
        return content.replace(regex, (match) => {
            // 如果最后一行有 \，在其后追加；否则直接加 +=
            if (match.trimEnd().endsWith('\\')) {
                return match + `\n    ${relPath} \\`;
            }
            return match + ` \\\n    ${relPath}`;
        });
    }
    // section 不存在，直接追加
    return content + `\n${section} += \\\n    ${relPath}\n`;
}

function removeFromPri(content: string, relPath: string): string {
    // 移除包含该路径的行（含可能的行尾 \）
    const lines = content.split('\n');
    const filtered = lines.filter(line => !line.includes(relPath));
    // 修复可能残留的孤立 \ 在上一行
    const result: string[] = [];
    for (let i = 0; i < filtered.length; i++) {
        const line = filtered[i];
        const next = filtered[i + 1];
        // 如果当前行以 \ 结尾，但下一行是新 section 或空行，去掉 \
        if (line.trimEnd().endsWith('\\') && (!next || next.trim() === '' || /^[A-Z_]/.test(next.trim()))) {
            result.push(line.trimEnd().slice(0, -1).trimEnd());
        } else {
            result.push(line);
        }
    }
    return result.join('\n');
}

export function registerPriWatcher(context: vscode.ExtensionContext) {
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!root) return;

    // 监听 .cpp / .h / .ui 文件创建
    const createWatcher = vscode.workspace.createFileSystemWatcher('**/*.{cpp,h,ui}');
    createWatcher.onDidCreate(async (uri) => {
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);
        // 忽略 Qt 自动生成的文件
        if (fileName.startsWith('ui_') || fileName.startsWith('moc_') || fileName.startsWith('qrc_')) { return; }
        const dir = path.dirname(filePath);
        const priPath = findPriOrPro(dir, root);
        if (!priPath) return;
        // 已经在 pri/pro 里了，静默跳过
        const relPath = getRelativePath(priPath, filePath);
        if (isInPri(readPriContent(priPath), relPath)) { return; }
        await promptSync(priPath, filePath, 'add');
    });

    // 监听 .cpp / .h / .ui 文件删除
    createWatcher.onDidDelete(async (uri) => {
        const filePath = uri.fsPath;
        const dir = path.dirname(filePath);
        const priPath = findPriOrPro(dir, root);
        if (!priPath) return;
        const content = readPriContent(priPath);
        const relPath = getRelativePath(priPath, filePath);
        if (!isInPri(content, relPath)) return;
        await promptSync(priPath, filePath, 'remove');
    });

    // 监听 .pro / .pri 变动，提示重新 qmake
    const proWatcher = vscode.workspace.createFileSystemWatcher('**/*.{pro,pri}');
    let qmakeNeeded = false;
    proWatcher.onDidChange(() => {
        if (!qmakeNeeded) {
            qmakeNeeded = true;
            vscode.window.showWarningMessage(
                '.pro/.pri 文件已变更，建议重新运行 QMake',
                '立即 QMake', '忽略'
            ).then(answer => {
                qmakeNeeded = false;
                if (answer === '立即 QMake') {
                    vscode.commands.executeCommand('xyQt.qmake');
                }
            });
        }
    });

    context.subscriptions.push(createWatcher, proWatcher);
}
