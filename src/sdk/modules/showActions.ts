import * as vscode from 'vscode';
import { StateManager } from './stateManager';
import { ProjectScanner } from './projectScanner';
import { ActionQuickPickItem, BuildMode, Arch } from '../types';
import { CMD_BUILD, CMD_REBUILD, CMD_CLEAN } from '../constants';
import { isWindows } from '../platform';

export class ShowActions {
  constructor(
    private stateManager: StateManager,
    private projectScanner: ProjectScanner
  ) {}

  /** 显示 QuickPick 菜单 */
  async show(): Promise<void> {
    const items = this.buildItems();

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'SDK Pilot 操作',
      title: 'SDK Pilot'
    });

    if (selected) {
      await this.handleSelection(selected as ActionQuickPickItem);
    }
  }

  /** 构建菜单项列表 */
  private buildItems(): ActionQuickPickItem[] {
    const items: ActionQuickPickItem[] = [];

    // 构建分组
    items.push({ label: '构建', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(tools) Build', action: 'build' });
    items.push({ label: '$(refresh) Rebuild', action: 'rebuild' });
    items.push({ label: '$(trash) Clean', action: 'clean' });

    // 模式分组
    items.push({ label: '模式', kind: vscode.QuickPickItemKind.Separator });

    const currentMode = this.stateManager.mode;
    const currentArch = this.stateManager.arch;

    if (isWindows) {
      const modes: Array<{ mode: BuildMode; arch: Arch }> = [
        { mode: 'debug', arch: 'x86' },
        { mode: 'debug', arch: 'x64' },
        { mode: 'release', arch: 'x86' },
        { mode: 'release', arch: 'x64' }
      ];

      for (const { mode, arch } of modes) {
        const isCurrent = mode === currentMode && arch === currentArch;
        const modeStr = mode === 'debug' ? 'Debug' : 'Release';
        const prefix = isCurrent ? '$(check) ' : '     ';
        items.push({
          label: `${prefix}${modeStr} ${arch}`,
          action: 'setMode',
          value: `${mode}|${arch}`
        });
      }
    } else {
      const modes: BuildMode[] = ['debug', 'release'];
      for (const mode of modes) {
        const isCurrent = mode === currentMode;
        const modeStr = mode === 'debug' ? 'Debug' : 'Release';
        const prefix = isCurrent ? '$(check) ' : '     ';
        items.push({
          label: `${prefix}${modeStr}`,
          action: 'setMode',
          value: mode
        });
      }
    }

    // 项目分组
    items.push({ label: '项目', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(folder) 切换项目...', action: 'switchProject' });

    return items;
  }

  /** 处理用户选择 */
  private async handleSelection(item: ActionQuickPickItem): Promise<void> {
    switch (item.action) {
      case 'build':
        await vscode.commands.executeCommand(CMD_BUILD);
        break;
      case 'rebuild':
        await vscode.commands.executeCommand(CMD_REBUILD);
        break;
      case 'clean':
        await vscode.commands.executeCommand(CMD_CLEAN);
        break;
      case 'setMode':
        await this.handleSetMode(item.value!);
        break;
      case 'switchProject':
        await this.handleSwitchProject();
        break;
    }
  }

  /** 处理模式切换 */
  private async handleSetMode(value: string): Promise<void> {
    if (isWindows) {
      const [mode, arch] = value.split('|') as [BuildMode, Arch];
      this.stateManager.mode = mode;
      this.stateManager.arch = arch;
    } else {
      this.stateManager.mode = value as BuildMode;
    }
    await this.stateManager.persistToConfig();
  }

  /** 处理项目切换 */
  private async handleSwitchProject(): Promise<void> {
    const projects = this.projectScanner.projects;

    if (projects.length === 0) {
      vscode.window.showInformationMessage('SDK Pilot: 未找到可用的 SDK 项目');
      return;
    }

    const currentPath = this.stateManager.currentProject?.path;
    const items = projects.map(p => ({
      label: p.name,
      description: p.path === currentPath ? '（当前）' : p.path,
      project: p
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择 SDK 项目',
      title: 'SDK Pilot: 切换项目'
    });

    if (selected) {
      this.stateManager.currentProject = (selected as typeof items[0]).project;
      await this.stateManager.persistToConfig();
    }
  }
}
