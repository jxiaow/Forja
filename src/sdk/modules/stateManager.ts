import * as vscode from 'vscode';
import * as path from 'path';
import { SdkProjectInfo, BuildMode, Arch, StateChangeEvent } from '../types';
import { isLinux } from '../platform';
import { loadSdkSettings, saveSdkSettings, SdkSettings } from '../cli/settings';

export class StateManager implements vscode.Disposable {
  private _currentProject: SdkProjectInfo | null = null;
  private _mode: BuildMode = 'debug';
  private _arch: Arch = 'x86';
  private _isBuilding: boolean = false;

  private readonly _onStateChanged = new vscode.EventEmitter<StateChangeEvent>();
  readonly onStateChanged: vscode.Event<StateChangeEvent> = this._onStateChanged.event;

  get currentProject(): SdkProjectInfo | null {
    return this._currentProject;
  }

  set currentProject(value: SdkProjectInfo | null) {
    const old = this._currentProject;
    this._currentProject = value;
    this._onStateChanged.fire({ field: 'currentProject', oldValue: old, newValue: value });
  }

  get mode(): BuildMode {
    return this._mode;
  }

  set mode(value: BuildMode) {
    if (value !== 'debug' && value !== 'release') {
      return;
    }
    const old = this._mode;
    this._mode = value;
    this._onStateChanged.fire({ field: 'mode', oldValue: old, newValue: value });
  }

  get arch(): Arch {
    return this._arch;
  }

  set arch(value: Arch) {
    // Linux 平台下 arch 固定为 x86
    if (isLinux) {
      return;
    }
    if (value !== 'x86' && value !== 'x64') {
      return;
    }
    const old = this._arch;
    this._arch = value;
    this._onStateChanged.fire({ field: 'arch', oldValue: old, newValue: value });
  }

  get isBuilding(): boolean {
    return this._isBuilding;
  }

  set isBuilding(value: boolean) {
    const old = this._isBuilding;
    this._isBuilding = value;
    this._onStateChanged.fire({ field: 'isBuilding', oldValue: old, newValue: value });
  }

  /** 从 .compilot/sdk-settings.json 恢复状态 */
  async restoreFromConfig(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const wsRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : '';
    if (!wsRoot) { return; }

    const sdkSettings = loadSdkSettings(wsRoot);

    if (sdkSettings.mode === 'debug' || sdkSettings.mode === 'release') {
      this._mode = sdkSettings.mode;
    }

    if (!isLinux && (sdkSettings.arch === 'x86' || sdkSettings.arch === 'x64')) {
      this._arch = sdkSettings.arch;
    }

    if (sdkSettings.pinnedProject) {
      let resolvedPath = sdkSettings.pinnedProject;
      if (!path.isAbsolute(resolvedPath)) {
        resolvedPath = path.join(wsRoot, resolvedPath);
      }
      const name = path.basename(resolvedPath, path.extname(resolvedPath));
      const type = resolvedPath.endsWith('.sln') ? 'sln' : 'makefile';
      this._currentProject = { name, path: resolvedPath, type } as SdkProjectInfo;
    }
  }

  /** 将当前状态持久化到 .compilot/sdk-settings.json（唯一 source of truth） */
  async persistToConfig(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const wsRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : '';
    if (!wsRoot) { return; }

    // 计算相对路径
    let projectValue: string | null = null;
    if (this._currentProject?.path) {
      const relative = path.relative(wsRoot, this._currentProject.path);
      projectValue = relative.startsWith('..') || path.isAbsolute(relative)
        ? this._currentProject.path
        : relative.replace(/\\/g, '/');
    }

    const existing = loadSdkSettings(wsRoot);
    const updated: SdkSettings = {
      ...existing,
      mode: this._mode,
      arch: this._arch,
      pinnedProject: projectValue
    };
    saveSdkSettings(wsRoot, updated);
  }

  dispose(): void {
    this._onStateChanged.dispose();
  }
}
