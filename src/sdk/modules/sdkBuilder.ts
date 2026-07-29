import * as vscode from 'vscode';
import * as fs from 'fs';
import { StateManager } from './stateManager';
import { ConfigService } from './configService';
import { BuildAction } from '../types';
import { TASK_SOURCE } from '../constants';
import { isWindows } from '../platform';
import { getWindowsShellOptions } from '../platform/windows';
import { buildCommand, SdkPlanOptions } from '../shared/plan';
import { log, logError } from '../utils/logger';

export class SdkBuilder {
  constructor(
    private stateManager: StateManager,
    private configService: ConfigService
  ) {}

  /** 执行 Build */
  async build(): Promise<void> {
    await this.execute('Build');
  }

  /** 执行 Rebuild */
  async rebuild(): Promise<void> {
    await this.execute('Rebuild');
  }

  /** 执行 Clean */
  async clean(): Promise<void> {
    await this.execute('Clean');
  }

  /** 执行编译动作 */
  private async execute(action: BuildAction): Promise<void> {
    // 前置检查：是否有项目
    if (!this.stateManager.currentProject) {
      log(`${action}: 无当前项目，提示用户选择`);
      vscode.window.showWarningMessage('Forja SDK: 请先选择一个 SDK 项目');
      return;
    }
    if (!fs.existsSync(this.stateManager.currentProject.path)) {
      log(`${action}: 当前项目文件不存在: ${this.stateManager.currentProject.path}`);
      vscode.window.showWarningMessage('Forja SDK: 当前 SDK 项目文件不存在，请重新选择项目');
      this.stateManager.currentProject = null;
      await this.stateManager.persistToConfig();
      return;
    }

    // 前置检查：是否正在编译
    if (this.stateManager.isBuilding) {
      log(`${action}: 当前有编译任务正在执行，拒绝`);
      vscode.window.showWarningMessage('Forja SDK: 当前有编译任务正在执行');
      return;
    }

    // 组装命令参数
    const actionMap: Record<BuildAction, SdkPlanOptions['action']> = {
      'Build': 'build',
      'Rebuild': 'rebuild',
      'Clean': 'clean',
    };

    const planOptions: SdkPlanOptions = {
      action: actionMap[action],
      workspace: '',  // Not needed for command assembly
      project: this.stateManager.currentProject.path,
      mode: this.stateManager.mode,
      arch: this.stateManager.arch,
    };

    // Windows 前置检查：VS 环境
    if (isWindows && planOptions.project.endsWith('.sln')) {
      const vsDevCmdPath = await this.configService.getVsDevCmdPath();
      if (!vsDevCmdPath) {
        logError(`${action}: 未检测到 VS 环境`);
        vscode.window.showErrorMessage(
          'Forja SDK: 未检测到 Visual Studio 环境，请安装 Visual Studio，或在 Forja 配置面板中配置 VS 安装路径'
        );
        return;
      }
      planOptions.vsDevCmdPath = vsDevCmdPath;
    }

    // 使用共享的命令组装逻辑
    const commands = buildCommand(planOptions);
    const command = commands.join(' && ');

    log(`${action}: 生成命令: ${command}`);
    await this.executeTask(command, action);
  }

  /** 创建并执行 VSCode Task */
  private async executeTask(command: string, action: BuildAction): Promise<void> {
    const mode = this.stateManager.mode;

    // Shell 配置
    const shellOptions: vscode.ShellExecutionOptions = isWindows
      ? getWindowsShellOptions()
      : {};

    const execution = new vscode.ShellExecution(command, shellOptions);

    // Task 定义
    const taskDefinition: vscode.TaskDefinition = { type: 'shell' };
    const task = new vscode.Task(
      taskDefinition,
      vscode.TaskScope.Workspace,
      `${action} ${mode}`,
      TASK_SOURCE,
      execution,
      isWindows ? '$msCompile' : '$gcc'
    );

    // 面板配置
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Shared,
      clear: true
    };

    // 执行
    try {
      this.stateManager.isBuilding = true;
      log(`启动 Task: ${action} ${mode}`);
      await vscode.tasks.executeTask(task);
    } catch (error) {
      this.stateManager.isBuilding = false;
      logError('任务启动失败', error);
      vscode.window.showErrorMessage(`Forja SDK: 任务启动失败 - ${error}`);
    }
  }
}
