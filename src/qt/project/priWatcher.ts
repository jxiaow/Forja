import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getFileSyncPromptEnabled, getQmakeReminderEnabled } from '../../core/configService';
import { resolveProjectRoot } from '../../core/workspaceResolver';

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

async function promptRemoveFromPri(priPath: string, filePath: string): Promise<void> {
    if (!getFileSyncPromptEnabled()) { return; }

    const relPath = getRelativePath(priPath, filePath);
    const priName = path.basename(priPath);

    const answer = await vscode.window.showInformationMessage(
        `删除了 ${path.basename(filePath)}，是否从 ${priName} 中移除？`,
        '是', '否'
    );
    if (answer !== '是') return;

    const content = removeFromPri(readPriContent(priPath), relPath);
    fs.writeFileSync(priPath, content, 'utf-8');
    vscode.window.showInformationMessage(`已更新 ${priName}`);
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

export function registerPriWatcher(context: vscode.ExtensionContext): void {
    const root = resolveProjectRoot();
    if (!root) return;

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{cpp,h,ui}');

    // 监听 .cpp / .h / .ui 文件删除
    fileWatcher.onDidDelete(async (uri) => {
        const filePath = uri.fsPath;
        const dir = path.dirname(filePath);
        const priPath = findPriOrPro(dir, root);
        if (!priPath) return;
        const content = readPriContent(priPath);
        const relPath = getRelativePath(priPath, filePath);
        if (!isInPri(content, relPath)) return;
        await promptRemoveFromPri(priPath, filePath);
    });

    // 监听 .pro / .pri 变动，提示重新 qmake
    const proWatcher = vscode.workspace.createFileSystemWatcher('**/*.{pro,pri}');
    let qmakeNeeded = false;
    proWatcher.onDidChange(() => {
        if (!getQmakeReminderEnabled()) { return; }
        if (!qmakeNeeded) {
            qmakeNeeded = true;
            vscode.window.showWarningMessage(
                '.pro/.pri 文件已变更，建议重新运行 QMake',
                '立即 QMake', '忽略'
            ).then(answer => {
                qmakeNeeded = false;
                if (answer === '立即 QMake') {
                    vscode.commands.executeCommand('compilot.qt.qmake');
                }
            });
        }
    });

    context.subscriptions.push(fileWatcher, proWatcher);
}
