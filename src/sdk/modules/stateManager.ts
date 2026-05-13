import * as vscode from 'vscode';
import { SdkProjectInfo, BuildMode, Arch, StateChangeEvent } from '../types';
import { CFG_SECTION } from '../constants';
import { isLinux } from '../platform';

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

  /** 从工作区配置恢复状态 */
  async restoreFromConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration(CFG_SECTION);

    const mode = config.get<string>('mode');
    if (mode === 'debug' || mode === 'release') {
      this._mode = mode;
    }

    const arch = config.get<string>('arch');
    if (!isLinux && (arch === 'x86' || arch === 'x64')) {
      this._arch = arch;
    }

    const selectedProject = config.get<string>('selectedProject');
    if (selectedProject) {
      // 仅设置路径，后续由 scanner 验证
      const path = require('path');
      const name = path.basename(selectedProject, path.extname(selectedProject));
      const type = selectedProject.endsWith('.sln') ? 'sln' : 'makefile';
      this._currentProject = { name, path: selectedProject, type } as SdkProjectInfo;
    }
  }

  /** 将当前状态持久化到工作区配置 */
  async persistToConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration(CFG_SECTION);
    await config.update('mode', this._mode, vscode.ConfigurationTarget.Workspace);
    await config.update('arch', this._arch, vscode.ConfigurationTarget.Workspace);
    await config.update(
      'selectedProject',
      this._currentProject?.path || '',
      vscode.ConfigurationTarget.Workspace
    );
  }

  dispose(): void {
    this._onStateChanged.dispose();
  }
}
