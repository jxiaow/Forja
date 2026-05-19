import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { VS_DETECT_TIMEOUT_MS } from '../constants';
import { isWindows } from '../platform';
import { log, logError } from '../utils/logger';
import { loadSdkSettings } from '../cli/settings';

export class ConfigService implements vscode.Disposable {
  private _vsDevCmdPath: string | null = null;
  private _disposables: vscode.Disposable[] = [];

  /** 获取 VsDevCmd.bat 路径 */
  async getVsDevCmdPath(): Promise<string | null> {
    if (!isWindows) {
      return null;
    }

    // 从 .compilot/sdk-settings.json 读取
    const folders = vscode.workspace.workspaceFolders;
    const wsRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : '';
    const userPath = wsRoot ? loadSdkSettings(wsRoot).vsDevCmdPath : '';

    if (userPath) {
      log(`检查用户配置的 VS 路径: ${userPath}`);
      if (fs.existsSync(userPath) && userPath.toLowerCase().endsWith('.bat')) {
        this._vsDevCmdPath = userPath;
        log(`使用用户配置的 VS 路径: ${userPath}`);
        return this._vsDevCmdPath;
      } else {
        logError(`用户配置的 VS 路径无效: ${userPath}`);
        vscode.window.showWarningMessage(
          `Compilot SDK: 配置的 VsDevCmd.bat 路径无效: ${userPath}，将尝试自动检测`
        );
      }
    }

    // 自动检测
    log('开始自动检测 Visual Studio...');
    this._vsDevCmdPath = await this.detectVisualStudio();
    if (this._vsDevCmdPath) {
      log(`自动检测到 VS: ${this._vsDevCmdPath}`);
    } else {
      log('自动检测未找到 Visual Studio');
    }
    return this._vsDevCmdPath;
  }

  /** 自动检测 VS 安装路径 */
  private async detectVisualStudio(): Promise<string | null> {
    // 尝试通过 vswhere.exe 检测
    const vswherePath = path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    );

    log(`检查 vswhere: ${vswherePath}`);
    if (fs.existsSync(vswherePath)) {
      try {
        const result = await this.execWithTimeout(
          `"${vswherePath}" -latest -property installationPath`,
          VS_DETECT_TIMEOUT_MS
        );
        const installPath = result.trim();
        log(`vswhere 返回: ${installPath}`);
        if (installPath) {
          const vsDevCmd = path.join(installPath, 'Common7', 'Tools', 'VsDevCmd.bat');
          if (fs.existsSync(vsDevCmd)) {
            return vsDevCmd;
          } else {
            log(`VsDevCmd.bat 不存在: ${vsDevCmd}`);
          }
        }
      } catch (err) {
        logError('vswhere 执行失败，回退到标准路径扫描', err);
      }
    } else {
      log('vswhere.exe 不存在，使用标准路径扫描');
    }

    // 标准路径扫描
    return this.scanStandardPaths();
  }

  /** 扫描标准 VS 安装路径 */
  private scanStandardPaths(): string | null {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const versions = ['2022', '2019'];
    const editions = ['Enterprise', 'Professional', 'Community', 'BuildTools'];

    for (const version of versions) {
      for (const edition of editions) {
        const vsDevCmd = path.join(
          programFiles,
          'Microsoft Visual Studio',
          version,
          edition,
          'Common7',
          'Tools',
          'VsDevCmd.bat'
        );
        if (fs.existsSync(vsDevCmd)) {
          return vsDevCmd;
        }
      }
    }

    // 也检查 Program Files (x86)
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    for (const version of versions) {
      for (const edition of editions) {
        const vsDevCmd = path.join(
          programFilesX86,
          'Microsoft Visual Studio',
          version,
          edition,
          'Common7',
          'Tools',
          'VsDevCmd.bat'
        );
        if (fs.existsSync(vsDevCmd)) {
          return vsDevCmd;
        }
      }
    }

    return null;
  }

  /** 带超时的命令执行 */
  private execWithTimeout(command: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = cp.exec(command, { timeout: timeoutMs }, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
      setTimeout(() => {
        proc.kill();
        reject(new Error('VS detection timed out'));
      }, timeoutMs);
    });
  }

  /** 监听 sdk-settings.json 文件变化 */
  onSettingsFileChanged(context: vscode.ExtensionContext, callback: () => void): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return; }
    const pattern = new vscode.RelativePattern(folders[0].uri, '.compilot/sdk-settings.json');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(callback);
    watcher.onDidCreate(callback);
    context.subscriptions.push(watcher);
    this._disposables.push(watcher);
  }

  dispose(): void {
    this._disposables.forEach(d => d.dispose());
  }
}
