import * as vscode from 'vscode';
import * as path from 'path';
import { SdkProjectInfo } from '../types';
import { EXCLUDE_DIRS, DEFAULT_SCAN_DEPTH, CFG_SECTION, SCAN_TIMEOUT_MS } from '../constants';
import { isWindows } from '../platform';
import { log, logError } from '../utils/logger';

export class ProjectScanner {
  private _projects: SdkProjectInfo[] = [];

  get projects(): SdkProjectInfo[] {
    return this._projects;
  }

  /** 扫描工作区中的 SDK 项目入口文件 */
  async scan(): Promise<SdkProjectInfo[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      log('无工作区文件夹，跳过扫描');
      this._projects = [];
      return [];
    }

    const config = vscode.workspace.getConfiguration(CFG_SECTION);
    const maxDepth = config.get<number>('scanDepth') || DEFAULT_SCAN_DEPTH;

    // 构建 glob 模式（限制深度）
    const pattern = isWindows ? '**/*.sln' : '**/Makefile';

    // 构建排除模式
    const excludePattern = `{${EXCLUDE_DIRS.map(d => `**/${d}/**`).join(',')}}`;

    log(`扫描模式: ${pattern}, 排除: ${excludePattern}, 最大深度: ${maxDepth}`);

    try {
      const files = await this.findFilesWithTimeout(pattern, excludePattern, maxDepth);
      log(`findFiles 返回 ${files.length} 个文件`);
      this._projects = files.map(uri => this.uriToProjectInfo(uri));
    } catch (err) {
      logError('项目扫描失败', err);
      this._projects = [];
    }

    return this._projects;
  }

  /** 带超时的文件搜索 */
  private findFilesWithTimeout(
    pattern: string,
    excludePattern: string,
    _maxDepth: number
  ): Promise<vscode.Uri[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Scan timed out'));
      }, SCAN_TIMEOUT_MS);

      vscode.workspace.findFiles(pattern, excludePattern, 100).then(
        (files) => {
          clearTimeout(timer);
          // 过滤深度
          const filtered = files.filter(uri => {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (!workspaceFolder) { return false; }
            const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
            const depth = relativePath.split(path.sep).length;
            return depth <= _maxDepth;
          });
          resolve(filtered);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /** 将 Uri 转换为 SdkProjectInfo */
  private uriToProjectInfo(uri: vscode.Uri): SdkProjectInfo {
    const filePath = uri.fsPath;
    const fileName = path.basename(filePath);
    const type = fileName.endsWith('.sln') ? 'sln' : 'makefile';
    const name = type === 'sln'
      ? path.basename(filePath, '.sln')
      : path.basename(path.dirname(filePath));

    return { name, path: filePath, type };
  }

  /** 根据扫描结果解析当前项目 */
  async resolveCurrentProject(projects: SdkProjectInfo[]): Promise<SdkProjectInfo | null> {
    if (projects.length === 0) {
      return null;
    }

    if (projects.length === 1) {
      return projects[0];
    }

    // 多个项目，弹出 QuickPick 让用户选择
    const items = projects.map(p => ({
      label: p.name,
      description: p.path,
      project: p
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '检测到多个 SDK 项目，请选择一个作为当前编译目标',
      title: 'SDK Pilot: 选择项目'
    });

    if (selected) {
      return (selected as typeof items[0]).project;
    }

    return null;
  }
}
