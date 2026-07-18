import * as vscode from 'vscode';
import * as path from 'path';
import { CppProjectInfo } from '../types';
import { DEFAULT_SCAN_DEPTH, SCAN_TIMEOUT_MS } from '../constants';
import { scanCppProjects } from '../../core/cppProjectScanner';
import { log, logError } from '../utils/logger';
import { getCppSetting } from '../../vscode/settingsStore';

export class ProjectScanner {
  private _projects: CppProjectInfo[] = [];

  get projects(): CppProjectInfo[] {
    return this._projects;
  }

  /** 扫描工作区中的 C++ 项目入口文件 */
  async scan(): Promise<CppProjectInfo[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      log('无工作区文件夹，跳过扫描');
      this._projects = [];
      return [];
    }

    const maxDepth = getCppSetting('scanDepth') || DEFAULT_SCAN_DEPTH;

    log(`开始扫描, 最大深度: ${maxDepth}`);

    try {
      const allResults: CppProjectInfo[] = [];

      await this.scanWithTimeout(() => {
        for (const folder of workspaceFolders) {
          const wsRoot = folder.uri.fsPath;
          const files = scanCppProjects({
            workspace: wsRoot,
            maxDepth,
            skipQtProjectDirs: true,
            relativePaths: false, // need absolute paths for CppProjectInfo
          });
          for (const filePath of files) {
            allResults.push(this.toProjectInfo(filePath));
          }
        }
      });

      log(`扫描完成，找到 ${allResults.length} 个项目`);
      this._projects = allResults;
    } catch (err) {
      logError('项目扫描失败', err);
      this._projects = [];
    }

    return this._projects;
  }

  /** 将绝对路径转换为 CppProjectInfo */
  private toProjectInfo(filePath: string): CppProjectInfo {
    const fileName = path.basename(filePath);
    const type = fileName.endsWith('.sln') ? 'sln' : 'makefile';
    const name = type === 'sln'
      ? path.basename(filePath, '.sln')
      : path.basename(path.dirname(filePath));
    return { name, path: filePath, type };
  }

  /** 带超时的扫描执行 */
  private scanWithTimeout(scanFn: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Scan timed out'));
      }, SCAN_TIMEOUT_MS);

      setImmediate(() => {
        try {
          scanFn();
          clearTimeout(timer);
          resolve();
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /** 根据扫描结果解析当前项目 */
  async resolveCurrentProject(projects: CppProjectInfo[]): Promise<CppProjectInfo | null> {
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
      placeHolder: '检测到多个 C++ 项目，请选择一个作为当前编译目标',
      title: 'Forja C++: 选择项目'
    });

    if (selected) {
      return (selected as typeof items[0]).project;
    }

    return null;
  }
}
