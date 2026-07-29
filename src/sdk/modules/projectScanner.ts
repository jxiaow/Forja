import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SdkProjectInfo } from '../types';
import { EXCLUDE_DIRS, EXCLUDE_PATH_SEGMENTS, DEFAULT_SCAN_DEPTH, SCAN_TIMEOUT_MS } from '../constants';
import { isWindows } from '../platform';
import { log, logError } from '../utils/logger';
import { getSdkSetting } from '../../core/settingsStore';

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

    const wsRoot = workspaceFolders[0].uri.fsPath;
    const maxDepth = getSdkSetting('scanDepth') || DEFAULT_SCAN_DEPTH;
    const filePattern = isWindows ? /\.sln$/i : /^(Makefile|makefile|GNUmakefile)$/;

    log(`开始 fs 遍历扫描, 最大深度: ${maxDepth}, 排除目录: ${EXCLUDE_DIRS.join(',')}, 排除路径: ${EXCLUDE_PATH_SEGMENTS.join(',')}`);

    const allResults: vscode.Uri[] = [];

    try {
      await this.scanWithTimeout(() => {
        for (const folder of workspaceFolders) {
          const wsRoot = folder.uri.fsPath;
          this.walk(wsRoot, wsRoot, 0, maxDepth, filePattern, allResults);
        }
      });
      log(`fs 遍历返回 ${allResults.length} 个文件`);
      this._projects = allResults.map(uri => this.uriToProjectInfo(uri));
    } catch (err) {
      logError('项目扫描失败', err);
      this._projects = [];
    }

    return this._projects;
  }

  /** 递归遍历目录 */
  private walk(
    dir: string,
    wsRoot: string,
    currentDepth: number,
    maxDepth: number,
    filePattern: RegExp,
    results: vscode.Uri[]
  ): void {
    if (currentDepth > maxDepth) { return; }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.includes(entry.name)) { continue; }
        const subDir = path.join(dir, entry.name);
        // 检查路径片段排除
        const relativePath = path.relative(wsRoot, subDir).replace(/\\/g, '/');
        if (EXCLUDE_PATH_SEGMENTS.some(seg => relativePath.includes(seg))) { continue; }
        this.walk(subDir, wsRoot, currentDepth + 1, maxDepth, filePattern, results);
      } else if (entry.isFile() && filePattern.test(entry.name)) {
        results.push(vscode.Uri.file(path.join(dir, entry.name)));
      }
    }
  }

  /** 带超时的扫描执行 */
  private scanWithTimeout(scanFn: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Scan timed out'));
      }, SCAN_TIMEOUT_MS);

      try {
        scanFn();
        clearTimeout(timer);
        resolve();
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
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
