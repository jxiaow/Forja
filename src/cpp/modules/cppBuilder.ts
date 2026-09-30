import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StateManager } from './stateManager';
import { ConfigService } from './configService';
import { BuildAction } from '../types';
import { TASK_SOURCE } from '../constants';
import { isWindows } from '../platform';
import { getWindowsShellOptions } from '../platform/windows';
import { buildCommandDetailed, CppPlanOptions } from '../shared/plan';
import { getCppSetting } from '../../vscode/settingsStore';
import { log, logError } from '../utils/logger';
import { attachDiagnosticsMatcher, endBuildTee, discardBuildTee } from '../../vscode/diagnostics';

/**
 * CMake configure 参数来源优先级：
 * 1. workspace 配置（cppModulePrefs.cmakeConfigureArgs，与 CLI 共用）
 * 2. 扩展设置 forja.cpp.cmakeConfigureArgs（workspace 未配置时的补充）
 */
function _resolveCMakeConfigureArgs(): string[] {
  const prefs = getCppSetting('cmakeConfigureArgs') ?? [];
  if (prefs.length > 0) { return prefs; }
  try {
    const fromSettings = vscode.workspace.getConfiguration('forja.cpp').get<unknown>('cmakeConfigureArgs', []);
    if (Array.isArray(fromSettings)) {
      return fromSettings.filter((a): a is string => typeof a === 'string' && a.length > 0);
    }
  } catch { /* 配置不可用时忽略 */ }
  return [];
}

export class CppBuilder {
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
      vscode.window.showWarningMessage('Forja C++: 请先选择一个 C++ 项目');
      return;
    }
    if (!fs.existsSync(this.stateManager.currentProject.path)) {
      log(`${action}: 当前项目文件不存在: ${this.stateManager.currentProject.path}`);
      vscode.window.showWarningMessage('Forja C++: 当前 C++ 项目文件不存在，请重新选择项目');
      this.stateManager.currentProject = null;
      await this.stateManager.persistToConfig();
      return;
    }

    // 前置检查：是否正在编译
    if (this.stateManager.isBuilding) {
      log(`${action}: 当前有编译任务正在执行，拒绝`);
      vscode.window.showWarningMessage('Forja C++: 当前有编译任务正在执行');
      return;
    }

    // 组装命令参数
    const actionMap: Record<BuildAction, CppPlanOptions['action']> = {
      'Build': 'build',
      'Rebuild': 'rebuild',
      'Clean': 'clean',
    };

    const planOptions: CppPlanOptions = {
      action: actionMap[action],
      workspace: '',  // Not needed for command assembly
      project: this.stateManager.currentProject.path,
      mode: this.stateManager.mode,
      arch: this.stateManager.arch,
      cmakeConfigureArgs: _resolveCMakeConfigureArgs(),
    };

    // Windows 前置检查：VS 环境
    if (isWindows && planOptions.project.endsWith('.sln')) {
      const vsDevCmdPath = await this.configService.getVsDevCmdPath();
      if (!vsDevCmdPath) {
        logError(`${action}: 未检测到 VS 环境`);
        vscode.window.showErrorMessage(
          'Forja C++: 未检测到 Visual Studio 环境，请安装 Visual Studio，或在 Forja 配置面板中配置 VS 安装路径'
        );
        return;
      }
      planOptions.vsDevCmdPath = vsDevCmdPath;
    }

    // 使用共享的命令组装逻辑
    const { commands, warnings } = buildCommandDetailed(planOptions);
    const command = commands.join(' && ');

    for (const w of warnings) {
      log(`${action}: CMake preset 警告: ${w.message}`);
      vscode.window.showWarningMessage(`Forja C++: ${w.message}`);
    }

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

    // 恢复原始命令直接执行：终端实时流式输出；诊断输出走逐行 tee matcher
    const execution = new vscode.ShellExecution(command, shellOptions);

    // 本轮构建输出 tee：附加进 problemMatchers 数组，任务结束后解析进 Problems 面板
    const projectPath = this.stateManager.currentProject?.path;
    const workroots = projectPath ? [path.dirname(projectPath)] : [];
    const tee = attachDiagnosticsMatcher(workroots);

    // Task 定义
    const taskDefinition: vscode.TaskDefinition = { type: 'shell' };
    const matchers: (string | vscode.ProblemMatcher)[] = [isWindows ? '$msCompile' : '$gcc', tee];
    const task = new vscode.Task(
      taskDefinition,
      vscode.TaskScope.Workspace,
      `${action} ${mode}`,
      TASK_SOURCE,
      execution,
      // vscode 运行时接受 ProblemMatcher 对象数组，类型声明仅标 string[]
      matchers as string[]
    );

    // 面板配置
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Shared,
      clear: true
    };

    // 先注册结束监听（按 task 引用匹配），再执行，避免竞态漏掉事件
    const listener = vscode.tasks.onDidEndTaskProcess(e => {
      if (e.execution.task === task) {
        listener.dispose();
        endBuildTee(tee);
      }
    });

    // 执行
    try {
      this.stateManager.isBuilding = true;
      log(`启动 Task: ${action} ${mode}`);
      await vscode.tasks.executeTask(task);
    } catch (error) {
      this.stateManager.isBuilding = false;
      listener.dispose();
      discardBuildTee(tee);
      logError('任务启动失败', error);
      vscode.window.showErrorMessage(`Forja C++: 任务启动失败 - ${error}`);
    }
  }
}
