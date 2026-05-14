import * as vscode from 'vscode';
import { StateManager } from './stateManager';
import { CMD_SHOW_ACTIONS, CMD_BUILD } from '../constants';

export class StatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private buildButton: vscode.StatusBarItem;
  private disposable: vscode.Disposable;

  constructor(private stateManager: StateManager) {
    // 主状态栏项（项目信息 + 模式）
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = 'Compilot SDK: 项目';
    this.statusBarItem.command = CMD_SHOW_ACTIONS;

    // Build 快捷按钮（紧挨主状态栏项右侧）
    this.buildButton = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.buildButton.name = 'Compilot SDK: 构建';
    this.buildButton.command = CMD_BUILD;
    this.buildButton.text = '$(play)';
    this.buildButton.tooltip = 'Compilot SDK: Build';

    this.disposable = this.stateManager.onStateChanged(() => this.update());
    this.update();
  }

  /** 根据当前状态更新状态栏显示 */
  private update(): void {
    const project = this.stateManager.currentProject;

    if (this.stateManager.isBuilding && project) {
      this.statusBarItem.text = `$(sync~spin) Building ${project.name}`;
      this.statusBarItem.tooltip = '编译中...';
      this.buildButton.hide();
    } else if (project) {
      const mode = this.stateManager.mode === 'debug' ? 'Debug' : 'Release';
      const arch = this.stateManager.arch;
      this.statusBarItem.text = `$(tools) ${project.name} · ${mode} ${arch}`;
      this.statusBarItem.tooltip = '点击打开 Compilot SDK 操作菜单';
      this.buildButton.show();
    } else {
      this.statusBarItem.text = '$(tools) No Project';
      this.statusBarItem.tooltip = '未选择 SDK 项目，点击配置';
      this.buildButton.hide();
    }
  }

  show(): void {
    this.statusBarItem.show();
    if (this.stateManager.currentProject && !this.stateManager.isBuilding) {
      this.buildButton.show();
    }
  }

  hide(): void {
    this.statusBarItem.hide();
    this.buildButton.hide();
  }

  dispose(): void {
    this.statusBarItem.dispose();
    this.buildButton.dispose();
    this.disposable.dispose();
  }
}
