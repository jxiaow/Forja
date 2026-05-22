import * as vscode from 'vscode';
import * as path from 'path';
import { SdkProjectInfo, BuildMode, Arch, StateChangeEvent } from '../types';
import { getDefaultArch, isLinux } from '../platform';
import { getSdkSetting, setSdkSetting } from '../../vscode/settingsStore';
import { resolveProjectRoot } from '../../vscode/workspaceResolver';

export class StateManager implements vscode.Disposable {
  private _currentProject: SdkProjectInfo | null = null;
  private _mode: BuildMode = 'debug';
  private _arch: Arch = getDefaultArch();
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
    if (isLinux) {
      const old = this._arch;
      this._arch = getDefaultArch();
      if (old !== this._arch) {
        this._onStateChanged.fire({ field: 'arch', oldValue: old, newValue: this._arch });
      }
      return;
    }
    if (value !== 'x86' && value !== 'x64') { return; }
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

  /** 从统一配置的 sdk 部分恢复状态 */
  async restoreFromConfig(): Promise<void> {
    const mode = getSdkSetting('mode');
    if (mode === 'debug' || mode === 'release') {
      this._mode = mode;
    }

    const arch = getSdkSetting('arch');
    if (!isLinux && (arch === 'x86' || arch === 'x64')) {
      this._arch = arch;
    } else {
      this._arch = getDefaultArch();
    }

    const pinnedProject = getSdkSetting('pinnedProject');
    if (pinnedProject) {
      const wsRoot = resolveProjectRoot('sdk');
      let resolvedPath = pinnedProject;
      if (wsRoot && !path.isAbsolute(resolvedPath)) {
        resolvedPath = path.join(wsRoot, resolvedPath);
      }
      const name = path.basename(resolvedPath, path.extname(resolvedPath));
      const type = resolvedPath.endsWith('.sln') ? 'sln' : 'makefile';
      this._currentProject = { name, path: resolvedPath, type } as SdkProjectInfo;
    }
  }

  /** 将当前状态持久化到统一配置的 sdk 部分 */
  async persistToConfig(): Promise<void> {
    const ws = resolveProjectRoot('sdk');

    // 计算相对路径（相对于 SDK 项目所在的 workspace folder）
    let projectValue: string | null = null;
    if (this._currentProject?.path && ws) {
      const relative = path.relative(ws, this._currentProject.path);
      projectValue = relative.startsWith('..') || path.isAbsolute(relative)
        ? this._currentProject.path
        : relative.replace(/\\/g, '/');
    }

    setSdkSetting('mode', this._mode);
    setSdkSetting('arch', this._arch);
    setSdkSetting('pinnedProject', projectValue);
  }

  dispose(): void {
    this._onStateChanged.dispose();
  }
}
